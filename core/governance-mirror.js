'use strict'

// ── Governance mirror (#4) ──────────────────────────────────────────────────
// The IDE mirrors the model's Applications/Governance documents into a
// `governance/` folder in the model's repo (git history + review for tests,
// change sets, deploy records, Lenses), and applies them to targets on deploy
// with per-target rules. The server stays the runtime truth.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient } = require('./adapter_registry')
const gitIdentity = require('./git-identity')
const { git, authUrl, sanitize } = require('./git-repo')

const GOVERNANCE = ['Applications', 'Governance']
const GIT_FOLDER = 'governance'
const EXT = new Set(['.json', '.html', '.txt', '.md'])

// Walk Applications/Governance → [{ rel: 'Tests/assertions.json', content }]
async function readGovernance(client) {
    const out = []
    const walk = async (parts) => {
        let items = []
        try { items = await client.listFiles(parts) } catch { return }
        for (const it of items) {
            if (it.isFolder) await walk([...parts, it.name])
            else if (EXT.has(path.extname(it.name))) {
                try {
                    const c = await client.getFileContent(parts, it.name)
                    out.push({ rel: [...parts.slice(GOVERNANCE.length), it.name].join('/'), content: typeof c === 'string' ? c : JSON.stringify(c, null, 2) })
                } catch { /* skip unreadable */ }
            }
        }
    }
    await walk(GOVERNANCE)
    return out
}

// Mirror the server's governance documents into the repo's governance/ folder (branch dev by default).
async function mirrorToRepo(server, { token, gitUser = gitIdentity.user(), ideToken, branch = 'dev', repoUrl } = {}) {
    const c = makeClient(server, ideToken)
    if (!repoUrl) {
        try { repoUrl = (await c.post('GitStatus', { Username: gitUser, Password: token }))?.URL } catch {}
    }
    if (!repoUrl) return { ok: false, error: 'no repo URL (GitStatus failed or not initialized)' }

    const docs = await readGovernance(c)
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1gov-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', branch)
        git(work, 'checkout', '-q', '-b', branch, `origin/${branch}`)
        const gov = path.join(work, GIT_FOLDER)
        fs.rmSync(gov, { recursive: true, force: true })
        if (docs.length) {
            fs.mkdirSync(gov, { recursive: true })
            for (const d of docs) {
                const p = path.join(gov, d.rel)
                fs.mkdirSync(path.dirname(p), { recursive: true })
                fs.writeFileSync(p, d.content)
            }
        }
        git(work, 'add', '-A')
        if (!git(work, 'status', '--porcelain').trim()) return { ok: true, changed: 0, note: 'governance unchanged in repo' }
        git(work, 'commit', '-q', '-m', `governance: mirror ${server} Applications/Governance`)
        git(work, 'push', 'origin', `${branch}:${branch}`)
        return { ok: true, changed: docs.length, files: docs.map(d => d.rel) }
    } catch (e) {
        return { ok: false, error: `mirror failed: ${sanitize(e.message, token)}` }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

// Apply governance/ from the repo to the server's Applications (per-target `allow` prefix filter).
async function applyFromRepo(server, { token, gitUser = gitIdentity.user(), ideToken, branch = 'dev', repoUrl, allow = [] } = {}) {
    const c = makeClient(server, ideToken)
    if (!repoUrl) {
        try { repoUrl = (await c.post('GitStatus', { Username: gitUser, Password: token }))?.URL } catch {}
    }
    if (!repoUrl) return { ok: false, error: 'no repo URL' }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1gov-'))
    const applied = []
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', branch)
        git(work, 'checkout', '-q', '-b', branch, `origin/${branch}`)
        const gov = path.join(work, GIT_FOLDER)
        if (!fs.existsSync(gov)) return { ok: true, applied: [], note: 'no governance/ folder in repo' }
        const files = []
        const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else files.push(p) } }
        walk(gov)
        for (const f of files) {
            const rel = path.relative(gov, f).split(path.sep).join('/')
            if (allow.length && !allow.some(a => rel.startsWith(a))) continue
            const parts = ['Applications', 'Governance', ...rel.split('/').slice(0, -1)]
            const name = path.basename(f)
            await c.ensureFolderPath(parts)
            try { await c.createFileDocument(parts, name) } catch { /* exists */ }
            await c.putFileContent(parts, name, fs.readFileSync(f, 'utf8'))
            applied.push(rel)
        }
        return { ok: true, applied }
    } catch (e) {
        return { ok: false, error: `apply failed: ${sanitize(e.message, token)}` }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

module.exports = { mirrorToRepo, applyFromRepo }