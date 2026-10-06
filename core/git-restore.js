'use strict'

// ── Restore drift — actually rewrite the drifted objects ────────────────────
// Revert used to re-pull the deployed commit, which is a no-op for objects the
// pull plan considers unchanged (the live object diverged, not the tracked
// state). Restore instead copies the affected objects from the SOURCE (the
// approved state) back to the target, per object, for drift entries supplied by
// the drift check. Unsupported types are flagged, never silently skipped.

const { makeClient } = require('./adapter_registry')
const { TM1Client } = require('./tm1_client')

const esc = s => String(s).replace(/'/g, "''")

// Map a repo file path to an object descriptor. Returns null when unsupported.
function parseObjectFile(file) {
    const f = String(file ?? '')
    let m
    // static subset: dimensions/<dim>.hierarchies/<hier>.subsets/<name>.json
    m = f.match(/^dimensions\/(.+)\.hierarchies\/(.+)\.subsets\/([^/]+)\.json$/)
    if (m) return { type: 'subset', dim: m[1], hierarchy: m[2], name: m[3] }
    // process: processes/<name>.json (skip the paired .ti)
    m = f.match(/^processes\/(.+)\.json$/)
    if (m) return { type: 'process', name: m[1] }
    // dimension (flag — full dim apply is not implemented yet)
    if (/^dimensions\//.test(f) && /\.json$/.test(f)) return { type: 'dimension', name: f }
    // view (flag)
    m = f.match(/^cubes\/(.+)\.views\/([^/]+)\.json$/)
    if (m) return { type: 'view', cube: m[1], name: m[2] }
    // rules (flag — no rules copy path in TM1Client yet)
    if (/^cubes\/.+\.rules$/.test(f)) return { type: 'rules', cube: f.replace(/^cubes\//, '').replace(/\.rules$/, '') }
    return null
}

// Restore each drifted object by copying its live definition from source → target.
async function restoreObjects(source, target, entries, { ideToken } = {}) {
    const sc = new TM1Client(source, makeClient(source, ideToken))
    const tc = new TM1Client(target, makeClient(target, ideToken))
    const out = { restored: [], skipped: [], errors: [], unsupported: [] }

    // dedupe process .ti/.json pairs and paths
    const seen = new Set()
    for (const e of entries ?? []) {
        const file = e?.file
        if (!file || seen.has(file)) continue
        seen.add(file)
        try {
            const det = parseObjectFile(file)
            if (!det) { out.unsupported.push({ file, error: 'unrecognised file type' }); continue }
            if (det.type === 'subset') {
                const members = ((await sc.get(`Dimensions('${esc(det.dim)}')/Hierarchies('${esc(det.hierarchy)}')/Subsets('${esc(det.name)}')/Elements`)).value ?? []).map(x => x.Name)
                await tc.saveStaticSubset(det.dim, det.name, members, det.hierarchy)
                out.restored.push({ type: 'subset', name: `${det.name} (${det.dim})`, n: members.length })
            } else if (det.type === 'process') {
                const p = await sc.getProcess(det.name)
                await tc.createOrReplaceProcess({
                    name: det.name, prolog: p.PrologProcedure, metadata: p.MetadataProcedure,
                    data: p.DataProcedure, epilog: p.EpilogProcedure,
                    parameters: p.Parameters, datasource: p.DataSource, variables: p.Variables,
                })
                out.restored.push({ type: 'process', name: det.name })
            } else {
                out.unsupported.push({ file, error: `revert for ${det.type} not implemented yet — apply manually` })
            }
        } catch (err) {
            out.errors.push({ file, error: err.message })
        }
    }
    return out
}

module.exports = { restoreObjects, parseObjectFile }