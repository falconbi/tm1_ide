'use strict'

// ── Refresh DEV from PROD: alternate hierarchies ────────────────────────────
// A dimension can hold more than one hierarchy: the main one (named after the
// dimension) and named alternates, plus TM1's own 'Leaves'. The dimension refresh
// covers the main hierarchy; this covers the alternates, which is where reporting
// rollups usually live.
//
// Two cases, and they are not the same:
//   * a hierarchy only the target has — a GAP: created on DEV with its members and
//     edges, so the next deploy does not add it again.
//   * one on both sides that differs — a CONFLICT with no default ("take the
//     target's" or "keep DEV's"), exactly like a view, subset, delete or move.
//
// Never deleted here: an element DEV has and the target does not is REPORTED
// (`onlyDev`) and kept — the deploy carries it, which is the honest direction for
// a piece of work someone did on DEV. (The old comment said removing an element
// from an alternate hierarchy removes it from the dimension. The lab on 24 Nov,
// v11, showed it removes it from that hierarchy ONLY — a leaf remains an element
// of the dimension. Deleting is still never done here.)

const { makeClient } = require('./adapter-registry')
const { TM1Client } = require('./tm1-client')
const { odataKey } = require('./odata-key')
const cl = require('./change-log')
const { originOf, ORIGIN } = require('./refresh-origins')
const { baseHierarchy } = require('./deploy-base')

// One comparable string for a hierarchy's shape (members with their types, edges
// with their weights), so three copies compare as three strings.
const canonHier = (h) => {
    if (!h) return null
    const els = [...(h.elements ?? [])].map(e => `${elName(e)}=${elType(e)}`).sort()
    const eds = [...(h.edges ?? [])].map(e => `${e.ParentName ?? e.parent}::${e.ComponentName ?? e.child}=${Number(e.Weight ?? e.weight ?? 1)}`).sort()
    return `${els.join(',')}|${eds.join(',')}`
}
// The baseline's Maps → the same shape readHierarchy returns, so one comparator
// serves all three copies.
const asList = (b) => b && {
    elements: [...b.elements].map(([Name, Type]) => ({ Name, Type })),
    edges: [...b.edges].map(([k, Weight]) => { const [ParentName, ComponentName] = k.split('::'); return { ParentName, ComponentName, Weight } }),
}
const baseNames = (reader, dim) => {
    const prefix = `dimensions/${dim}.hierarchies/`
    try {
        return (reader.list ? reader.list(prefix) : [])
            .filter(f => f.endsWith('.json') && !f.includes('.subsets/'))
            .map(f => f.slice(prefix.length).replace(/\.json$/i, ''))
            .filter(h => isAlternate(dim, h))
    } catch { return [] }
}

const elName = (e) => e?.Name ?? e?.name ?? null
const TYPE = { N: 'Numeric', S: 'String', A: 'Alias', C: 'Consolidated' }
const elType = (e) => {
    const t = e?.Type ?? e?.type
    return typeof t === 'string' ? (TYPE[t] ?? t) : t == null ? 'Numeric' : t
}

// The main hierarchy and TM1's automatic one are not "alternate hierarchies".
const isAlternate = (dim, hier) => String(hier) !== String(dim) && String(hier) !== 'Leaves'

async function readHierarchy(tm1, dim, hier) {
    const [elements, edges] = await Promise.all([
        tm1.getElements(dim, hier).catch(() => []),
        tm1.getEdges(dim, hier).catch(() => []),
    ])
    return { elements, edges }
}

