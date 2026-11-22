'use strict'

// ── Refresh DEV from PROD (dimensions first) ────────────────────────────────
// PROD changes; DEV must hold those changes before a deploy can safely replace
// PROD's model. This reads both servers live, works out what DEV is missing, and
// writes it to DEV — through the REST API, so TM1 Git writes DEV's file itself and
// no TM1 Git format is built by hand.
//
// Every write is recorded in the caller's OPEN change set (writeLog on the source
// server), which is what makes the release carry it and the approval cover it.
//
// The refresh MUST run while the change set is open: a closed set cannot record
// what was copied, so the deploy would ship objects nobody approved. Callers check
// that; this module refuses if there is no open session.
//
// Dimensions first. Attributes, hierarchies, chores and views/subsets follow in
// their own steps; each is a separate unit so they can be proved on their own.

const { makeClient } = require('./adapter-registry')
const { TM1Client } = require('./tm1-client')
const cl = require('./change-log')

const TYPE = { N: 'Numeric', S: 'String', A: 'Alias', C: 'Consolidated' }

const elName = (e) => e?.Name ?? e?.name ?? null
const elType = (e) => {
    const t = e?.Type ?? e?.type
    return typeof t === 'string' ? (TYPE[t] ?? t) : t == null ? 'Numeric' : t
}

// Pure: what PROD has that DEV does not, and what DEV has that PROD does not.
//   elements: [{ name, type }]
//   edges:    [{ parent, child, weight }]
function diffDimension(prod, dev) {
    const pEls = new Map((prod.elements ?? []).map(e => [elName(e), elType(e)]))
    const dEls = new Map((dev.elements ?? []).map(e => [elName(e), elType(e)]))
    const addElements = [...pEls.entries()]
        .filter(([n]) => n && !dEls.has(n))
        .map(([name, type]) => ({ name, type }))
    const typeChanges = [...pEls.entries()]
        .filter(([n, t]) => n && dEls.has(n) && dEls.get(n) !== t)
        .map(([name, type]) => ({ name, from: dEls.get(name), to: type }))
    // Deletes are reported, never applied without an explicit tick.
    const removeElements = [...dEls.keys()].filter(n => n && !pEls.has(n))

    const key = (e) => `${e.ParentName ?? e.parent}::${e.ComponentName ?? e.child}`
    const pEdges = new Map((prod.edges ?? []).map(e => [key(e), e]))
    const dEdges = new Map((dev.edges ?? []).map(e => [key(e), e]))
    const addEdges = [...pEdges.entries()]
        .filter(([k]) => !dEdges.has(k))
        .map(([, e]) => ({ parent: e.ParentName ?? e.parent, child: e.ComponentName ?? e.child, weight: e.Weight ?? e.weight ?? 1 }))
    const removeEdges = [...dEdges.entries()]
        .filter(([k]) => !pEdges.has(k))
        .map(([, e]) => ({ parent: e.ParentName ?? e.parent, child: e.ComponentName ?? e.child }))
    // A child that sits under a different parent (or a different weight) on PROD is
    // a MOVE — archiving is exactly this, and it is applied as a move, not a delete
    // plus an add, so the element keeps its data.
    const moves = []
    for (const [k, e] of pEdges) {
        const child = e.ComponentName ?? e.child
        const parent = e.ParentName ?? e.parent
        const weight = e.Weight ?? e.weight ?? 1
        for (const [dk, de] of dEdges) {
            if ((de.ComponentName ?? de.child) !== child) continue
            const dParent = de.ParentName ?? de.parent
            const dWeight = de.Weight ?? de.weight ?? 1
            if (dParent === parent && Number(dWeight) === Number(weight)) continue
            // Only a differing parent or weight for the same child counts once.
            if (!moves.some(m => m.child === child)) moves.push({ child, toParent: parent, toWeight: weight, fromParent: dParent, fromWeight: dWeight })
        }
    }
    const differs = addElements.length || typeChanges.length || removeElements.length || addEdges.length || removeEdges.length || moves.length
    return { differs: !!differs, addElements, typeChanges, removeElements, addEdges, removeEdges, moves }
}

async function readDimension(tm1, dim, hierarchy = dim) {
    const elements = await tm1.getElements(dim, hierarchy).catch(() => [])
    const edges = await tm1.getEdges(dim, hierarchy).catch(() => [])
    return { elements, edges }
}

