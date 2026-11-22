'use strict'

// ── One dimension, three ways ───────────────────────────────────────────────
// The dimension refresh used to compare PROD with DEV and call every difference
// "a change PROD made". With the baseline (the release the target last received)
// each element, edge, move and type change has one honest origin, and only the
// target's own changes are offered.
//
//   PROD added it        → bring across (ticked)
//   PROD removed it      → "delete on DEV too?" (unticked)
//   DEV removed it       → NOT offered (Review already reports the removal)
//   DEV added it         → not a refresh question
//   both changed, unlike → conflict, no default
//
// Pure classification + the apply that follows it, so a plan row and the write it
// authorises cannot disagree.

const { ORIGIN, originOf } = require('./refresh-origins')
const { odataKey } = require('./odata-key')

const elName = (e) => e?.Name ?? e?.name ?? null
const TYPE = { N: 'Numeric', S: 'String', A: 'Alias', C: 'Consolidated' }
const elType = (e) => {
    const t = e?.Type ?? e?.type
    return typeof t === 'string' ? (TYPE[t] ?? t) : t == null ? 'Numeric' : t
}
const edgeKey = (e) => `${e.ParentName ?? e.parent}::${e.ComponentName ?? e.child}`

// base × prod × dev → what to offer. `base` is { elements: Map(name→type),
// edges: Map(key→weight) } or null when there is no baseline.
function classifyDimension(base, prod, dev) {
    const out = {
        addElements: [], removeElements: [], devRemoved: [], devAdded: [],
        typeChanges: [], typeConflicts: [],
        addEdges: [], removeEdges: [], weightChanges: [],
        moves: [], moveConflicts: [], devMoved: [],
        unknown: !base,
    }
    const bEls = base ? base.elements : null
    const pEls = new Map((prod.elements ?? []).map(e => [elName(e), elType(e)]).filter(([n]) => n))
    const dEls = new Map((dev.elements ?? []).map(e => [elName(e), elType(e)]).filter(([n]) => n))
    const names = new Set([...(bEls ? bEls.keys() : []), ...pEls.keys(), ...dEls.keys()])
    for (const n of names) {
        const p = pEls.has(n) ? pEls.get(n) : null
        const d = dEls.has(n) ? dEls.get(n) : null
        if (!bEls) {
            // No baseline: show it, tick nothing, and let apply refuse.
            if (p && !d) out.addElements.push({ name: n, type: p, origin: ORIGIN.UNKNOWN })
            else if (!p && d) out.removeElements.push({ name: n, origin: ORIGIN.UNKNOWN })
            else if (p && d && p !== d) out.typeChanges.push({ name: n, from: d, to: p, origin: ORIGIN.UNKNOWN })
            continue
        }
        const b = bEls.has(n) ? bEls.get(n) : null
        const origin = originOf(b, p, d, { value: { base: b, prod: p, dev: d } })
        if (origin === ORIGIN.TARGET_ADDED) out.addElements.push({ name: n, type: p, origin })
        else if (origin === ORIGIN.TARGET_REMOVED) out.removeElements.push({ name: n, origin })
        else if (origin === ORIGIN.DEV_REMOVED) out.devRemoved.push({ name: n, origin })
        else if (origin === ORIGIN.DEV_ADDED) out.devAdded.push({ name: n, origin })
        else if (origin === ORIGIN.TARGET_CHANGED) out.typeChanges.push({ name: n, from: d, to: p, origin })
        else if (origin === ORIGIN.CONFLICT) out.typeConflicts.push({ name: n, base: b, prod: p, dev: d, origin })
        // BOTH / DEV_CHANGED / UNCHANGED: nothing to do
    }

    // Edges, then moves (a child with one parent on each side, and a different one).
    const bEdges = base ? base.edges : null
    const pEdges = new Map((prod.edges ?? []).map(e => [edgeKey(e), e]))
    const dEdges = new Map((dev.edges ?? []).map(e => [edgeKey(e), e]))
    const parentsOf = (map, child) => [...map.values()]
        .filter(e => (e.ComponentName ?? e.child) === child)
        .map(e => ({ parent: e.ParentName ?? e.parent, weight: Number(e.Weight ?? e.weight ?? 1) }))
    // The baseline holds edges as key('P::C') → weight, not as edge objects.
    const baseParentsOf = (child) => !bEdges ? [] : [...bEdges.entries()]
        .filter(([k]) => k.split('::')[1] === child)
        .map(([k, w]) => ({ parent: k.split('::')[0], weight: Number(typeof w === 'object' ? (w?.Weight ?? 1) : (w ?? 1)) }))

    const movedChildren = new Set()
    for (const child of new Set([...pEdges.values()].map(e => e.ComponentName ?? e.child))) {
        const onProd = parentsOf(pEdges, child)
        const onDev = parentsOf(dEdges, child)
        const onBase = baseParentsOf(child)
        if (onProd.length !== 1 || onDev.length !== 1) continue
        if (!bEdges && onProd[0].parent === onDev[0].parent) continue
        if (onProd[0].parent === onDev[0].parent && onProd[0].weight === onDev[0].weight) continue
        const baseParent = onBase.length === 1 ? onBase[0].parent : null
        const origin = bEdges
            ? originOf(baseParent, onProd[0].parent, onDev[0].parent, {
                value: { base: baseParent, prod: onProd[0].parent, dev: onDev[0].parent },
            })
            : ORIGIN.UNKNOWN
        const move = {
            child, origin,
            toParent: onProd[0].parent, toWeight: onProd[0].weight,
            fromParent: onDev[0].parent, fromWeight: onDev[0].weight,
        }
        if (origin === ORIGIN.TARGET_CHANGED || origin === ORIGIN.TARGET_ADDED) { out.moves.push(move); movedChildren.add(child) }
        else if (origin === ORIGIN.CONFLICT) { out.moveConflicts.push(move); movedChildren.add(child) }
        else if (origin === ORIGIN.DEV_CHANGED) { out.devMoved.push(move); movedChildren.add(child) }
        // DEV_REMOVED (DEV re-parented... ) handled as an edge below
    }

    const keys = new Set([...(bEdges ? bEdges.keys() : []), ...pEdges.keys(), ...dEdges.keys()])
    for (const k of keys) {
        const [parent, child] = k.split('::')
        if (movedChildren.has(child)) continue
        const bw = bEdges?.has(k) ? Number(typeof bEdges.get(k) === 'object' ? (bEdges.get(k).Weight ?? 1) : bEdges.get(k)) : null
        const pw = pEdges.has(k) ? Number(pEdges.get(k).Weight ?? pEdges.get(k).weight ?? 1) : null
        const dw = dEdges.has(k) ? Number(dEdges.get(k).Weight ?? dEdges.get(k).weight ?? 1) : null
        const origin = bEdges
            ? originOf(bw, pw, dw, { value: { base: bw, prod: pw, dev: dw } })
            : ORIGIN.UNKNOWN
        if (origin === ORIGIN.TARGET_ADDED) out.addEdges.push({ parent, child, weight: pw ?? 1, origin })
        else if (origin === ORIGIN.TARGET_REMOVED) out.removeEdges.push({ parent, child, origin })
        else if (origin === ORIGIN.TARGET_CHANGED) out.weightChanges.push({ parent, child, from: dw, to: pw, origin })
        // DEV_* and BOTH: nothing to do
    }
    return out
}

