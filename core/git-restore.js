'use strict'

// ── Restore drift from the approved commit ──────────────────────────────────
// Revert used to re-pull the deployed commit (a no-op for drifted objects) and
// then to copy the LIVE DEV object (uncommitted DEV edits would ship). It now
// restores each drifted object FROM THE APPROVED COMMIT's repo file:
//   git show <approvedCommit>:<file> → apply to the target.
// DEV's live state is never copied, so an uncommitted DEV edit cannot reach
// PROD. Unsupported types are flagged, never silently skipped.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient } = require('./adapter_registry')
const { TM1Client } = require('./tm1_client')
const { git, authUrl, sanitize } = require('./git-repo')

const esc = s => String(s).replace(/'/g, "''")

// Map a repo file path to an object descriptor. Returns null when unsupported.
function parseObjectFile(file) {
    const f = String(file ?? '')
    let m
    m = f.match(/^dimensions\/(.+)\.hierarchies\/(.+)\.subsets\/([^/]+)\.json$/)
    if (m) return { type: 'subset', dim: m[1], hierarchy: m[2], name: m[3] }
    m = f.match(/^processes\/(.+)\.(json|ti)$/)
    if (m) return { type: 'process', name: m[1] }
    if (/^dimensions\//.test(f) && /\.json$/.test(f)) return { type: 'dimension', name: f }
    m = f.match(/^cubes\/(.+)\.views\/([^/]+)\.json$/)
    if (m) return { type: 'view', cube: m[1], name: m[2] }
    if (/^cubes\/.+\.rules$/.test(f)) return { type: 'rules', cube: f.replace(/^cubes\//, '').replace(/\.rules$/, '') }
    return null
}

// Element name from the exported subset format: Elements are
// { "@id": "Dimensions('..')/Hierarchies('..')/Elements('NAME')" }.
function subsetMemberName(el, dim, hier) {
    if (typeof el === 'string') return el
    if (el?.Name) return String(el.Name)
    const m = String(el?.['@id'] ?? '').match(/'([^']+)'\)?$/m)
    if (m) return m[1]
    return null
}

// TM1 Git exports a process as one .ti file with #region Prolog / Metadata /
// Data / Epilog blocks. Split them back into the four procedures.
function splitTi(text) {
    const grab = (key) => {
        const m = String(text ?? '').match(new RegExp(`#region\\s+${key}\\s*\\r?\\n([\\s\\S]*?)#endregion`, 'i'))
        return m ? m[1].replace(/\r/g, '').trimEnd() : ''
    }
    if (!/#region\s+Prolog/i.test(String(text ?? ''))) return null
    return { prolog: grab('Prolog'), metadata: grab('Metadata'), data: grab('Data'), epilog: grab('Epilog') }
}

// A view placement from a repo export: either a NAMED subset
// ({ Subset: { @id: '…/Subsets(\'NAME\')' } }) or an inline expression
// ({ Subset: { Hierarchy: {@id}, Expression }, Selected: {@id} }).
function parseViewPlacement(p) {
    const subId = String(p?.Subset?.['@id'] ?? '')
    const named = subId.match(/Subsets\('([^']+)'\)/)?.[1] ?? null
    const dim = named
        ? String(subId).match(/Dimensions\('([^']+)'\)/)?.[1]
        : String(p?.Subset?.Hierarchy?.['@id'] ?? '').match(/Dimensions\('([^']+)'\)/)?.[1]
    if (named) return { dimension: dim, subset: named }
    const out = { dimension: dim, customExpr: p?.Subset?.Expression ?? null }
    const member = String(p?.Selected?.['@id'] ?? '').match(/Elements\('([^']+)'\)/)?.[1] ?? null
    if (member) out.member = member
    return out
}

// Apply a subset from its repo file: a DYNAMIC subset keeps its MDX Expression;
// a STATIC subset is applied by its element list. (This is the fix for treating
// every exported subset as static.)
async function applySubset(tm1, det, content) {
    const sub = JSON.parse(content)
    if (sub.Expression) {
        await tm1.saveSubset(det.dim, det.name, sub.Expression, det.hierarchy ?? det.dim)
        return { type: 'subset', name: `${det.name} (${det.dim})`, mode: 'mdx' }
    }
    const members = (sub.Elements ?? []).map(el => subsetMemberName(el, det.dim, det.hierarchy ?? det.dim)).filter(Boolean)
    await tm1.saveStaticSubset(det.dim, det.name, members, det.hierarchy ?? det.dim)
    return { type: 'subset', name: `${det.name} (${det.dim})`, mode: 'static', n: members.length }
}

// Apply a view from its repo file: MDX views keep their MDX; native views are
// rebuilt from the exported Rows / Columns / Titles placements.
async function applyView(tm1, det, content) {
    const view = JSON.parse(content)
    if (view.MDX && !Array.isArray(view.Rows)) {
        await tm1.saveView(det.cube, det.name, view.MDX)
        return { type: 'view', name: `${det.name} (${det.cube})`, mode: 'mdx' }
    }
    await tm1.saveNativeView(det.cube, det.name, {
        rows: (view.Rows ?? []).map(parseViewPlacement),
        columns: (view.Columns ?? []).map(parseViewPlacement),
        titles: (view.Titles ?? []).map(parseViewPlacement),
        suppressEmptyRows: view.SuppressEmptyRows,
        suppressEmptyColumns: view.SuppressEmptyColumns,
    })
    return { type: 'view', name: `${det.name} (${det.cube})`, mode: 'native' }
}

// Restore each drifted object from the approved commit's repo file.
async function restoreFromCommit(target, commit, entries, { branch = 'dev', token, gitUser, ideToken } = {}) {
    const c = makeClient(target, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    const repoUrl = st?.URL
    if (!repoUrl) return { ok: false, error: 'no repo URL' }

    const out = { restored: [], skipped: [], errors: [] }
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1restore-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', branch)
        const tm1 = new TM1Client(target, c)
        // dedupe by object (a process is two repo files: <name>.json and <name>.ti)
        const seen = new Set()
        for (const e of entries ?? []) {
            const file = e?.file
            if (!file) continue
            const det = parseObjectFile(file)
            if (!det) { out.skipped.push({ file, error: 'unrecognised file type' }); continue }
            const key = `${det.type}::${String(det.name).toLowerCase()}`
            if (seen.has(key)) continue
            seen.add(key)
            try {
                if (det.type === 'subset') {
                    const content = git(work, 'show', `${commit}:${file}`)
                    // MDX-aware: dynamic subsets keep their Expression (this fixes the
                    // old behaviour that turned every exported subset into an empty static one).
                    out.restored.push(await applySubset(tm1, det, content))
                } else if (det.type === 'view') {
                    const content = git(work, 'show', `${commit}:${file}`)
                    out.restored.push(await applyView(tm1, det, content))
                } else if (det.type === 'process') {
                    const tiText = git(work, 'show', `${commit}:processes/${det.name}.ti`)
                    const parts = splitTi(tiText)
                    if (!parts) {
                        out.skipped.push({ file, error: 'process .ti has no Prolog/Metadata/Data/Epilog regions — cannot split; apply manually' })
                        continue
                    }
                    const json = JSON.parse(git(work, 'show', `${commit}:processes/${det.name}.json`))
                    const params = (json.Parameters ?? []).map(p => ({
                        Name: p.Name, Type: p.Type ?? 'String',
                        Value: p.Type === 'Numeric' ? Number(p.Value ?? 0) : String(p.Value ?? ''),
                        Prompt: p.Prompt ?? '',
                    }))
                    await tm1.createOrReplaceProcess({
                        name: det.name, prolog: parts.prolog, metadata: parts.metadata,
                        data: parts.data, epilog: parts.epilog,
                        parameters: params, datasource: json.DataSource ?? { Type: 'None' }, variables: json.Variables ?? [],
                    })
                    out.restored.push({ type: 'process', name: det.name })
                } else if (det.type === 'rules') {
                    const text = git(work, 'show', `${commit}:${file}`)
                    await c.patch(`Cubes('${esc(det.cube)}')`, { Rules: text })
                    out.restored.push({ type: 'rules', name: det.cube })
                } else {
                    out.skipped.push({ file, error: `revert for ${det.type} not implemented yet — apply manually` })
                }
            } catch (err) {
                out.errors.push({ file, error: err.message })
            }
        }
        out.ok = out.errors.length === 0
        return out
    } catch (err) {
        return { ok: false, error: sanitize(err.message, token) }
    } finally {
        try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* best effort */ }
    }
}

module.exports = { restoreFromCommit, parseObjectFile, splitTi, subsetMemberName, parseViewPlacement, applySubset, applyView }