// Pure: what the target's hierarchy has that DEV's does not, plus the edges DEV
// would have to lose for the two to match.
function diffHierarchy(prod = {}, dev = {}) {
    const pEls = new Map((prod.elements ?? []).map(e => [elName(e), elType(e)]).filter(([n]) => n))
    const dEls = new Map((dev.elements ?? []).map(e => [elName(e), elType(e)]).filter(([n]) => n))
    const addElements = [...pEls.entries()].filter(([n]) => !dEls.has(n)).map(([name, type]) => ({ name, type }))
    // Elements DEV has that the target does not. Kept, never deleted (see above).
    const onlyDev = [...dEls.keys()].filter(n => !pEls.has(n))
    const typeChanges = [...pEls.entries()]
        .filter(([n, t]) => dEls.has(n) && dEls.get(n) !== t)
        .map(([name, to]) => ({ name, from: dEls.get(name), to }))

    const key = (e) => `${e.ParentName ?? e.parent}::${e.ComponentName ?? e.child}`
    const pEdges = new Map((prod.edges ?? []).map(e => [key(e), e]))
    const dEdges = new Map((dev.edges ?? []).map(e => [key(e), e]))
    const addEdges = [...pEdges.entries()].filter(([k]) => !dEdges.has(k))
        .map(([, e]) => ({ parent: e.ParentName ?? e.parent, child: e.ComponentName ?? e.child, weight: Number(e.Weight ?? e.weight ?? 1) }))
    const removeEdges = [...dEdges.entries()].filter(([k]) => !pEdges.has(k))
        .map(([, e]) => ({ parent: e.ParentName ?? e.parent, child: e.ComponentName ?? e.child }))

    // A child both sides have, under exactly one parent each, with a different
    // parent or weight: a MOVE, not a pair of edits.
    const parentsOf = (map, child) => [...map.values()]
        .filter(e => (e.ComponentName ?? e.child) === child)
        .map(e => ({ parent: e.ParentName ?? e.parent, weight: Number(e.Weight ?? e.weight ?? 1) }))
    const moves = []
    for (const child of new Set([...pEdges.values()].map(e => e.ComponentName ?? e.child))) {
        const onProd = parentsOf(pEdges, child)
        const onDev = parentsOf(dEdges, child)
        if (onProd.length !== 1 || onDev.length !== 1) continue
        if (onProd[0].parent === onDev[0].parent && onProd[0].weight === onDev[0].weight) continue
        moves.push({ child, toParent: onProd[0].parent, fromParent: onDev[0].parent, toWeight: onProd[0].weight })
    }
    const moved = new Set(moves.map(m => m.child))
    const differs = addElements.length > 0 || addEdges.length > 0 || removeEdges.length > 0 || moves.length > 0 || typeChanges.length > 0
    // A moved child is neither an addition nor a removal: its single edge is replaced.
    return {
        differs, addElements, onlyDev, typeChanges, moves,
        addEdges: addEdges.filter(e => !moved.has(e.child)),
        removeEdges: removeEdges.filter(e => !moved.has(e.child)),
    }
}

// ── Planning ────────────────────────────────────────────────────────────────

