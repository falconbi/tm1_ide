'use strict'

// ── Deploy approvals ────────────────────────────────────────────────────────
// The recorded human decisions that gate a deploy. Local runtime state —
// gitignored, never committed. An approval is bound to (target, commit): a new
// commit invalidates the old approval.

const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'config', 'deploy-approvals.json')

function read() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] }
}
// Latest approval for this exact target + commit, or null.
function find(target, commit) {
    return [...read()].reverse().find(a => a.target === target && a.commit === commit) ?? null
}
function append(rec) {
    const arr = read()
    arr.push(rec)
    fs.writeFileSync(FILE, JSON.stringify(arr, null, 2))
    return rec
}

module.exports = { read, find, append, FILE }
