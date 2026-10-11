'use strict'

// ── Sign-in throttles (shared by the IDE and the Lens app) ────────────────────
// 1. Per-IP: a small in-memory limit on sign-in requests (defence in depth).
// 2. Per-username failures: TM1 v11 locks an account after MaximumLoginAttempts
//    (3 by default). An app that lets anyone keep guessing a real username's
//    password would lock that person out. Refusing after `maxFailures` rejected
//    attempts in the window means the app can never be what locks them out.

function createIpLimiter({ max = 10, windowMs = 15 * 60_000 } = {}) {
    const hits = new Map()   // ip -> { count, resetAt }
    const timer = setInterval(() => {
        const now = Date.now()
        for (const [ip, rec] of hits) if (now >= rec.resetAt) hits.delete(ip)
    }, windowMs)
    timer.unref?.()

    const ipOf = req => req.ip || req.socket?.remoteAddress || 'unknown'
    function middleware(req, res, next) {
        const ip  = ipOf(req)
        const now = Date.now()
        let rec = hits.get(ip)
        if (!rec || now >= rec.resetAt) {
            rec = { count: 0, resetAt: now + windowMs }
            hits.set(ip, rec)
        }
        if (rec.count >= max) {
            res.setHeader('Retry-After', Math.ceil((rec.resetAt - now) / 1000))
            return res.status(429).json({ error: 'Too many sign-in attempts — try again later' })
        }
        rec.count++
        next()
    }
    // A successful sign-in resets the counter for that address.
    middleware.clear = (req) => hits.delete(ipOf(req))
    return middleware
}

function createFailureGuard({ maxFailures = 2, windowMs = 15 * 60_000 } = {}) {
    const fails = new Map()  // key -> { count, resetAt }
    const live = (key, now = Date.now()) => {
        const rec = fails.get(key)
        if (rec && now >= rec.resetAt) { fails.delete(key); return null }
        return rec ?? null
    }
    return {
        // Minutes to wait, or 0 when an attempt is allowed.
        blockedFor(key, now = Date.now()) {
            const rec = live(key, now)
            return rec && rec.count >= maxFailures ? Math.ceil((rec.resetAt - now) / 60_000) : 0
        },
        recordFailure(key, now = Date.now()) {
            const rec = live(key, now) ?? { count: 0, resetAt: now + windowMs }
            rec.count++
            fails.set(key, rec)
        },
        clear(key) { fails.delete(key) },
    }
}

module.exports = { createIpLimiter, createFailureGuard }
