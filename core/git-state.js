'use strict'

// ── Git deploy state ────────────────────────────────────────────────────────
// TM1's DeployedCommit is "the last git operation's target", not "what the
// server last received" — a push to prod-live clobbers it. So the IDE records
// what it actually deployed (per server), and the drift check uses that as its
// reference. This is IDE tool state (a pointer), not model data.

const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'config', 'git-deploy-state.json')

function load() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

function save(d) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(d, null, 2))
}

function recordDeploy(server, commit, summary) {
    const d = load()
    d[server] = { lastDeployedCommit: commit, summary, at: new Date().toISOString() }
    save(d)
}

function lastDeployed(server) {
    return load()[server] ?? null
}

module.exports = { recordDeploy, lastDeployed, FILE }