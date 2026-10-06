'use strict'

// ── Deploy lock (one deploy per target at a time) ───────────────────────────
// Held in the TARGET's own model (Applications/Governance/Deployments/locks),
// so every IDE instance pointed at that target sees it. Acquired at the start
// of a deploy, released on finish or failure. Missing lock = free. If the model
// cannot be written, the lock THROWS — the deploy stops loudly, never silent.

const store = require('./model-store')

const AREA = 'lock'
const LOCK_DOC = (server) => `_lock-${server}.json`

async function acquire(target, { by, token, gitUser, ideToken } = {}) {
    const existing = await store.readOptional(target, AREA, LOCK_DOC(target), { ideToken })
    if (existing && existing.by) {
        const err = new Error(`Refused: ${target} is already being deployed by ${existing.by} since ${existing.at}. Wait for that deploy to finish.`)
        err.refused = true
        throw err
    }
    await store.writeDoc(target, AREA, LOCK_DOC(target), { by: by ?? 'unknown', at: new Date().toISOString() }, { ideToken })
    return { by: by ?? 'unknown', at: new Date().toISOString() }
}

async function release(target, { ideToken } = {}) {
    try { await store.writeDoc(target, AREA, LOCK_DOC(target), null, { ideToken }) } catch { /* release is best effort — a stale lock only blocks the next deploy visibly */ }
}

async function current(target, { ideToken } = {}) {
    const existing = await store.readOptional(target, AREA, LOCK_DOC(target), { ideToken })
    return existing && existing.by ? { by: existing.by, at: existing.at } : null
}

module.exports = { acquire, release, current }