// How many of a kind, for the one-line summary (d: thousands of grey lines help
// nobody).
function summarise(c) {
    const rows = []
    if (c.addElements.length) rows.push({ origin: ORIGIN.TARGET_ADDED, what: 'element', count: c.addElements.length })
    if (c.addEdges.length) rows.push({ origin: ORIGIN.TARGET_ADDED, what: 'edge', count: c.addEdges.length })
    if (c.moves.length) rows.push({ origin: ORIGIN.TARGET_CHANGED, what: 'move', count: c.moves.length })
    if (c.removeElements.length) rows.push({ origin: ORIGIN.TARGET_REMOVED, what: 'element', count: c.removeElements.length })
    if (c.removeEdges.length) rows.push({ origin: ORIGIN.TARGET_REMOVED, what: 'edge', count: c.removeEdges.length })
    if (c.typeChanges.length) rows.push({ origin: ORIGIN.TARGET_CHANGED, what: 'element type', count: c.typeChanges.length })
    if (c.devRemoved.length) rows.push({ origin: ORIGIN.DEV_REMOVED, what: 'element', count: c.devRemoved.length })
    if (c.devAdded.length) rows.push({ origin: ORIGIN.DEV_ADDED, what: 'element', count: c.devAdded.length })
    if (c.devMoved.length) rows.push({ origin: ORIGIN.DEV_CHANGED, what: 'move', count: c.devMoved.length })
    if (c.typeConflicts.length) rows.push({ origin: ORIGIN.CONFLICT, what: 'element type', count: c.typeConflicts.length })
    if (c.moveConflicts.length) rows.push({ origin: ORIGIN.CONFLICT, what: 'move', count: c.moveConflicts.length })
    return rows
}

module.exports = { classifyDimension, summarise }