async function planHierarchies(source, target, { ideToken, reader = null } = {}) {
    const dev = new TM1Client(source, makeClient(source, ideToken))
    const prod = new TM1Client(target, makeClient(target, ideToken))
    const items = []
    for (const dim of (await prod.getModelDimensions().catch(() => [])).map(d => d?.Name ?? d).filter(Boolean)) {
        const prodHiers = (await prod.getHierarchies(dim).catch(() => [])).filter(h => isAlternate(dim, h))
        const devHiers = new Set(await dev.getHierarchies(dim).catch(() => []))
        const inBase = reader ? baseNames(reader, dim) : []
        if (!prodHiers.length && !inBase.length) continue
        const names = new Set([...prodHiers, ...inBase])
        for (const hier of names) {
            const p = prodHiers.includes(hier) ? await readHierarchy(prod, dim, hier) : null
            const d = devHiers.has(hier) ? await readHierarchy(dev, dim, hier) : null
            const b = reader && inBase.includes(hier) ? baseHierarchy(reader, dim, hier) : (reader ? null : undefined)
            if (!p && !d) continue
            const bl = canonHier(asList(b))
            const origin = b === undefined
                ? ORIGIN.UNKNOWN
                : originOf(bl, canonHier(p), canonHier(d), { value: { base: bl, prod: canonHier(p), dev: canonHier(d) } })
            if ([ORIGIN.UNCHANGED, ORIGIN.BOTH, ORIGIN.DEV_ADDED, ORIGIN.DEV_CHANGED, ORIGIN.DEV_REMOVED].includes(origin)) continue
            const diff = p && d ? diffHierarchy(p, d) : null
            const parts = []
            if (origin === ORIGIN.TARGET_ADDED) parts.push('new on the target since the last deploy')
            else if (origin === ORIGIN.TARGET_REMOVED) parts.push('removed on the target since the last deploy')
            else if (origin === ORIGIN.CONFLICT) parts.push('changed on both sides')
            else if (origin === ORIGIN.TARGET_CHANGED) parts.push('changed on the target since the last deploy')
            if (diff?.addElements.length) parts.push(`+${diff.addElements.length} element${diff.addElements.length === 1 ? '' : 's'}`)
            if (diff?.addEdges.length) parts.push(`+${diff.addEdges.length} edge${diff.addEdges.length === 1 ? '' : 's'}`)
            if (diff?.moves.length) parts.push(`${diff.moves.length} moved`)
            if (diff?.removeEdges.length) parts.push(`${diff.removeEdges.length} edge${diff.removeEdges.length === 1 ? '' : 's'} only on DEV`)
            items.push({
                type: 'hierarchy', dimension: dim, name: hier, origin,
                onTarget: !!p, onDev: !!d,
                prodValue: canonHier(p), devValue: canonHier(d),
                adding: origin === ORIGIN.TARGET_ADDED,
                removing: origin === ORIGIN.TARGET_REMOVED,
                differs: true, parts,
                elements: p?.elements?.length ?? 0, edges: p?.edges?.length ?? 0,
                onlyDev: diff?.onlyDev?.length ?? 0,
                choice: origin === ORIGIN.TARGET_ADDED || origin === ORIGIN.TARGET_CHANGED ? 'take' : null,
            })
        }
    }
    return items
}

// ── Applying ────────────────────────────────────────────────────────────────

