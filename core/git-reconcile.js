'use strict'

// ── Git reconcile (#6) — after a git pull ───────────────────────────────────
// TM1 Git doesn't propagate deletes or attribute values, so after the pull the
// IDE reconciles them. **Scoped strictly to the change set's manifest** — the
// manifest (change_log.getSessionManifest) says what was deleted and which
// dimensions' values changed. Nothing is inferred from the whole source, so a
// deploy can never delete a PROD-only object or clobber a PROD-maintained
// attribute that the change set didn't touch.

const { makeClient } = require('./adapter_registry')

const esc = s => String(s).replace(/'/g, "''")

// Delete exactly the objects the change set deleted (`deletes` = [{type,name}]),
// and only if they are still present on the target. Safe types only; anything
// needing cube/dim context is flagged, never guessed.
async function reconcileDeletes(source, target, { ideToken, deletes = [] } = {}) {
    const tc = makeClient(target, ideToken)
    const out = { deleted: [], flagged: [] }
    if (!deletes?.length) return out
    try {
        const tgtProcs = new Set(await tc.getProcesses())
        for (const d of deletes) {
            if (d.type !== 'process') {
                out.flagged.push({ type: d.type, name: d.name, error: 'not auto-applied — needs cube/dimension context' })
                continue
            }
            if (!tgtProcs.has(d.name)) {
                out.flagged.push({ type: d.type, name: d.name, error: 'not present on target (already gone)' })
                continue
            }
            try { await tc.deleteProcess(d.name); out.deleted.push({ type: d.type, name: d.name }) }
            catch (e) { out.flagged.push({ type: d.type, name: d.name, error: e.message }) }
        }
    } catch (e) { out.error = e.message }
    return out
}

// Copy attribute values ONLY for the given dimensions (the change set's touched
// dims; default: nothing). Respects numeric vs string attribute types.
async function syncAttributeValues(source, target, { ideToken, dims = [] } = {}) {
    const sc = makeClient(source, ideToken)
    const tc = makeClient(target, ideToken)
    const out = { dims: [], errors: [], flagged: [] }
    if (!dims?.length) return out

    for (const dim of dims) {
        const attrDim = `}ElementAttributes_${dim}`
        try {
            // attribute name → type (numeric | string)
            let attrTypes = {}
            try {
                const a = await sc.getElementAttributes(dim)
                for (const x of a) attrTypes[x.Name] = x.Type === 'Numeric' ? 'N' : 'S'
            } catch { attrTypes = {} }
            const attrNames = Object.keys(attrTypes)
            if (!attrNames.length) { out.flagged.push({ dim, error: 'no attributes on source' }); continue }
            const els = ((await sc.get(`Dimensions('${esc(dim)}')/Hierarchies('${esc(dim)}')/Elements?$select=Name`)).value ?? []).map(e => e.Name)
            if (!els.length) { out.flagged.push({ dim, error: 'no elements on source' }); continue }

            const updates = []
            for (const el of els) {
                try {
                    const attrs = await sc.getElementAttributeValues(dim, el)
                    for (const attrName of attrNames) {
                        const v = attrs[attrName]
                        if (v == null || typeof v === 'object') continue
                        updates.push({
                            dimElemPairs: [
                                { dim: attrDim, element: attrName },
                                { dim, element: el },
                            ],
                            value: attrTypes[attrName] === 'N' ? Number(v) : String(v),
                        })
                    }
                } catch { /* skip unreadable element */ }
            }
            if (updates.length) {
                await tc.updateCells(attrDim, updates)
                out.dims.push(dim)
            }
        } catch (e) { out.errors.push({ dim, error: e.message }) }
    }
    return out
}

// Full reconcile after a git pull: deletes + attribute values, both scoped to
// the change set's manifest.
async function reconcile(source, target, { ideToken, deletes = [], dims = [] } = {}) {
    const out = {}
    try { out.deletes = await reconcileDeletes(source, target, { ideToken, deletes }) }
    catch (e) { out.deletes = { error: e.message } }
    try { out.attributeValues = await syncAttributeValues(source, target, { ideToken, dims }) }
    catch (e) { out.attributeValues = { error: e.message } }
    return out
}

module.exports = { reconcile, reconcileDeletes, syncAttributeValues }