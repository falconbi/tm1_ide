'use strict'

// ── Shared Git helpers ───────────────────────────────────────────────────────
// One place for the throwaway-clone git commands, the credentialised remote URL
// and error sanitising — so no token ever ends up in a URL echoed in an error.

const { execFileSync } = require('child_process')

function git(cwd, ...args) {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
}
function authUrl(url, user, token) {
    return url.replace(/^https:\/\//i, `https://${user}:${token}@`)
}
function sanitize(text, token) {
    // Mask EVERY occurrence, not just the first — a URL or error can carry the
    // token more than once. .split().join() replaces all; .replace(token, …) only one.
    return token ? String(text ?? '').split(token).join('***') : String(text ?? '')
}

module.exports = { git, authUrl, sanitize }