'use strict'

// ── Deploy lock (one deploy per target at a time) ───────────────────────────
// Held in the TARGET's own model (Applications/Governance/Deployments), so every
// IDE instance pointed at that target sees it. Acquired at the start of a
// deploy, released on finish or failure. A lock older than ~30 min is treated
// as STALE (a deploy that died with the backend, or a failed release) and can
// be cleared from the IDE. Missing lock = free.
//
// Honest caveat (small teams): acquire is check-then-write — two simultaneous
// deploys to the same target could both pass the check before either writes.
// Acceptable for small teams; a compare-and-swap (e.g. a dedicated TM1 process or
// a transaction) would close the race if it ever matters.

const store = require('./model-store')

const AREA = 'lock'
const LOCK_DOC = (server) => `_lock-${server}.json`
const STALE_MS = 30 * 60 * 1000

async function acquire(target, { by, ideToken } = {}) {
    const existing = await store.readOptional(target, AREA, LOCK_DOC(target), { ideToken })
    if (existing && existing.by) {
        const err = new Error(`Refused: ${target} is already being deployed by ${existing.by} since ${existing.at}. Wait for that deploy to finish.`)
        err.refused = true
        throw err
    }
    await store.writeDoc(target, AREA, LOCK_DOC(target), { by: by ?? 'unknown', at: new Date().toISOString() }, { ideToken })
    return { by: by ?? 'unknown', at: new Date().toISOString() }
}

// Release returns { ok } and, on failure, DOES NOT swallow: { ok:false, error }.
// The deploy result surfaces that (a stale lock is then clearable from the IDE).
async function release(target, { ideToken } = {}) {
    try {
        await store.writeDoc(target, AREA, LOCK_DOC(target), null, { ideToken })
        return { ok: true }
    } catch (e) {
        return { ok: false, error: e.message }
    }
}

async function current(target, { ideToken } = {}) {
    const existing = await store.readOptional(target, AREA, LOCK_DOC(target), { ideToken })
    if (!existing || !existing.by) return null
    const stale = Date.now() - new Date(existing.at).getTime() > STALE_MS
    return { by: existing.by, at: existing.at, stale }
}

// Clear a STALE lock (a live one must not be cleared) and record who/when in the
// deploy history (Deployments/lock-events.json). Loud: if the model can't be
// written, this throws.
async function clear(target, { by, ideToken } = {}) {
    const lock = await current(target, { ideToken })
    if (!lock) return { ok: true, note: 'no lock to clear' }
    if (!lock.stale) {
        const err = new Error(`Refused: ${target} is being deployed by ${lock.by} since ${lock.at} — that lock is not stale, so it is not cleared.`)
        err.refused = true
        throw err
    }
    await store.writeDoc(target, AREA, LOCK_DOC(target), null, { ideToken })
    // record in the deploy history
    const events = (await store.readOptional(target, AREA, 'lock-events.json', { ideToken })) ?? []
    events.push({ action: 'cleared', at: new Date().toISOString(), by: by ?? 'unknown', target, cleared_lock_by: lock.by, cleared_lock_at: lock.at })
    await store.writeDoc(target, AREA, 'lock-events.json', events, { ideToken })
    return { ok: true, cleared: lock }
}

module.exports = { acquire, release, current, clear }