'use strict'

// ── Git token store ──────────────────────────────────────────────────────────
// The GitHub token used by TM1 Git is a server-side secret: it is never sent
// back to the browser, never logged, and never returned by any endpoint — the
// UI only ever sees "token set ✓". Persisted (gitignored) so a restart keeps it;
// process env wins if set (e.g. TM1_GIT_TOKEN in .env).

const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'config', 'git-secrets.json')

function read() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

function getToken() {
    return process.env.TM1_GIT_TOKEN || read().TM1_GIT_TOKEN || ''
}

// Returns true (never the token). Throws on a blank/implausibly short token.
function setToken(token) {
    if (!token || typeof token !== 'string' || token.trim().length < 8) {
        const e = new Error('That token looks wrong — it should be a GitHub fine-grained PAT (at least 8 characters).')
        throw e
    }
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify({ TM1_GIT_TOKEN: token.trim() }, null, 2))
    process.env.TM1_GIT_TOKEN = token.trim()
    return true
}

module.exports = { getToken, setToken, FILE }