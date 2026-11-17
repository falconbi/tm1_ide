'use strict'

const crypto = require('crypto')

function createHttp({ cl, isSimple, isAdminGroups, makeClient, canManageSession, readOnlyRefusal, createAdminGate }) {
    const SESSION_GATE_ENABLED = ['1', 'true', 'yes'].includes(String(process.env.TM1_REQUIRE_SESSION ?? '0').toLowerCase())
    const NO_SESSION_ERROR = 'No change set is open for this server — start one first (Change Log → Start change set) so this change can be attributed and deployed.'
    const NEEDS_LOGIN_RE = /^(?:Sign in to server "(.+)" to use it|TM1 rejected the login for server "(.+)" — sign in to it again)$/

    function requireSession(server, user) {
        if (!SESSION_GATE_ENABLED) return true
        if (isSimple(server)) return true
        return !!cl.getActiveSession(server, user)
    }

    const { isTm1Admin, requireTm1Admin } = createAdminGate({ makeClient, isAdminGroups })

    async function mayManageSession(req, session) {
        if (canManageSession(req.user, session)) return true
        return isTm1Admin(req, session.server)
    }

    function gateReadOnly(res, server) {
        const refusal = readOnlyRefusal(server)
        if (refusal) { res.status(409).json(refusal); return false }
        return true
    }

    function gateWrite(res, server) {
        if (!gateReadOnly(res, server)) return false
        if (!requireSession(server, res.req?.user)) {
            res.status(409).json({ error: NO_SESSION_ERROR })
            return false
        }
        return true
    }

    function fail(res, e) {
        const status = e?.status ?? e?.response?.status
        const code = e?.code
        const out = status === 400 ? 400
            : status === 401 || status === 403 || status === 404 ? status
            : status === 409 || code === 'READ_ONLY' || code === 'LOCKED' ? 409
            : 500
        return res.status(out).json({ error: e?.message || 'Request failed' })
    }

    function scanIdentity(req) {
        if (req.ideToken) return crypto.createHash('sha256').update(String(req.ideToken)).digest('hex').slice(0, 16)
        return req.user ?? ''
    }

    const isLoopbackReq = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)

    function sendMaintenanceError(res, e) {
        const is404 = e.response?.status === 404 || e.message?.includes('404')
        if (is404) return res.status(404).json({ error: 'Maintenance mode is not available on this server — it needs TM1 12.6 or later.' })
        res.status(500).json({ error: e.message })
    }

    return { requireSession, mayManageSession, gateReadOnly, gateWrite, fail, isTm1Admin, requireTm1Admin, scanIdentity, isLoopbackReq, sendMaintenanceError, NEEDS_LOGIN_RE }
}

module.exports = { createHttp }
