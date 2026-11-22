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
const { odataKey } = require('./odata-key')
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
    // A MOVE is a child both sides have, with exactly one parent on each side, and a
    // different parent — archiving is the usual case. Anything else (a child with
    // several parents on one side) is an edge difference to add or report, never a
    // move: guessing there would delete a rollup DEV added.
    const parentsOf = (map, child) => [...map.values()]
        .filter(e => (e.ComponentName ?? e.child) === child)
        .map(e => ({ parent: e.ParentName ?? e.parent, weight: Number(e.Weight ?? e.weight ?? 1) }))
    const moves = []
    const bothChildren = new Set([...pEdges.values()].map(e => e.ComponentName ?? e.child))
    for (const child of bothChildren) {
        if (!dEdges.size && !pEdges.size) continue
        const onProd = parentsOf(pEdges, child)
        const onDev = parentsOf(dEdges, child)
        if (onProd.length !== 1 || onDev.length !== 1) continue
        if (onProd[0].parent === onDev[0].parent && onProd[0].weight === onDev[0].weight) continue
        moves.push({ child, toParent: onProd[0].parent, toWeight: onProd[0].weight, fromParent: onDev[0].parent, fromWeight: onDev[0].weight })
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
        // Giving a leaf element children turns it into a consolidation, and TM1
        // clears the values stored against it. PROD already made that choice; on
        // DEV it is still a destructive step that must be named before it happens.
        const devType = new Map((b.elements ?? []).map(e => [elName(e), elType(e)]))
        const prodType = new Map((a.elements ?? []).map(e => [elName(e), elType(e)]))
        const parents = new Set([...d.addEdges.map(e => e.parent), ...d.moves.map(m => m.toParent)])
        const typeRisk = [...parents]
            .filter(p => p && devType.get(p) === 'Numeric' && prodType.get(p) === 'Consolidated')
            .map(p => ({ element: p, from: 'Numeric', to: 'Consolidated' }))
        items.push({ dimension: dim, ...d, typeRisk })
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

        // A move or edge can turn a leaf on DEV into a consolidation, clearing the
        // values stored against it. Never do that silently.
        const devType = new Map((d.elements ?? []).map(e => [elName(e), elType(e)]))
        const prodType = new Map((p.elements ?? []).map(e => [elName(e), elType(e)]))
        const parents = new Set([...diff.addEdges.map(e => e.parent), ...diff.moves.map(m => m.toParent)])
        const risky = [...parents].filter(x => x && devType.get(x) === 'Numeric' && prodType.get(x) === 'Consolidated')
        if (risky.length && !want.allowTypeChanges) {
            throw Object.assign(new Error(
                `Refused: refreshing ${dim} would turn ${risky.join(', ')} into consolidation${risky.length === 1 ? '' : 's'} on ${source}, ` +
                `and TM1 clears the values stored against ${risky.length === 1 ? 'it' : 'them'}. ` +
                `Tick "allow element type changes" if that is intended, or make the change in the model.`
            ), { refused: true })
        }

        for (const e of diff.addElements) {
            await dev.addElementAt(dim, e.name, e.type, dim)
            changed.push(`element ${e.name}`)
        }
        // A type change is a real change of the element's role: safe to apply only
        // when the person ticked it, because the leaf → consolidation direction
        // clears the values stored against the element (the typeRisk guard above
        // covers the case where an edge causes it).
        for (const t of diff.typeChanges) {
            if (!want.allowTypeChanges) {
                skipped.push({ dimension: dim, what: `type of ${t.name} (${t.from} → ${t.to})`, why: 'tick "allow element type changes" — the values stored against it are cleared' })
                continue
            }
            await dev.patch(
                `Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(dim)}')/Elements('${odataKey(t.name)}')`,
                { Type: t.to }
            )
            changed.push(`type ${t.name}: ${t.from} → ${t.to}`)
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