// ── Applying one dimension ──────────────────────────────────────────────────
// Only what the classification OFFERED can be written. A choice that is not in
// this dimension's real-base plan (a stale screen, a plan made against another
// commit) is an error, never a silent application.
const readStrict = async (tm1, dim) => {
    const [elements, edges] = await Promise.all([tm1.getElements(dim, dim), tm1.getEdges(dim, dim)])
    return { elements, edges }
}

async function applyDimension(dev, prod, baseDoc, dim, want = {}, { record } = {}) {
    const [p, d] = await Promise.all([readStrict(prod, dim), readStrict(dev, dim)])
    const c = classifyDimension(baseDoc, p, d)
    const changed = []
    const errors = []
    const decisions = []
    const need = []

    const edgeKeyOf = (e) => `${e.parent}::${e.child}`
    for (const e of c.removeElements) if (!['delete', 'keep'].includes(want.deletes?.[e.name])) need.push(`element ${e.name}`)
    for (const e of c.removeEdges) if (!['delete', 'keep'].includes(want.deletes?.[edgeKeyOf(e)])) need.push(`edge ${e.parent} → ${e.child}`)
    for (const m of c.moveConflicts) if (!['take', 'keep'].includes(want.moves?.[m.child])) need.push(`move ${m.child} (both sides moved it)`)
    if (need.length) {
        throw Object.assign(new Error(
            `Refused: decide these before refreshing ${dim} — ${need.join(', ')}. ` +
            `Unchecked means DEV keeps its version and the next deploy carries it.`
        ), { refused: true, needsDecision: need })
    }

    for (const e of c.addElements) {
        await dev.addElementAt(dim, e.name, e.type, dim)
        changed.push(`element ${e.name}`)
    }
    for (const m of c.moves) {
        if (want.moves?.[m.child] === 'keep') {
            record?.(`move ${m.child}: kept DEV's parent ${m.fromParent ?? '(none)'} — the next deploy restores it on the target`, { kind: 'move', element: m.child, choice: 'keep' })
            continue
        }
        if (m.fromParent) await dev.deleteEdge(dim, m.fromParent, m.child, dim).catch(() => {})
        await dev.addEdge(dim, m.toParent, m.child, m.toWeight ?? 1, dim)
        changed.push(`move ${m.child}: ${m.fromParent ?? '(none)'} → ${m.toParent}`)
        record?.(`move ${m.child}: took the target's parent ${m.toParent}`, { kind: 'move', element: m.child, choice: 'take' })
    }
    const moved = new Set(c.moves.map(m => m.child))
    for (const e of c.addEdges) {
        if (moved.has(e.child)) continue
        await dev.addEdge(dim, e.parent, e.child, e.weight ?? 1, dim)
        changed.push(`edge ${e.parent} → ${e.child}`)
    }
    for (const w of c.weightChanges) {
        await dev.updateEdgeWeight(dim, w.parent, w.child, w.to, dim)
        changed.push(`weight ${w.parent} → ${w.child}: ${w.from} → ${w.to}`)
    }
    for (const e of c.removeElements) {
        const choice = want.deletes?.[e.name]
        if (choice === 'keep') {
            record?.(`delete ${e.name}: kept on DEV — the next deploy restores it on the target with no data`, { kind: 'delete', element: e.name, choice: 'keep' })
            continue
        }
        await dev.deleteElement(dim, e.name, dim)
        changed.push(`removed ${e.name}`)
        record?.(`delete ${e.name}: deleted on DEV too (its values are gone)`, { kind: 'delete', element: e.name, choice: 'delete' })
    }
    for (const e of c.removeEdges) {
        const choice = want.deletes?.[edgeKeyOf(e)]
        if (choice === 'keep') {
            record?.(`edge ${e.parent} → ${e.child}: kept on DEV (the target removed it since the last deploy)`, { kind: 'delete', element: edgeKeyOf(e), choice: 'keep' })
            continue
        }
        await dev.deleteEdge(dim, e.parent, e.child, dim)
        changed.push(`removed edge ${e.parent} → ${e.child}`)
        record?.(`edge ${e.parent} → ${e.child}: removed on DEV too`, { kind: 'delete', element: edgeKeyOf(e), choice: 'delete' })
    }
    for (const t of [...c.typeChanges, ...c.typeConflicts]) {
        if (!want.allowTypeChanges) continue
        await dev.patch(
            `Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(dim)}')/Elements('${odataKey(t.name)}')`,
            { Type: t.to ?? t.prod }
        )
        changed.push(`type ${t.name}: ${t.from ?? t.dev} → ${t.to ?? t.prod}`)
    }
    return { changed, errors, decisions, classified: c }
}

module.exports = { classifyDimension, summarise, applyDimension }
