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
    m = f.match(/^processes\/(.+)\.json$/)
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
        for (const e of entries ?? []) {
            const file = e?.file
            if (!file) continue
            const det = parseObjectFile(file)
            if (!det) { out.skipped.push({ file, error: 'unrecognised file type' }); continue }
            try {
                if (det.type === 'subset') {
                    const content = git(work, 'show', `${commit}:${file}`)
                    const sub = JSON.parse(content)
                    const members = (sub.Elements ?? []).map(el => subsetMemberName(el, det.dim, det.hierarchy)).filter(Boolean)
                    await tm1.saveStaticSubset(det.dim, det.name, members, det.hierarchy)
                    out.restored.push({ type: 'subset', name: `${det.name} (${det.dim})`, n: members.length })
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

module.exports = { restoreFromCommit, parseObjectFile }