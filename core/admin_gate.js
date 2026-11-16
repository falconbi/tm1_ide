'use strict'

// One definition of "may use the Admin surfaces". TM1's own Admin group is the
// only source of truth; the answer is cached briefly so a page load does not ask
// TM1 once per admin route.

function createAdminGate({ makeClient, isAdminGroups, ttlMs = 2 * 60 * 1000 } = {}) {
    const cache = new Map()

    async function isTm1Admin(req, server) {
        if (!server) return false
        const key = `${req.ideToken ?? ''}|${server}`
        const hit = cache.get(key)
        if (hit && hit.until > Date.now()) return hit.value
        let value
        try {
            const me = await makeClient(server, req.ideToken).get('ActiveUser', { $expand: 'Groups($select=Name)' })
            value = isAdminGroups(me?.Groups)
        } catch { value = false }
        cache.set(key, { value, until: Date.now() + ttlMs })
        return value
    }

    async function requireTm1Admin(req, res, server) {
        if (await isTm1Admin(req, server)) return true
        res.status(403).json({ error: 'TM1 Admin group required' })
        return false
    }

    return { isTm1Admin, requireTm1Admin, clearAdminCache: () => cache.clear() }
}

module.exports = { createAdminGate }