// Apply the chosen hierarchies to DEV. Only 'take' writes; 'keep' records the
// decision. Everything that fails is an ERROR with TM1's message, never a skip.
async function applyHierarchies(dev, prod, { hierarchies = [], source, target, user, log = cl.writeLog, plan = null } = {}) {
    const changed = []
    const errors = []
    const decisions = []

    const known = new Map((plan ?? []).map(x => [`hierarchy:${x.name}:${x.dimension}`, x]))
    for (const h of hierarchies) {
        const label = `hierarchy ${h.name} (${h.dimension})`
        if (plan && !known.has(`hierarchy:${h.name}:${h.dimension}`)) {
            errors.push({ what: label, why: 'not in the plan against the current baseline — rebuild the plan' })
            continue
        }
        const item = known.get(`hierarchy:${h.name}:${h.dimension}`)
        if (item?.removing) {
            if (h.choice === 'delete') {
                try {
                    await dev.deleteHierarchy(h.dimension, h.name)
                    changed.push({ label, text: 'deleted on DEV too (the target removed it since the last deploy)' })
                    try { log({ server: source, action: 'HIERARCHY_DELETED', objectType: 'dimension', objectName: h.dimension, detail: h.name, beforeState: { dimension: h.dimension, hierarchy: h.name }, user }) } catch { /* evidence only */ }
                } catch (e) { errors.push({ what: label, why: e.message }) }
            } else if (h.choice === 'keep') {
                const text = `kept ${source}'s hierarchy — the next deploy puts it back on the target`
                decisions.push({ label, choice: 'keep', text })
                try { log({ server: source, action: 'REFRESH_DECISION', objectType: 'decision', objectName: label, detail: text, user, afterState: { kind: 'hierarchy', choice: 'keep', parent: h.dimension } }) } catch { /* evidence only */ }
            } else {
                errors.push({ what: label, why: 'no choice made — the target removed it: delete it on DEV too, or keep it' })
            }
            continue
        }
        if (!['take', 'keep'].includes(h.choice)) {
            errors.push({ what: label, why: 'no choice made — say whether DEV takes the target\'s hierarchy or keeps its own' })
            continue
        }
        if (h.choice === 'keep') {
            const text = `kept ${source}'s hierarchy — the next deploy carries it to the target`
            decisions.push({ label, choice: 'keep', text })
            try {
                log({ server: source, action: 'REFRESH_DECISION', objectType: 'decision', objectName: label, detail: text, user, afterState: { kind: 'hierarchy', choice: 'keep', parent: h.dimension } })
            } catch { /* the decision stands; the log is evidence */ }
            continue
        }
        try {
            const p = await readHierarchy(prod, h.dimension, h.name)
            if (!p.elements.length) throw new Error('not on the target any more')
            const onDev = (await dev.getHierarchies(h.dimension).catch(() => [])).includes(h.name)
            const d = onDev ? await readHierarchy(dev, h.dimension, h.name) : { elements: [], edges: [] }
            const diff = diffHierarchy(p, d)
            const notes = []

            if (!onDev) {
                await dev.createHierarchy(h.dimension, h.name)
                notes.push('created')
            }
            for (const e of diff.addElements) {
                try {
                    await dev.addElementAt(h.dimension, e.name, e.type, h.name)
                } catch (err) {
                    // The element can already exist in the dimension (shared leaves are
                    // dimension-wide); the edge below puts it in this hierarchy.
                    if (!/already exists/i.test(err.message ?? '')) throw err
                }
                notes.push(`element ${e.name}`)
            }
            const moved = new Set()
            for (const m of diff.moves) {
                await dev.deleteEdge(h.dimension, m.fromParent, m.child, h.name).catch(() => {})
                await dev.addEdge(h.dimension, m.toParent, m.child, m.toWeight ?? 1, h.name)
                moved.add(m.child)
                notes.push(`move ${m.child}: ${m.fromParent} → ${m.toParent}`)
            }
            for (const e of diff.addEdges) {
                if (moved.has(e.child)) continue
                await dev.addEdge(h.dimension, e.parent, e.child, e.weight ?? 1, h.name)
                notes.push(`edge ${e.parent} → ${e.child}`)
            }
            // Edges the target does not have. Safe: this removes a rollup edge, never
            // an element (an element removal would take its values with it).
            for (const e of diff.removeEdges) {
                if (moved.has(e.child)) continue
                await dev.deleteEdge(h.dimension, e.parent, e.child, h.name)
                notes.push(`removed edge ${e.parent} → ${e.child}`)
            }
            for (const t of diff.typeChanges) {
                await dev.patch(
                    `Dimensions('${odataKey(h.dimension)}')/Hierarchies('${odataKey(h.name)}')/Elements('${odataKey(t.name)}')`,
                    { Type: t.to }
                )
                notes.push(`type ${t.name}: ${t.from} → ${t.to}`)
            }
            if (diff.onlyDev.length) {
                notes.push(`${diff.onlyDev.length} element${diff.onlyDev.length === 1 ? '' : 's'} only on ${source} kept (not deleted)`)
            }

            changed.push({ label, text: notes.join('; ') || 'already identical' })
            try {
                // The DIMENSION is the object a release ships (a hierarchy is a file
                // inside it), so the log names the dimension — naming the hierarchy
                // would leave the release without the file it belongs to.
                log({
                    server: source, action: onDev ? 'HIERARCHY_UPDATED' : 'HIERARCHY_CREATED',
                    objectType: 'dimension', objectName: h.dimension, detail: h.name,
                    afterState: { dimension: h.dimension, hierarchy: h.name, refreshedFrom: target ?? null }, user,
                })
            } catch { /* the write stands; the log is evidence */ }
        } catch (e) {
            errors.push({ what: label, why: e.message })
        }
    }
    return { changed, errors, decisions }
}

module.exports = { planHierarchies, applyHierarchies, diffHierarchy, readHierarchy, isAlternate }
