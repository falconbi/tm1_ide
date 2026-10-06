'use strict'

// ── Git deploy state (what each server last received) ───────────────────────
// TM1's DeployedCommit is "the last git operation's target", not "what the
// server last received" — a push to prod-live clobbers it. So the IDE records
// what it actually deployed (per server), and the drift check uses that as its
// reference.
//
// Model-owned migration (Part 2): on a migrated server the record lives in the
// model (Applications/Governance/Deployments/state.json). Reads keep using the
// local file as the fallback until the migration is proven (write-through keeps
// them in sync); writes to a migrated server go to the model and THROW if it
// cannot be written — never silent.

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

async function recordDeploy(server, commit, summary, { ideToken } = {}) {
    const rec = { lastDeployedCommit: commit, summary, at: new Date().toISOString() }
    const store = require('./model-store')
    if (store.isMigrated(server, 'deployState')) {
        // Model is the truth here; a failure to write is loud.
        const state = (await store.readDoc(server, 'deployState', 'state.json', { ideToken })) ?? {}
        state[server] = rec
        await store.writeDoc(server, 'deployState', 'state.json', state, { ideToken })
        // keep the local fallback in sync during the transition
        const d = load(); d[server] = rec; save(d)
        return rec
    }
    const d = load()
    d[server] = rec
    save(d)
    return rec
}

// Reads stay local during the migration (write-through keeps FILE current).
function lastDeployed(server) {
    return load()[server] ?? null
}

module.exports = { recordDeploy, lastDeployed, load, FILE }