// Read both servers and return one entry per dimension that differs. Control
// objects (}…) are skipped: they are not model changes a deploy ships.
async function planRefresh(source, target, { ideToken } = {}) {
    const dev = new TM1Client(source, makeClient(source, ideToken))
    const prod = new TM1Client(target, makeClient(target, ideToken))
    const dims = (await dev.getModelDimensions()).map(d => d?.Name ?? d).filter(Boolean)
    const items = []
    for (const dim of dims) {
        const [a, b] = await Promise.all([
            readDimension(prod, dim),
            readDimension(dev, dim),
        ])
        if (!a.elements.length && !a.edges.length) continue
        const d = diffDimension(a, b)
        if (!d.differs) continue
        items.push({ dimension: dim, ...d })
    }
    return { source, target, dimensions: items }
}

// Apply the ticked dimensions to DEV and record each one in the open change set.
//   accept: [{ dimension, includeDeletes }] — one tick per dimension. Everything
//           PROD has (elements, edges, moves) is brought across; deletes are the
//           only separate decision, because removing an element on DEV is how the
//           next deploy would remove it on PROD.
//
// A dimension is applied whole on purpose: adding an edge without its move, or an
// element without the edge that places it, leaves DEV in a state neither server
// has. Partial application is not offered.
async function applyRefresh(source, target, { ideToken, session, accept = [], user } = {}) {
    if (!session) throw Object.assign(new Error('Refused: open a change set first — a refresh must be recorded in one.'), { refused: true })
    const sess = cl.getSession(session)
    if (!sess) throw Object.assign(new Error(`Refused: no change set ${session}.`), { refused: true })
    if (sess.server !== source) throw Object.assign(new Error(`Refused: change set "${sess.name}" belongs to ${sess.server}, not ${source}.`), { refused: true })
    if (sess.closed_at) throw Object.assign(new Error(`Refused: change set "${sess.name}" is closed. Reopen it to bring ${target}'s changes into ${source}.`), { refused: true })

    const dev = new TM1Client(source, makeClient(source, ideToken))
    const prod = new TM1Client(target, makeClient(target, ideToken))
    const applied = []
    const skipped = []

    for (const want of accept) {
        const dim = want.dimension
        const [p, d] = await Promise.all([readDimension(prod, dim), readDimension(dev, dim)])
        const diff = diffDimension(p, d)
        const changed = []

        for (const e of diff.addElements) {
            await dev.addElementAt(dim, e.name, e.type, dim)
            changed.push(`element ${e.name}`)
        }
        for (const t of diff.typeChanges) {
            skipped.push({ dimension: dim, what: `type of ${t.name} (${t.from} → ${t.to})`, why: 'element types cannot be changed over REST' })
        }
        // Moves before plain additions: a move creates the edge that a plain add of
        // the same child would otherwise duplicate.
        const moved = new Set()
        for (const m of diff.moves) {
            if (m.fromParent) await dev.deleteEdge(dim, m.fromParent, m.child, dim).catch(() => {})
            await dev.addEdge(dim, m.toParent, m.child, m.toWeight ?? 1, dim)
            moved.add(m.child)
            changed.push(`move ${m.child}: ${m.fromParent ?? '(none)'} → ${m.toParent}`)
        }
        for (const e of diff.addEdges) {
            if (moved.has(e.child)) continue
            await dev.addEdge(dim, e.parent, e.child, e.weight ?? 1, dim)
            changed.push(`edge ${e.parent} → ${e.child}`)
        }
        if (want.includeDeletes) {
            for (const name of diff.removeElements) {
                await dev.deleteElement(dim, name, dim)
                changed.push(`removed ${name}`)
            }
        } else if (diff.removeElements.length) {
            skipped.push({
                dimension: dim,
                what: `${diff.removeElements.length} element${diff.removeElements.length === 1 ? '' : 's'} PROD no longer has`,
                why: 'kept on DEV, so the next deploy would put them back on PROD',
            })
        }

        if (changed.length) {
            cl.writeLog({ server: source, action: 'DIMENSION_UPDATED', objectType: 'dimension', objectName: dim, detail: changed.join('; '), user })
            applied.push({ dimension: dim, applied: changed })
        }
    }
    return { ok: true, source, target, applied, skipped }
}

module.exports = { diffDimension, planRefresh, applyRefresh }
