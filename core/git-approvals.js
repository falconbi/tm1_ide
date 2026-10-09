'use strict'

// ── Deploy approvals ─────────────────────────────────────────────────────────
// The recorded human decisions that gate a deploy. Bound to (target, commit): a
// new commit invalidates the old approval.
//
// Model-owned migration (Part 2): on a migrated TARGET the approvals live in
// that target's model (Applications/Governance/Deployments/approvals.json); the
// local file stays as the read fallback during the transition. Writes to a
// migrated target go to the model and THROW if it cannot be written — loud.

const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'config', 'deploy-approvals.json')

function readLocal() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] }
}
function writeLocal(arr) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(arr, null, 2))
}

async function readFor(target, { ideToken } = {}) {
    const store = require('./model-store')
    if (store.isMigrated(target, 'approvals')) {
        const arr = await store.readDoc(target, 'approvals', 'approvals.json', { ideToken })
        if (arr === null) return []   // never migrated-written yet — treat as empty, pending first write
        if (!Array.isArray(arr)) throw new Error(`Model approvals on "${target}" is not an array`)
        return arr
    }
    return readLocal().filter(a => a.target === target)
}

// Latest approval for this exact target + commit, or null.
async function find(target, commit, { ideToken } = {}) {
    return [...(await readFor(target, { ideToken }))].reverse().find(a => a.target === target && a.commit === commit) ?? null
}

async function append(rec, { ideToken } = {}) {
    const store = require('./model-store')
    if (store.isMigrated(rec.target, 'approvals')) {
        const arr = (await readFor(rec.target, { ideToken })) ?? []
        arr.push(rec)
        await store.writeDoc(rec.target, 'approvals', 'approvals.json', arr, { ideToken })   // loud
        const local = readLocal(); local.push(rec); writeLocal(local)                         // keep fallback in sync
        return rec
    }
    const local = readLocal()
    local.push(rec)
    writeLocal(local)
    return rec
}

module.exports = { readFor, find, append, readLocal, FILE }