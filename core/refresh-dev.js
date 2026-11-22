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
const settings = require('./deploy-settings')

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

async function readAttributes(tm1, dim) {
    try { return await tm1.getElementAttributes(dim) } catch { return [] }
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
    const approved = (await settings.get(target, { ideToken }).catch(() => ({})))?.attributeValues ?? {}
    const items = []
    for (const dim of dims) {
        const [a, b] = await Promise.all([
            readDimension(prod, dim),
            readDimension(dev, dim),
        ])
        if (!a.elements.length && !a.edges.length) continue
        const d = diffDimension(a, b)

        // Attribute definitions: a dimension can be identical in elements and still
        // be missing an attribute PROD has.
        let attributes = { add: [], onlyDev: [], typeChanges: [], confirmedValues: [], valueElements: 0 }
        try {
            const [pa, da] = await Promise.all([prod.getElementAttributes(dim), dev.getElementAttributes(dim)])
            const defs = diffAttributeDefinitions(pa, da)
            // Only the attributes an admin confirmed PROD's load maintains may have
            // their VALUES copied (A3). Never wholesale.
            const confirmed = new Set(approved[dim] ?? [])
            const prodNames = new Set((a.elements ?? []).map(elName).filter(Boolean))
            const devNames = new Set((b.elements ?? []).map(elName).filter(Boolean))
            let valueElements = 0
            for (const n of prodNames) if (devNames.has(n)) valueElements++
            attributes = { ...defs, confirmedValues: [...confirmed].filter(x => [...defs.add.map(a => a.name), ...((da ?? []).map(a => a.Name))].includes(x)), valueElements }
        } catch { /* no attribute access — carry on with elements */ }

        if (!d.differs && !attributes.add.length && !attributes.typeChanges.length) continue
        // Giving a leaf element children turns it into a consolidation, and TM1
        // clears the values stored against it. PROD already made that choice; on
        // DEV it is still a destructive step that must be named before it happens.
        const devType = new Map((b.elements ?? []).map(e => [elName(e), elType(e)]))
        const prodType = new Map((a.elements ?? []).map(e => [elName(e), elType(e)]))
        const parents = new Set([...d.addEdges.map(e => e.parent), ...d.moves.map(m => m.toParent)])
        const typeRisk = [...parents]
            .filter(p => p && devType.get(p) === 'Numeric' && prodType.get(p) === 'Consolidated')
            .map(p => ({ element: p, from: 'Numeric', to: 'Consolidated' }))
        items.push({ dimension: dim, ...d, typeRisk, attributes })
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
// ── Attributes ──────────────────────────────────────────────────────────────
// Two different things, refreshed differently:
//   definitions  — the attribute itself (name + type). PROD having one DEV lacks is
//                  a real gap: a rule or a view reads it. Copied.
//   values       — the data in it. Only for attributes whose owner has confirmed
//                  PROD's load maintains them (A3), never wholesale: on a loaded
//                  dimension, copying every value would overwrite what PROD wrote.
//
// Pure: definitions in, difference out. The value side needs a per-element read and
// is decided by the confirmed list, so it is not part of this.
function diffAttributeDefinitions(prodDefs = [], devDefs = []) {
    const norm = (t) => {
        const x = String(t ?? '').toUpperCase()
        if (x === 'C' || x === 'CONSOLIDATED') return 'C'
        if (x === 'N' || x === 'NUMERIC') return 'N'
        return 'S'   // String is TM1's default for attributes
    }
    const prod = new Map((prodDefs ?? []).filter(a => a?.Name).map(a => [a.Name, norm(a.Type)]))
    const dev = new Map((devDefs ?? []).filter(a => a?.Name).map(a => [a.Name, norm(a.Type)]))
    const add = [...prod.entries()].filter(([n]) => !dev.has(n)).map(([name, type]) => ({ name, type }))
    const onlyDev = [...dev.keys()].filter(n => !prod.has(n))
    const typeChanges = [...prod.entries()]
        .filter(([n, t]) => dev.has(n) && dev.get(n) !== t)
        .map(([name, to]) => ({ name, from: dev.get(name), to }))
    return { add, onlyDev, typeChanges, differs: add.length > 0 || typeChanges.length > 0 }
}

// Which attributes PROD's own processes write, read from their text. This is a
// SUGGESTION for the admin to confirm — never applied on its own. Only literal
// arguments can be read; a process that passes variables falls back to nothing,
// which is honest: a guess is worse than a gap.
function suggestAttributeWrites(processes = []) {
    const out = new Map()   // dimension → Set(attribute)
    const call = /(AttrPutS|AttrPutN|ElementAttrPutS|ElementAttrPutN)\s*\(([^)]*)\)/g
    const lit = /^\s*(['"])(.*?)\1\s*$/
    for (const p of processes ?? []) {
        const text = String(p?.PrologProcedure ?? p?.text ?? '')
        let m
        while ((m = call.exec(text))) {
            const args = m[2].split(',').map(a => a.trim())
            // AttrPut*(value, dim, element, attr [, …])
            const dim = (args[1] ?? '').match(lit)?.[2]
            const attr = (args[3] ?? '').match(lit)?.[2]
            if (!dim || !attr) continue
            if (!out.has(dim)) out.set(dim, new Set())
            out.get(dim).add(attr)
        }
    }
    return Object.fromEntries([...out].map(([d, set]) => [d, [...set].sort()]))
}

// Which type changes actually need a PATCH, and which are already settled by the
// edges. Ordering matters in TM1: a leaf only becomes a consolidation once it has
// a component, so patching Type=Consolidated before the edge fails with "element
// has no components". An element the move or edge just made a rollup therefore
// needs no patch at all.
//
// Pure, so the rule is testable without a server.
function typeChangesToApply(diff, want = {}) {
    const gainsComponents = new Set([
        ...(diff?.moves ?? []).filter(m => want?.moves?.[m.child] !== 'keep').map(m => m.toParent),
        ...(diff?.addEdges ?? []).map(e => e.parent),
    ])
    const patch = []
    const skip = []
    for (const t of diff?.typeChanges ?? []) {
        if (t.to === 'Consolidated' && gainsComponents.has(t.name)) continue   // the edge did it
        if (!want?.allowTypeChanges) { skip.push({ ...t, why: 'not allowed' }); continue }
        patch.push(t)
    }
    return { patch, skip }
}

// A decision is part of the record: it goes into the open change set, so Review
// and the deploy report can show who chose what.
function recordDecision(server, dimension, text, { kind, element, choice, user }) {
    try {
        cl.writeLog({
            server, action: 'REFRESH_DECISION', objectType: 'dimension', objectName: dimension,
            detail: text, user,
            afterState: { kind, element, choice },
        })
    } catch { /* the decision still applied; the log is evidence, not the action */ }
}

// Every delete and every move PROD made must be decided before the refresh can
// apply. There is no default: an undecided delete left alone would be silently
// restored on PROD by the next deploy, and an undecided move silently put back.
// Pure, so the rule is testable without a server.
//
//   want.deletes: { [element]: 'delete' | 'keep' }
//   want.moves:   { [child]:   'take'   | 'keep' }
function undecidedDecisions(diff, want = {}) {
    const open = []
    for (const el of diff?.removeElements ?? []) {
        const choice = want?.deletes?.[el]
        if (choice !== 'delete' && choice !== 'keep') open.push({ dimension: want?.dimension ?? null, kind: 'delete', element: el })
    }
    for (const m of diff?.moves ?? []) {
        const choice = want?.moves?.[m.child]
        if (choice !== 'take' && choice !== 'keep') open.push({ dimension: want?.dimension ?? null, kind: 'move', element: m.child })
    }
    return open
}

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

    // Refuse before anything is written if a delete or move is undecided.
    const undecided = []
    const planned = []
    for (const want of accept) {
        const [p, d] = await Promise.all([readDimension(prod, want.dimension), readDimension(dev, want.dimension)])
        const diff = diffDimension(p, d)
        planned.push({ want, diff })
        undecided.push(...undecidedDecisions(diff, want))
    }
    // An attribute whose type differs is a decision too: taking PROD's type clears
    // the values stored in it.
    for (const { want } of planned) {
        try {
            const [pa, da] = await Promise.all([readAttributes(prod, want.dimension), readAttributes(dev, want.dimension)])
            for (const t of diffAttributeDefinitions(pa, da).typeChanges) {
                if (!['take','keep'].includes(want.attributeTypes?.[t.name])) {
                    undecided.push({ dimension: want.dimension, kind: 'attribute', element: t.name })
                }
            }
        } catch { /* no attribute access: nothing to decide */ }
    }
    if (undecided.length) {
        const names = undecided.map(u => `${u.kind} ${u.element} (${u.dimension})`)
        throw Object.assign(new Error(
            `Refused: decide these before refreshing — ${names.join(', ')}. ` +
            `A delete is "delete on DEV too" or "keep it and restore it on PROD"; a move is "take PROD's" or "keep DEV's"; ` +
            `an attribute type is "take PROD's type" (its values are cleared) or "keep DEV's".`
        ), { refused: true, undecided })
    }

    for (const { want, diff } of planned) {
        const dim = want.dimension
        const [p, d] = await Promise.all([readDimension(prod, dim), readDimension(dev, dim)])
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
        // Moves before plain additions: a move creates the edge that a plain add of
        // the same child would otherwise duplicate.
        const moved = new Set()
        for (const m of diff.moves) {
            if (want.moves?.[m.child] === 'keep') {
                // Deliberate: DEV keeps its parent, so the next deploy puts DEV's
                // parent back on PROD — no data is affected by an edge either way.
                recordDecision(source, dim, `move ${m.child}: kept DEV's parent ${m.fromParent ?? '(none)'} — the next deploy restores it on the target`, { kind: 'move', element: m.child, choice: 'keep', user })
                continue
            }
            if (m.fromParent) await dev.deleteEdge(dim, m.fromParent, m.child, dim).catch(() => {})
            await dev.addEdge(dim, m.toParent, m.child, m.toWeight ?? 1, dim)
            moved.add(m.child)
            changed.push(`move ${m.child}: ${m.fromParent ?? '(none)'} → ${m.toParent}`)
            recordDecision(source, dim, `move ${m.child}: took the target's parent ${m.toParent}`, { kind: 'move', element: m.child, choice: 'take', user })
        }
        for (const e of diff.addEdges) {
            if (moved.has(e.child)) continue
            await dev.addEdge(dim, e.parent, e.child, e.weight ?? 1, dim)
            changed.push(`edge ${e.parent} → ${e.child}`)
        }
        // Type changes LAST: the edges above must land first (a leaf becomes a
        // consolidation only once it has a component), and an element the edge
        // already made a rollup is not patched at all.
        const { patch, skip: skipTypes } = typeChangesToApply(diff, want)
        for (const t of skipTypes) {
            skipped.push({ dimension: dim, what: `type of ${t.name} (${t.from} → ${t.to})`, why: 'tick "allow element type changes" — the values stored against it are cleared' })
        }
        for (const t of patch) {
            try {
                await dev.patch(
                    `Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(dim)}')/Elements('${odataKey(t.name)}')`,
                    { Type: t.to }
                )
                changed.push(`type ${t.name}: ${t.from} → ${t.to}`)
            } catch (e) {
                skipped.push({ dimension: dim, what: `type of ${t.name} (${t.from} → ${t.to})`, why: e.message })
            }
        }

        for (const name of diff.removeElements) {
            if (want.deletes?.[name] === 'keep') {
                // Deliberate: DEV keeps it, so the deploy restores it on the target
                // with no values (the element itself comes back, its data does not).
                recordDecision(source, dim, `delete ${name}: kept on DEV — the next deploy restores it on the target with no data`, { kind: 'delete', element: name, choice: 'keep', user })
                continue
            }
            await dev.deleteElement(dim, name, dim)
            changed.push(`removed ${name}`)
            recordDecision(source, dim, `delete ${name}: deleted on DEV too (its values are gone)`, { kind: 'delete', element: name, choice: 'delete', user })
        }

        // Attributes: create what PROD has and DEV does not; take a type only when
        // it was decided (a type change clears the attribute's values); copy VALUES
        // only for the confirmed list, and only for elements on both sides.
        try {
            const [pa, da] = await Promise.all([prod.getElementAttributes(dim), dev.getElementAttributes(dim)])
            const defs = diffAttributeDefinitions(pa, da)
            const tm1Type = (t) => (t === 'N' ? 'Numeric' : 'String')
            for (const a of defs.add) {
                await dev.createElementAttribute(dim, a.name, tm1Type(a.type))
                changed.push(`attribute ${a.name}`)
            }
            for (const t of defs.typeChanges) {
                if (want.attributeTypes?.[t.name] === 'keep') {
                    recordDecision(source, dim, `attribute ${t.name}: kept ${source}'s type ${t.fromMap ?? t.from}`, { kind: 'attribute', element: t.name, choice: 'keep', user })
                    continue
                }
                // take PROD's: delete and recreate — this is why values are cleared.
                await dev.deleteElementAttribute(dim, t.name).catch(() => {})
                await dev.createElementAttribute(dim, t.name, tm1Type(t.to))
                changed.push(`attribute ${t.name}: type ${t.from} → ${t.to}`)
                recordDecision(source, dim, `attribute ${t.name}: took the target's type ${t.to} (its values are cleared)`, { kind: 'attribute', element: t.name, choice: 'take', user })
            }
            const confirmed = (await settings.get(target, { ideToken }).catch(() => ({})))?.attributeValues?.[dim] ?? []
            if (confirmed.length) {
                const types = new Map([...da ?? [], ...pa ?? []].map(a => [a.Name, String(a.Type ?? 'S').toUpperCase().startsWith('N') ? 'N' : 'S']))
                const devNames = new Set((d.elements ?? []).map(elName).filter(Boolean))
                let copied = 0
                for (const el of (p.elements ?? []).map(elName).filter(Boolean)) {
                    if (!devNames.has(el)) continue
                    let vals = {}
                    try { vals = await prod.getElementAttributeValues(dim, el) } catch { continue }
                    for (const attr of confirmed) {
                        if (!(attr in vals)) continue
                        await dev.writeElementAttribute(dim, el, attr, vals[attr], types.get(attr) ?? 'S')
                        copied++
                    }
                }
                if (copied) changed.push(`values for ${confirmed.join(', ')} (${copied} cells)`)
            }
        } catch (e) {
            skipped.push({ dimension: dim, what: 'attributes', why: e.message })
        }

        if (changed.length) {
            cl.writeLog({ server: source, action: 'DIMENSION_UPDATED', objectType: 'dimension', objectName: dim, detail: changed.join('; '), user })
            applied.push({ dimension: dim, applied: changed })
        }
    }
    return { ok: true, source, target, applied, skipped }
}

module.exports = { diffDimension, undecidedDecisions, typeChangesToApply, diffAttributeDefinitions, suggestAttributeWrites, planRefresh, applyRefresh }
