'use strict'

// ── Git reconcile (#6) — after a git pull ───────────────────────────────────
// TM1 Git doesn't propagate deletes or attribute values, so after the pull the
// IDE reconciles them, reusing the existing deployer's approach (safe-type
// whole-object deletes; attribute values written to }ElementAttributes_<dim>).
// Cube/dimension deletes are never auto-applied (too destructive — flagged).

const { makeClient } = require('./adapter_registry')

const esc = s => String(s).replace(/'/g, "''")
const SAFE_DELETE_TYPES = { process: 'process', view: 'view', subset: 'subset', chore: 'chore' }

// Delete target objects that no longer exist on the source (safe types only).
async function reconcileDeletes(source, target, { ideToken } = {}) {
    const sc = makeClient(source, ideToken)
    const tc = makeClient(target, ideToken)
    const out = { deleted: [], flagged: [] }

    const srcProcesses = new Set(await sc.getProcesses())
    const tgtProcesses = new Set(await tc.getProcesses())
    for (const p of tgtProcesses) {
        if (!srcProcesses.has(p) && !p.startsWith('}')) {
            try { await tc.deleteProcess(p); out.deleted.push({ type: 'process', name: p }) }
            catch (e) { if (!/not\s*found|404|does not exist/i.test(e.message)) out.flagged.push({ type: 'process', name: p, error: e.message }) }
        }
    }

    // Views, subsets, chores need cube/dim context — flag rather than guess, for v1.
    out.flagged.push({ type: 'note', error: 'view/subset/chore deletes need their cube/dimension context — wired with the change-set manifest in the deploy flow' })

    return out
}

// Copy element attribute values from source to target for the given dimensions
// (all cube/dim attribute cubes on the source by default). Reuses the same
// updateCells(}ElementAttributes_<dim>) write the existing deployer uses.
async function syncAttributeValues(source, target, { ideToken, dims = null } = {}) {
    const sc = makeClient(source, ideToken)
    const tc = makeClient(target, ideToken)
    const out = { dims: [], errors: [] }

    let targetDims = dims
    if (!targetDims) {
        const d = await sc.get('Dimensions', { '$select': 'Name' })
        targetDims = (d.value ?? []).map(x => x.Name).filter(n => !n.startsWith('}'))
    }

    for (const dim of targetDims) {
        const attrDim = `}ElementAttributes_${dim}`
        // Attribute names = elements of the }ElementAttributes_<dim> dimension
        let attrNames = []
        try { attrNames = ((await sc.get(`Dimensions('${esc(attrDim)}')/Hierarchies('${esc(attrDim)}')/Elements?$select=Name`)).value ?? []).map(e => e.Name) } catch { continue }
        if (!attrNames.length) continue
        // Elements = elements of the dimension
        let els = []
        try { els = ((await sc.get(`Dimensions('${esc(dim)}')/Hierarchies('${esc(dim)}')/Elements?$select=Name`)).value ?? []).map(e => e.Name) } catch { continue }
        if (!els.length) continue
        // Read each element's attributes from source
        const updates = []
        for (const el of els) {
            try {
                const attrs = await sc.getElementAttributeValues(dim, el)
                for (const attrName of attrNames) {
                    if (attrs[attrName] != null && typeof attrs[attrName] !== 'object') {
                        updates.push({
                            dimElemPairs: [
                                { dim: attrDim, element: attrName },
                                { dim, element: el },
                            ],
                            value: String(attrs[attrName]),
                        })
                    }
                }
            } catch { /* skip unreadable element */ }
        }
        if (updates.length) {
            try { await tc.updateCells(attrDim, updates); out.dims.push(dim) }
            catch (e) { out.errors.push({ dim, error: e.message }) }
        }
    }
    return out
}

// Full reconcile after a git pull: deletes + attribute values.
async function reconcile(source, target, { ideToken, dims = null } = {}) {
    const out = {}
    try { out.deletes = await reconcileDeletes(source, target, { ideToken }) } catch (e) { out.deletes = { error: e.message } }
    try { out.attributeValues = await syncAttributeValues(source, target, { ideToken, dims }) } catch (e) { out.attributeValues = { error: e.message } }
    return out
}

module.exports = { reconcile, reconcileDeletes, syncAttributeValues }