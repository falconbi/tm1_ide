'use strict'

// ── Git reconcile (#6) — after a git pull ───────────────────────────────────
// TM1 Git doesn't propagate deletes or attribute values, so after the pull the
// IDE reconciles them. **Scoped strictly to the change set's manifest** — the
// manifest (change-log.getSessionManifest) says what was deleted and which
// dimensions' values changed. Nothing is inferred from the whole source, so a
// deploy can never delete a PROD-only object or clobber a PROD-maintained
// attribute that the change set didn't touch.

const { makeClient } = require('./adapter-registry')
const { odataKey } = require('./odata-key')

// Delete exactly the objects the change set deleted (`deletes` = [{type,name}]),
// and only if they are still present on the target. Safe types only; anything
// needing cube/dim context is flagged, never guessed.
async function reconcileDeletes(source, target, { ideToken, deletes = [] } = {}) {
    const tc = makeClient(target, ideToken)
    // `alreadyGone` is a success, not a failure: a change set may delete something
    // the target never had (e.g. an object added and removed since the last
    // deploy). Flagging it made a clean deploy look unclean — controlOk false, so
    // the change set was never marked deployed and stayed "ready to ship".
    const out = { deleted: [], flagged: [], alreadyGone: [], failed: [] }
    if (!deletes?.length) return out
    try {
        const [tgtProcs, tgtDims, tgtCubes, tgtChores] = await Promise.all([
            tc.getProcesses().catch(() => []),
            tc.getDimensions().then(list => list.map(d => d?.Name ?? d)).catch(() => []),
            tc.getCubes().then(list => list.map(c => c?.Name ?? c)).catch(() => []),
            tc.getChores ? tc.getChores().then(list => (list ?? []).map(c => c?.Name ?? c)).catch(() => []) : Promise.resolve([]),
        ])
        const present = {
            process: new Set(tgtProcs ?? []),
            dimension: new Set((tgtDims ?? []).filter(Boolean)),
            cube: new Set((tgtCubes ?? []).filter(Boolean)),
            chore: new Set((tgtChores ?? []).filter(Boolean)),
        }
        // Views and subsets need their parent to list, so they are checked on demand.
        // A listing that FAILS is not evidence of absence — only a successful listing
        // without the name is.
        const viewCache = new Map()
        const subsetCache = new Map()
        const gone = async (type, name, parent, hierarchy) => {
            if (type === 'view') {
                if (typeof tc.getViews !== 'function') return false     // cannot tell: try the delete
                if (!viewCache.has(parent)) viewCache.set(parent, await tc.getViews(parent).then(v => new Set((v ?? []).map(x => x?.name ?? x))).catch(() => null))
                const set = viewCache.get(parent)
                return set ? !set.has(name) : false
            }
            if (type === 'subset') {
                if (typeof tc.getSubsets !== 'function') return false   // cannot tell: try the delete
                const key = `${parent}|${hierarchy ?? parent}`
                if (!subsetCache.has(key)) subsetCache.set(key, await tc.getSubsets(parent, hierarchy ?? parent).then(v => new Set((v ?? []).map(x => x?.Name ?? x))).catch(() => null))
                const set = subsetCache.get(key)
                return set ? !set.has(name) : false
            }
            return false
        }
        // Dependency order, dependencies first: a chore holds processes, a process
        // and a cube hold dimensions, a view holds a cube, a subset its dimension.
        // Deleting a process while a chore still uses it is refused by TM1 — that
        // refusal used to leave the process behind, and the deploy said "skipped".
        const order = { view: 0, subset: 1, chore: 2, process: 3, cube: 4, dimension: 5 }
        for (const d of [...deletes].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))) {
            try {
                // Already absent on the target: nothing to do, and nothing wrong.
                if (present[d.type] && !present[d.type].has(d.name)) {
                    out.alreadyGone.push({ type: d.type, name: d.name })
                    continue
                }
                if (d.type === 'process') {
                    await tc.deleteProcess(d.name)
                } else if (d.type === 'subset') {
                    const dim = d.parent ?? d.detail
                    if (!dim) throw new Error('subset delete needs its dimension')
                    // The pull may have removed it already — that is success, not
                    // "can not be found" reported as a failed delete.
                    if (await gone('subset', d.name, dim, d.hierarchy)) { out.alreadyGone.push({ type: d.type, name: d.name }); continue }
                    await tc.deleteSubset(dim, d.name, d.hierarchy ?? dim)
                } else if (d.type === 'view') {
                    const cube = d.parent ?? d.detail
                    if (!cube) throw new Error('view delete needs its cube')
                    if (await gone('view', d.name, cube)) { out.alreadyGone.push({ type: d.type, name: d.name }); continue }
                    await tc.deleteView(cube, d.name)
                } else if (d.type === 'chore') {
                    await tc.deleteChore(d.name)
                } else if (d.type === 'cube') {
                    await tc.deleteCube(d.name)
                } else if (d.type === 'dimension') {
                    await tc.deleteDimension(d.name)
                } else {
                    out.flagged.push({ type: d.type, name: d.name, error: 'not auto-applied — needs cube/dimension context' })
                    continue
                }
                out.deleted.push({ type: d.type, name: d.name })
            } catch (e) {
                // A delete that failed is a FAILURE (it leaves the target wrong),
                // reported as such — never merely "skipped".
                const failure = { type: d.type, name: d.name, error: e.message }
                out.flagged.push(failure)
                out.failed = [...(out.failed ?? []), failure]
            }
        }
    } catch (e) { out.error = e.message }
    return out
}

// Copy attribute values ONLY for the dimensions the change set touched, and
// where the log records the specific element/attribute, ONLY those pairs.
// A dimension the log only knows by name is copied wholesale and reported in
// `wholesale` (never silent). Respects numeric vs string attribute types.
async function syncAttributeValues(source, target, { ideToken, dims = [], attrElements = [] } = {}) {
    const sc = makeClient(source, ideToken)
    const tc = makeClient(target, ideToken)
    const out = { dims: [], wholesale: [], errors: [], flagged: [] }
    if (!dims?.length) return out

    const typeMap = async (dim) => {
        try {
            const a = await sc.getElementAttributes(dim)
            const m = {}
            for (const x of a) m[x.Name] = x.Type === 'Numeric' ? 'N' : 'S'
            return m
        } catch { return {} }
    }
    const push = (dim, element, attribute, value, attrTypes) => {
        const blank = value == null || value === ''
        return {
            dimElemPairs: [
                { dim: `}ElementAttributes_${dim}`, element: attribute },
                { dim, element },
            ],
            value: blank ? '' : (attrTypes[attribute] === 'N' ? Number(value) : String(value)),
        }
    }

    for (const dim of dims) {
        const attrDim = `}ElementAttributes_${dim}`
        try {
            const attrTypes = await typeMap(dim)
            const pairs = (attrElements ?? []).filter(p => p.dim === dim)
            if (pairs.length) {
                // Scoped: only the recorded element/attribute pairs.
                const updates = []
                for (const p of pairs) {
                    if (attrTypes[p.attribute] === undefined) continue
                    try {
                        const attrs = await sc.getElementAttributeValues(dim, p.element)
                        if (Object.prototype.hasOwnProperty.call(attrs, p.attribute) && typeof attrs[p.attribute] !== 'object') {
                            updates.push(push(dim, p.element, p.attribute, attrs[p.attribute], attrTypes))
                        }
                    } catch { /* skip unreadable */ }
                }
                if (updates.length) { await tc.updateCells(attrDim, updates); out.dims.push(dim) }
                continue
            }
            // Wholesale (the log only knew the dimension) — copied in full and reported.
            out.wholesale.push(dim)
            const attrNames = Object.keys(attrTypes)
            if (!attrNames.length) { out.flagged.push({ dim, error: 'no attributes on source' }); continue }
            const els = ((await sc.get(`Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(dim)}')/Elements?$select=Name`)).value ?? []).map(e => e.Name)
            if (!els.length) { out.flagged.push({ dim, error: 'no elements on source' }); continue }
            const updates = []
            for (const el of els) {
                try {
                    const attrs = await sc.getElementAttributeValues(dim, el)
                    for (const attrName of attrNames) {
                        const v = attrs[attrName]
                        if (typeof v === 'object' && v !== null) continue
                        updates.push(push(dim, el, attrName, v, attrTypes))
                    }
                } catch { /* skip unreadable element */ }
            }
            if (updates.length) { await tc.updateCells(attrDim, updates); out.dims.push(dim) }
        } catch (e) { out.errors.push({ dim, error: e.message }) }
    }
    return out
}

// Full reconcile after a git pull: deletes + attribute values, both scoped to
// the change set's manifest.
async function reconcile(source, target, { ideToken, deletes = [], dims = [], attrElements = [] } = {}) {
    const out = {}
    try { out.deletes = await reconcileDeletes(source, target, { ideToken, deletes }) }
    catch (e) { out.deletes = { error: e.message } }
    try { out.attributeValues = await syncAttributeValues(source, target, { ideToken, dims, attrElements }) }
    catch (e) { out.attributeValues = { error: e.message } }
    return out
}

module.exports = { reconcile, reconcileDeletes, syncAttributeValues }