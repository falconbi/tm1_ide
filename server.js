'use strict'

require('dotenv').config({ path: require('path').join(__dirname, '.env') })

const express   = require('express')
const path      = require('path')
const fs        = require('fs')
const ai        = require('./core/ai/registry')
const obfuscate = require('./core/ai/obfuscate')
const { makeClient, makeClientWithCredentials, needsServerLogin, isDirectServer, isPawNativeServer, probeAuthMethod, listServers, listServersWithFlags, getDefaultAdapterType, getLoginServer, isReadOnly } = require('./core/adapter_registry')
const { loadConnections, saveConnections, getConnection, executeQuery, testConnection, getSchema, loadQueries, saveQueries } = require('./core/sql_client')
const { createSession, createDirectSession, createLocalSession, attachPawSession, getSessionUser, touchSession, invalidateSession, getCachedPawSession, getCSRF, PAW_HOST, setServerCredentials, getServerCredentials, clearServerCredentials, getServerStatus, listServerEntries, getSessionCredentials } = require('./core/paw_connect')
const cl = require('./core/change_log')
const lensStore = require('./core/lens_store')
const lensBridge = require('./core/lens_bridge')

// Session (Change Set) is optional for using the IDE — it groups changes for
// deployment, it is not a login and must never gate whether a save works.
// User attribution is independent of session: every write always logs the
// actual acting user (req.user / AGENT_USER), whether or not a session is
// open. Set TM1_REQUIRE_SESSION=1 to opt back into hard-gating writes behind
// an open session, for anyone who wants that stricter posture.
const SESSION_GATE_ENABLED = ['1', 'true', 'yes'].includes(String(process.env.TM1_REQUIRE_SESSION ?? '0').toLowerCase())
function requireSession(server) {
    if (!SESSION_GATE_ENABLED) return true
    return !!cl.getActiveSession(server)
}
const NO_SESSION_ERROR = 'No change set is open for this server — start one first (Change Log → Start change set) so this change can be attributed and deployed.'
const READ_ONLY_ERROR  = 'This server is read-only (PROD posture) — no changes are allowed here. Switch to a writable server to edit.'
function gateReadOnly(res, server) {
    if (isReadOnly(server)) {
        res.status(409).json({ error: READ_ONLY_ERROR })
        return false
    }
    return true
}
function gateWrite(res, server) {
    if (!gateReadOnly(res, server)) return false
    if (!requireSession(server)) {
        res.status(409).json({ error: NO_SESSION_ERROR })
        return false
    }
    return true
}
const { diff: deployDiff, driftCheck: deployDriftCheck } = require('./tools/tm1deploy/src/diff')
const { pack: deployPack }      = require('./tools/tm1deploy/src/packager')
const { analyzeRisk }           = require('./tools/tm1deploy/src/risk')
const { deploy: deployExecute } = require('./tools/tm1deploy/src/deployer')
const { seed: deploySeed, scopedSnapshot: deployScopedSnapshot } = require('./tools/tm1deploy/src/snapshot')
const { loadBaseline: deployLoadBaseline, listBaselines: deployListBaselines, setBaselineHead: deploySetBaselineHead } = require('./tools/tm1deploy/src/diff')

const FORGE_PATH = path.join(__dirname, 'config', 'forge.json')
const PAW_LOGIN_SERVER = process.env.PAW_LOGIN_SERVER

// ── Provider-agnostic AI ──────────────────────────────────────────────────────
// All AI features (MDX/subset generation) go through core/ai/registry — pick the
// provider in .env (AI_PROVIDER + AI_API_KEY + optional AI_MODEL/AI_BASE_URL).
// Legacy ANTHROPIC_API_KEY is still honoured so an existing .env keeps working.

const app  = express()
const PORT = process.env.PORT || 8083
// TM1 IDE is a local single-user developer tool — bind loopback only (see SECURITY.md).
// Override with HOST=0.0.0.0 only if you deliberately need LAN access and understand
// that the browser<->server leg is then plaintext HTTP with no transport security.
const HOST = process.env.HOST || '127.0.0.1'

// ── IDE sign-in (Architect model) ─────────────────────────────────────────────
// IDE_LOGIN=auto (default): no IDE login when the IDE listens on this machine only
//   — open it, pick a server, sign in to that server. When HOST exposes it to the
//   network, an IDE sign-in (through any server) is required: otherwise anyone on
//   the network could reach stored SQL logins, the AI key and change history.
// IDE_LOGIN=always: require the IDE sign-in even when local (e.g. a shared PC).
// There is deliberately no "never" for a network-exposed IDE.
const IDE_LOGIN    = String(process.env.IDE_LOGIN || 'auto').toLowerCase()
const LOCAL_ONLY   = ['127.0.0.1', 'localhost', '::1'].includes(HOST)
const LOGIN_REQUIRED = IDE_LOGIN === 'always' || !LOCAL_ONLY
const isLoopbackReq = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)

// ── Login rate limit ──────────────────────────────────────────────────────────
// Small in-memory per-IP throttle on the one unauthenticated endpoint. Defence in
// depth for the local model; a real barrier if HOST is ever widened.
const LOGIN_MAX_ATTEMPTS = 10
const LOGIN_WINDOW_MS    = 15 * 60_000
const _loginHits = new Map()  // ip -> { count, resetAt }

function loginRateLimit(req, res, next) {
    const ip  = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    let rec = _loginHits.get(ip)
    if (!rec || now >= rec.resetAt) {
        rec = { count: 0, resetAt: now + LOGIN_WINDOW_MS }
        _loginHits.set(ip, rec)
    }
    if (rec.count >= LOGIN_MAX_ATTEMPTS) {
        res.setHeader('Retry-After', Math.ceil((rec.resetAt - now) / 1000))
        return res.status(429).json({ error: 'Too many login attempts — try again later' })
    }
    rec.count++
    next()
}

// opportunistic cleanup so the map can't grow unbounded
setInterval(() => {
    const now = Date.now()
    for (const [ip, rec] of _loginHits) if (now >= rec.resetAt) _loginHits.delete(ip)
}, LOGIN_WINDOW_MS).unref()

app.use(express.json({ limit: '10mb' }))
app.use(express.static(path.join(__dirname, 'static'), {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store')
    }
}))

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', loginRateLimit, async (req, res) => {
    const clearHits = () => _loginHits.delete(req.ip || req.socket.remoteAddress || 'unknown')
    try {
        const { username, password } = req.body
        if (!username || !password) return res.status(400).json({ error: 'username and password required' })
        // Sign in through any server you have an account on (default: the configured login server).
        const via = req.body.server || getLoginServer()

        if (via && isDirectServer(via)) {
            const token = await createDirectSession(username, password)
            try {
                // These credentials belong to that server only — every other
                // server gets its own login (per-server login).
                setServerCredentials(token, via, { username, password })
                const cl = makeClient(via, token)
                await cl.get('Configuration')
                clearHits()
                res.json({ token, username, ...(isSampleLogin(username, password) ? { warning: SAMPLE_PASSWORD_WARNING } : {}) })
            } catch (e) {
                invalidateSession(token)
                res.status(401).json({ error: 'Login failed — check your TM1 credentials' })
            }
        } else {
            const token = await createSession(username, password)
            clearHits()
            res.json({ token, username })
        }
    } catch (e) { res.status(401).json({ error: 'Login failed' }) }
})

// End a server's TM1 session for this user (best effort) so it doesn't linger.
async function closeServerSession(server, entry) {
    if (!entry?.state?.cookie) return
    const cl = makeClientWithCredentials(server, { username: entry.username, password: entry.password ?? '' }, entry.state)
    await cl?._adapter?.closeSession?.()
}

app.post('/api/auth/logout', async (req, res) => {
    const token = req.headers['x-ide-token']
    if (token) {
        await Promise.all(listServerEntries(token).map(([server, entry]) => closeServerSession(server, entry)))
        invalidateSession(token)
    }
    res.json({ ok: true })
})

app.get('/api/config', (req, res) => {
    res.json({
        loginServer: getLoginServer() ?? PAW_LOGIN_SERVER ?? null,
        hasAI: ai.isConfigured(),
        loginRequired: LOGIN_REQUIRED,
        access: LOCAL_ONLY ? 'local' : 'network',
        // Server names for the sign-in page (only when a sign-in is required).
        servers: LOGIN_REQUIRED ? listServers() : [],
    })
})

// Sign-in page: "Brand-new server?" — set its first admin password and sign in to
// the IDE through it (the IDE's fallback for what Architect used to be needed for).
app.post('/api/auth/setup-login', loginRateLimit, async (req, res) => {
    try {
        const { server, newPassword } = req.body ?? {}
        const { state } = await setupBlankAdmin(server, newPassword)
        const token = await createDirectSession('admin', newPassword)
        setServerCredentials(token, server, { username: 'admin', password: newPassword }, state)
        _loginHits.delete(req.ip || req.socket.remoteAddress || 'unknown')
        res.json({ token, username: 'admin', server })
    } catch (e) { sendSetupError(res, e) }
})

// IBM's sample servers ship with admin / apple — fine in a lab, an open door anywhere shared.
const SAMPLE_PASSWORD_WARNING = 'This server still uses IBM\'s published sample password (admin / apple) — change it before anyone else can reach it.'
const isSampleLogin = (u, p) => String(u ?? '').toLowerCase() === 'admin' && p === 'apple'

// Architect model: a local-only IDE needs no IDE login. The browser gets a session
// that holds per-server logins only. Refused when an IDE sign-in is required, or
// when the request doesn't come from this machine.
app.post('/api/auth/local-session', async (req, res) => {
    if (LOGIN_REQUIRED || !isLoopbackReq(req)) return res.status(403).json({ error: 'Sign in required' })
    const token = await createLocalSession()
    res.json({ token, username: 'local' })
})

app.use('/api', (req, res, next) => {
    if (['/auth/login', '/auth/logout', '/auth/local-session', '/auth/setup-login'].includes(req.path)) return next()
    const token = req.headers['x-ide-token']
    if (!token) return res.status(401).json({ error: 'Not authenticated' })
    const user = getSessionUser(token)
    if (!user) return res.status(401).json({ error: 'Session expired — please log in again' })
    touchSession(token)
    req.ideToken = token
    req.user = user
    next()
})

// ── Per-server login ──────────────────────────────────────────────────────────
// A request for a server this user hasn't signed in to is answered here — before
// any call reaches TM1 — with 401 { needsServerLogin }. The browser shows a login
// for that server. No stored password is ever tried against another server, and a
// rejected one is never retried (TM1's MaximumLoginAttempts would lock the account).
const NEEDS_LOGIN_RE = /^(?:Sign in to server "(.+)" to use it|TM1 rejected the login for server "(.+)" — sign in to it again)$/

app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path === '/servers/setup') return next()
    const server = req.query?.server ?? req.body?.server
    if (server && needsServerLogin(String(server), req.ideToken)) {
        const rejected = getServerStatus(req.ideToken, String(server)) === 'rejected'
        return res.status(401).json({
            needsServerLogin: String(server), rejected,
            error: rejected
                ? `TM1 rejected the login for server "${server}" — sign in to it again`
                : `Sign in to server "${server}" to use it`,
        })
    }
    // Change sets record who changed what: use the identity signed in to THIS server.
    if (server) {
        const who = getServerCredentials(req.ideToken, String(server))?.username
        if (who) req.user = who
    }
    // Routes report errors as { error: message }; turn a login failure raised
    // mid-request into the same 401 { needsServerLogin } the check above sends.
    const json = res.json.bind(res)
    res.json = (body) => {
        const m = res.statusCode >= 400 && typeof body?.error === 'string' ? NEEDS_LOGIN_RE.exec(body.error) : null
        if (m) {
            res.status(401)
            return json({ ...body, needsServerLogin: m[1] ?? m[2], rejected: !!m[2] })
        }
        return json(body)
    }
    next()
})

// Which servers this user is signed in to.
//   status: 'signed-in' | 'needs-login' | 'rejected' | 'paw' (PAW owns the login)
app.get('/api/auth/servers', (req, res) => {
    res.json(listServers().map(name => {
        if (!isDirectServer(name)) return { name, status: 'paw' }
        const st = getServerStatus(req.ideToken, name)
        return { name, status: st === 'ok' ? 'signed-in' : st === 'rejected' ? 'rejected' : 'needs-login', username: getServerCredentials(req.ideToken, name)?.username ?? null }
    }))
})

// Sign in to one server. One test call; stores the login only if TM1 accepts it.
// useCurrent: try the credentials you signed in to the IDE with (one attempt).
app.post('/api/auth/server-login', loginRateLimit, async (req, res) => {
    try {
        const { server, username, password, useCurrent, namespace } = req.body ?? {}
        if (!server) return res.status(400).json({ error: 'server required' })
        const creds = useCurrent ? getSessionCredentials(req.ideToken) : { username, password: password ?? '', namespace: namespace || null }
        if (useCurrent && !creds) return res.status(400).json({ error: 'No current login to reuse — enter a username and password' })
        if (!creds?.username) return res.status(400).json({ error: 'username required' })
        if (isPawNativeServer(server)) {
            // One PAW sign-in covers every server behind that PAW.
            try { await attachPawSession(req.ideToken, creds.username, creds.password) }
            catch { return res.status(403).json({ rejected: true, error: `PAW rejected the login for "${server}" — check the username and password` }) }
            _loginHits.delete(req.ip || req.socket.remoteAddress || 'unknown')
            return res.json({ ok: true, server, username: creds.username, paw: true })
        }
        const state = {}
        const cl = makeClientWithCredentials(server, creds, state)
        if (!cl) return res.json({ ok: true })   // machine-credential connection — nothing to sign in to
        try {
            await cl.get('ActiveUser', { '$select': 'Name' })
        } catch (e) {
            if (e.code === 'TM1_AUTH_REJECTED') {
                return res.status(403).json({ rejected: true, error: `TM1 rejected the login for "${server}" — check the username and password` })
            }
            throw e
        }
        setServerCredentials(req.ideToken, server, { username: creds.username, password: creds.password, namespace: creds.namespace ?? null }, state)
        _loginHits.delete(req.ip || req.socket.remoteAddress || 'unknown')
        res.json({ ok: true, server, username: creds.username, ...(isSampleLogin(creds.username, creds.password) ? { warning: SAMPLE_PASSWORD_WARNING } : {}) })
    } catch (e) { res.status(500).json({ error: `Could not reach "${req.body?.server}": ${e.message}` }) }
})

// How does this server want to be signed in to? Asked without credentials —
// never counts as a failed login. Also the "Test connection" details.
app.get('/api/auth/method', async (req, res) => {
    try {
        if (!req.query.server) return res.status(400).json({ error: 'server required' })
        res.json(await probeAuthMethod(String(req.query.server)))
    } catch (e) { res.status(502).json({ server: req.query.server, method: 'unreachable', error: e.message }) }
})

// Sign out of one server (ends its TM1 session).
app.post('/api/auth/server-logout', async (req, res) => {
    const { server } = req.body ?? {}
    if (!server) return res.status(400).json({ error: 'server required' })
    await closeServerSession(server, clearServerCredentials(req.ideToken, server))
    res.json({ ok: true })
})

// "Set up new server" — set the first admin password on a fresh TM1 server
// (native security: a new server has user admin with a blank password).
// Exactly one attempt with the blank password; never repeated. The password must
// be set before anything else — nobody is left signed in on a blank password.
// Returns { state } (the TM1 session signed in with the new password) or throws
// an Error with .status/.body for the route to send.
async function setupBlankAdmin(server, newPassword) {
    const fail = (status, body) => Object.assign(new Error(body.error), { status, body })
    if (!server) throw fail(400, { error: 'server required' })
    if (!newPassword) throw fail(400, { error: 'newPassword required' })
    if (!isDirectServer(server)) throw fail(400, { error: `"${server}" is reached through PAW — set its password there` })
    const blank = makeClientWithCredentials(server, { username: 'admin', password: '' }, {})
    try {
        await blank.get('ActiveUser', { '$select': 'Name' })
    } catch (e) {
        if (e.code !== 'TM1_AUTH_REJECTED') throw e
        const w = String(e.wwwAuthenticate ?? '').toLowerCase()
        const mode = /cam/.test(w) ? 'cam' : /negotiate|ntlm/.test(w) ? 'integrated' : 'native'
        throw fail(409, {
            mode, alreadyHasPassword: mode === 'native',
            error: mode === 'native'
                ? `"${server}" already has an admin password — sign in to it normally`
                : `"${server}" uses ${mode === 'cam' ? 'CAM (Cognos)' : 'Windows'} security — passwords are managed in the directory, not TM1`,
        })
    }
    await blank.patch("Users('admin')", { Password: newPassword })
    await blank._adapter.closeSession()
    const state = {}
    await makeClientWithCredentials(server, { username: 'admin', password: newPassword }, state).get('ActiveUser', { '$select': 'Name' })
    return { state }
}

const sendSetupError = (res, e) => e.status
    ? res.status(e.status).json(e.body)
    : res.status(500).json({ error: e.response?.data?.error?.message ?? e.message })

// Already in the IDE: set up a new server and sign in to it.
app.post('/api/servers/setup', loginRateLimit, async (req, res) => {
    try {
        const { server, newPassword } = req.body ?? {}
        const { state } = await setupBlankAdmin(server, newPassword)
        setServerCredentials(req.ideToken, server, { username: 'admin', password: newPassword }, state)
        res.json({ ok: true, server, username: 'admin' })
    } catch (e) { sendSetupError(res, e) }
})

// No API response may be cached by the browser — the IDE serves live model state
// and lens HTML; a heuristic-cached GET would show stale content after an edit.
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
})

// ── Change log / Sessions ─────────────────────────────────────────────────────
app.post('/api/sessions/start', (req, res) => {
    try {
        const { name, server } = req.body
        if (!name?.trim() || !server) return res.status(400).json({ error: 'name and server required' })
        const session = cl.startSession(name.trim(), server, req.user)
        res.json(session)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sessions/close', (req, res) => {
    try {
        const { id } = req.body
        if (!id) return res.status(400).json({ error: 'id required' })
        res.json(cl.closeSession(id))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sessions/resume', (req, res) => {
    try {
        const { id } = req.body
        if (!id) return res.status(400).json({ error: 'id required' })
        res.json(cl.resumeSession(id))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions/active', (req, res) => {
    try { res.json(cl.getActiveSession(req.query.server) ?? null) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions', (req, res) => {
    try {
        const server   = req.query.server
        const sessions = cl.getSessions(server)
        // A session counts as "deployed" once this server's own baseline has
        // advanced past its last entry -- deployer.js re-seeds BOTH the target's
        // and the source's baseline (stamped with the source's exact change-log
        // position) after every clean deploy, whether it was a specific-session
        // deploy or a Release (which never records a session id at all, so
        // matching deploy-approvals.json's `session` field alone missed almost
        // every real deploy). A failed deploy never advances the baseline, so
        // this also can't mark a session "deployed" when it actually wasn't.
        let baselineEntryId = null
        try { baselineEntryId = require('./tools/tm1deploy/src/diff').loadBaseline(null, server)?._meta?.last_entry_id ?? null }
        catch { /* no baseline yet */ }
        res.json(sessions.map(s => ({
            ...s,
            deployed: baselineEntryId != null && s.max_entry_id != null && s.max_entry_id <= baselineEntryId,
        })))
    }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions/:id/log', (req, res) => {
    try { res.json(cl.getSessionLog(req.params.id)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions/:id/log/verbose', (req, res) => {
    try { res.json(cl.getSessionLogVerbose(req.params.id)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/sessions/:id/description', (req, res) => {
    try { res.json(cl.updateSessionDescription(req.params.id, req.body.description)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/log/recent', (req, res) => {
    try { res.json(cl.getRecentLog(req.query.server)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/log/object', (req, res) => {
    try { res.json(cl.getObjectHistory(req.query.server, req.query.type, req.query.name)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/log/rollback', async (req, res) => {
    try {
        const { entryId, server } = req.body
        if (!gateReadOnly(res, server)) return
        const entry = cl.getEntryById(entryId)
        if (!entry)              return res.status(404).json({ error: 'Entry not found' })
        if (!entry.before_state) return res.status(400).json({ error: 'No before state captured for this entry' })

        const before = entry.before_state
        const client = makeClient(server, req.ideToken)
        const enc    = encodeURIComponent

        if (entry.object_type === 'rules') {
            await client.patch(`Cubes('${enc(entry.object_name)}')`, { Rules: before.text ?? '' })
        } else if (entry.object_type === 'process') {
            await client.patch(`Processes('${enc(entry.object_name)}')`, {
                PrologProcedure:   before.prolog   ?? '',
                MetadataProcedure: before.metadata ?? '',
                DataProcedure:     before.data     ?? '',
                EpilogProcedure:   before.epilog   ?? '',
            })
        } else if (entry.object_type === 'subset') {
            if (before.expression != null) {
                await client.saveSubset(entry.detail, entry.object_name, before.expression)
            } else if (before.elements) {
                await client.saveStaticSubset(entry.detail, entry.object_name, before.elements)
            }
        } else if (entry.object_type === 'view' && before.type === 'mdx') {
            await client.saveView(entry.detail, entry.object_name, before.mdx)
        }

        cl.writeLog({ server, action: 'ROLLED_BACK', objectType: entry.object_type, objectName: entry.object_name, detail: entry.detail, user: req.user })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Servers ───────────────────────────────────────────────────────────────────
app.get('/api/servers', (req, res) => {
    try { res.json(listServersWithFlags()) }
    catch { res.json([]) }
})

// ── Cubes ─────────────────────────────────────────────────────────────────────
app.get('/api/cubes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getCubes())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Dimensions ────────────────────────────────────────────────────────────────
app.post('/api/dimension/create', async (req, res) => {
    try {
        const { server, name } = req.body
        if (!name?.trim() || !server) return res.status(400).json({ error: 'name and server required' })
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await makeClient(server, req.ideToken).createDimension(name)
        const { hasSession } = cl.writeLog({ server, action: 'DIMENSION_CREATED', objectType: 'dimension', objectName: name, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// Bulk import: rows = [{ name, type, parent, weight }]
app.post('/api/dimension/bulk-import', async (req, res) => {
    try {
        const { server, dimension, hierarchy = dimension, rows } = req.body
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const errors = []

        // Pass 1: create all elements in one bulk call
        const validRows = rows.filter(r => r.name?.trim())
        if (validRows.length) {
            try {
                await client.bulkSetElements(dimension, validRows.map(r => ({ name: r.name.trim(), type: r.type || 'N' })), hierarchy)
            } catch (e) {
                errors.push(`Bulk element create: ${e.message}`)
            }
        }

        // Pass 2: create edges (no bulk API — sequential)
        for (const row of rows) {
            if (!row.name?.trim() || !row.parent?.trim()) continue
            try { await client.addEdge(dimension, row.parent.trim(), row.name.trim(), row.weight ?? 1, hierarchy) } catch (e) {
                if (!e.message?.includes('already exists')) errors.push(`${row.parent}→${row.name}: ${e.message}`)
            }
        }
        res.json({ ok: true, errors })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// Bulk attribute import: rows = [{ element, attrName, value }]
app.post('/api/dimension/bulk-attr-import', async (req, res) => {
    try {
        const { server, dimension, hierarchy = dimension, rows } = req.body
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const errors = []
        for (const row of rows) {
            if (!row.element?.trim() || !row.attrName?.trim()) continue
            try { await client.writeElementAttribute(dimension, row.element.trim(), row.attrName.trim(), row.value ?? '', row.type || 'S', hierarchy) }
            catch (e) { errors.push(`${row.element}[${row.attrName}]: ${e.message}`) }
        }
        res.json({ ok: true, errors })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimensions', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getDimensions())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/dimension', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteDimension(req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'DIMENSION_DELETED', objectType: 'dimension', objectName: req.query.name, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/cube', async (req, res) => {
    try {
        const { server, name, dims } = req.body
        if (!server || !name?.trim() || !Array.isArray(dims) || dims.length < 2)
            return res.status(400).json({ error: 'Name and at least 2 dimensions are required' })
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.createCube(name.trim(), dims)
        const { hasSession } = cl.writeLog({ server, action: 'CUBE_CREATED', objectType: 'cube', objectName: name.trim(), user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        console.error('[view/save] error:', e.message, 'data:', JSON.stringify(e.response?.data).slice(0, 300))
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.delete('/api/cube', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteCube(req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'CUBE_DELETED', objectType: 'cube', objectName: req.query.name, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/subset', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteSubset(req.query.dimension, req.query.name, req.query.hierarchy)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'SUBSET_DELETED', objectType: 'subset', objectName: req.query.name, detail: req.query.dimension, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Processes ─────────────────────────────────────────────────────────────────
app.get('/api/processes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        if (req.query.datasource === 'odbc') {
            const d = await client.get('Processes', { '$select': 'Name,DataSource' })
            const names = (d.value ?? [])
                .filter(p => !p.Name.startsWith('}') && p.DataSource?.Type === 'ODBC')
                .map(p => p.Name)
            return res.json(names)
        }
        res.json(await client.getProcesses())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/process', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteProcess(req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'PROCESS_DELETED', objectType: 'process', objectName: req.query.name, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Chores ────────────────────────────────────────────────────────────────────
app.get('/api/chores', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getChores())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/chore', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getChore(req.query.name))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/chore', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.updateChore(req.query.name, req.body)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/chore', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteChore(req.query.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Rules ─────────────────────────────────────────────────────────────────────
app.get('/api/rules', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const cube   = await client.getCube(req.query.cube)
        res.json({ rules: cube?.Rules ?? '' })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/rules', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        const current = await client.getCube(req.query.cube).catch(() => null)
        const beforeState = { text: current?.Rules ?? '' }
        await client.patch(`Cubes('${req.query.cube}')`, { Rules: req.body.rules })
        const afterState  = { text: req.body.rules }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'RULES_SAVED', objectType: 'rules', objectName: req.query.cube, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/rules/check', async (req, res) => {
    try {
        const { server, cube, rules } = req.body
        const client = makeClient(server, req.ideToken)
        const enc = encodeURIComponent
        const result = await client.post(`Cubes('${enc(cube)}')/tm1.CheckRules`, { Rules: rules })
        res.json({ errors: result.value ?? [] })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── Process detail + execute ──────────────────────────────────────────────────
app.get('/api/process', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getProcess(req.query.name))
    } catch (e) {
        console.error('[api/process] GET failed:', e.response?.status, e.response?.data?.error?.message || e.message)
        res.status(500).json({ error: e.message })
    }
})

// TM1 REST API rejects newlines inside open parentheses (multi-line TI expressions).
// Merge any continuation line into the preceding line so the code round-trips safely.
const HANGING_KW = /\b(IF|WHILE|ELSEIF)\s*$/i
function joinContinuations(code) {
    let out = '', depth = 0, inStr = false, lineBuffer = ''
    for (let i = 0; i < code.length; i++) {
        const ch = code[i]
        if (inStr) {
            if (ch === "'") {
                if (code[i + 1] === "'") { out += "''"; lineBuffer += "''"; i++ }
                else { inStr = false; out += ch; lineBuffer += ch }
            } else { out += ch; lineBuffer += ch }
        } else {
            if (ch === '#') {
                out += '#'
                while (i + 1 < code.length && code[i + 1] !== '\n') { out += code[++i] }
            }
            else if (ch === "'") { inStr = true; out += ch; lineBuffer += ch }
            else if (ch === '(') { depth++; out += ch; lineBuffer += ch }
            else if (ch === ')') { depth--; out += ch; lineBuffer += ch }
            else if (ch === '\n') {
                // Join if inside open paren OR previous line ends with IF/WHILE/ELSEIF
                out += (depth > 0 || HANGING_KW.test(lineBuffer)) ? ' ' : '\n'
                lineBuffer = ''
            }
            else { out += ch; lineBuffer += ch }
        }
    }
    return out
}

app.post('/api/process/debug', async (req, res) => {
    const { server, name, params, sections, watches, breakpoints } = req.body
    if (!gateReadOnly(res, server)) return
    const client   = makeClient(server, req.ideToken)
    const tempName = `_IDE_Debug_${Date.now()}`
    let log = '', runError = null

    // ── 1. Fetch source process metadata ─────────────────────────────────────
    let proc
    try {
        proc = await client.get(`Processes('${encodeURIComponent(name)}')`)
    } catch (e) {
        return res.status(500).json({ error: `Failed to create debug process: ${e.message}` })
    }

    const stripMeta   = obj => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('@')))
    const nl          = s   => (s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const jc          = s   => joinContinuations(nl(s))
    const cleanParams = (proc.Parameters ?? []).map(p => ({
        Name: p.Name, Type: p.Type ?? 2, Value: String(p.Value ?? ''), Prompt: p.Prompt ?? '',
    }))

    // ── 2. Ensure __DBG_LOG attribute exists ──────────────────────────────────
    const ATTR         = '__DBG_LOG'
    const safeProcName = name.replace(/'/g, "''")
    const hasCapture   = (watches?.length > 0) || Object.values(breakpoints ?? {}).some(a => a.length > 0)

    if (hasCapture) {
        try {
            await client.post(
                `Dimensions('%7DProcesses')/Hierarchies('%7DProcesses')/ElementAttributes`,
                { Name: ATTR, Type: 'String' }
            )
        } catch (e) { /* 409 = already exists — fine */ }
        try {
            await client.post('ExecuteProcessWithReturn?$expand=*', {
                Process: {
                    Name: '_IDE_ClearDbg',
                    PrologProcedure: `AttrPutS('', '}Processes', '${safeProcName}', '${ATTR}');`,
                    MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
                    HasSecurityAccess: false, DataSource: { Type: 'None' },
                    Parameters: [], Variables: [],
                }
            })
        } catch (e) {
            console.warn('[debug] could not clear __DBG_LOG:', e.message)
        }
    }

    // ── 3. Instrument sections ────────────────────────────────────────────────
    function appendLines(label, lineNum, sectionLabel) {
        const AT = safeProcName
        const lines = [`sDBGLog__IDE__ = ATTRS('}Processes', '${AT}', '${ATTR}');`]
        lines.push(`sDBGLog__IDE__ = sDBGLog__IDE__ | '${label}' | CHAR(10);`)
        for (const w of (watches ?? [])) {
            const val = w.type === 'number' ? `NumberToString(${w.name})` : w.name
            lines.push(`sDBGLog__IDE__ = sDBGLog__IDE__ | '__DBG_VAR:${w.name}__${sectionLabel}__${lineNum}=' | ${val} | CHAR(10);`)
        }
        lines.push(`AttrPutS(sDBGLog__IDE__, '}Processes', '${AT}', '${ATTR}');`)
        return lines
    }

    function instrumentSection(rawCode, sectionKey, sectionLabel) {
        const code  = jc(rawCode ?? '')
        const bpSet = new Set(breakpoints?.[sectionKey] ?? [])
        if (!watches?.length && !bpSet.size) return code

        const lines  = code.split('\n')
        const result = []
        let parenDepth = 0, inStr = false

        const trackDepth = (line) => {
            for (let j = 0; j < line.length; j++) {
                const ch = line[j]
                if (inStr) {
                    if (ch === "'") { if (line[j + 1] === "'") j++; else inStr = false }
                } else {
                    if      (ch === '#')  break
                    else if (ch === "'")  inStr = true
                    else if (ch === '(')  parenDepth++
                    else if (ch === ')')  parenDepth--
                }
            }
        }

        let prevDepth = 0
        for (let i = 0; i < lines.length; i++) {
            const lineNum   = i + 1
            const prevLine  = i > 0 ? lines[i - 1] : ''
            const canInject = prevDepth === 0 && !/^\s*(IF|WHILE|ELSEIF)\s*$/i.test(prevLine)
            if (bpSet.has(lineNum) && canInject) {
                result.push(...appendLines(`__DBG_BP:${lineNum}:${sectionLabel}`, lineNum, sectionLabel))
            }
            result.push(lines[i])
            trackDepth(lines[i])
            prevDepth = parenDepth
        }

        return result.join('\n')
    }

    // ── 4. Create temp process with instrumented code ────────────────────────
    const prologInst = instrumentSection(sections.PrologProcedure,   'PrologProcedure',   'Prolog')
    const metaInst   = (sections.MetaDataProcedure ?? '').trim()
        ? instrumentSection(sections.MetaDataProcedure, 'MetaDataProcedure', 'Metadata')
        : (jc(sections.MetaDataProcedure ?? ''))
    const dataInst   = (sections.DataProcedure ?? '').trim()
        ? instrumentSection(sections.DataProcedure,     'DataProcedure',     'Data')
        : (jc(sections.DataProcedure ?? ''))
    const epilInst   = (sections.EpilogProcedure ?? '').trim()
        ? instrumentSection(sections.EpilogProcedure,   'EpilogProcedure',   'Epilog')
        : (jc(sections.EpilogProcedure ?? ''))

    // ── 4. Create temp process with instrumented code ────────────────────────
    try {
        await client.createOrReplaceProcess({
            name:       tempName,
            prolog:     prologInst,
            metadata:   metaInst,
            data:       dataInst,
            epilog:     epilInst,
            parameters: cleanParams,
        })
    } catch (e) {
        return res.status(500).json({ error: `Failed to create debug process: ${e.message}` })
    }

    // ── 5. Execute ─────────────────────────────────────────────────────────────
    try {
        await client.executeProcess(tempName, params ?? [])
    } catch (e) {
        const data  = e.response?.data
        const inner = data?.error?.innererror ?? {}
        const procErr = data?.error?.details?.ProcessError ?? ''
        console.error('[debug] execute error:', e.response?.status, JSON.stringify(data ?? e.message).slice(0, 400))
        runError = procErr || inner.Message || data?.error?.message || e.message
    }

    // ── 6. Read captured log via MDX ──────────────────────────────────────────
    if (hasCapture) {
        try {
            const mdxMember = name.replace(/\]/g, ']]')
            const mdx = [
                `SELECT {[}ElementAttributes_}Processes].[}ElementAttributes_}Processes].[${ATTR}]} ON COLUMNS,`,
                `{[}Processes].[}Processes].[${mdxMember}]} ON ROWS`,
                `FROM [}ElementAttributes_}Processes]`,
            ].join(' ')
            const result  = await client.executeMDX(mdx)
            const attrLog = (result?.Cells?.[0]?.Value ?? '').replace(/\r/g, '')
            console.log('[debug] MDX raw:', JSON.stringify(attrLog).slice(0, 300))
            if (attrLog.includes('__DBG_BP:')) {
                log      = attrLog + '\n__DBG_DONE:ok'
                runError = null
            }
        } catch (e) {
            console.error('[debug] MDX read failed:', e.message)
        }
    } else if (!runError) {
        log = '__DBG_DONE:ok'
    }

    try { await client.deleteProcess(tempName) }
    catch (e) { console.error('[debug] cleanup failed:', e.message) }

    res.json({ log, error: runError, noCapture: !hasCapture && !runError })
})

app.get('/api/processes/search', async (req, res) => {
    try {
        const { server, q } = req.query
        if (!q || q.length < 2) return res.json({ results: [] })
        const client = makeClient(server, req.ideToken)
        const data = await client.get('Processes', {
            '$select': 'Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure',
        })
        const lower = q.toLowerCase()
        const sections = [
            { key: 'PrologProcedure',    label: 'Prolog'   },
            { key: 'MetadataProcedure',  label: 'Metadata' },
            { key: 'DataProcedure',      label: 'Data'     },
            { key: 'EpilogProcedure',    label: 'Epilog'   },
        ]
        const results = []
        for (const proc of (data.value ?? [])) {
            if (proc.Name.startsWith('}')) continue
            for (const { key, label } of sections) {
                const lines = (proc[key] ?? '').split('\n')
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(lower)) {
                        results.push({ process: proc.Name, section: label, line: i + 1, preview: lines[i].trim().slice(0, 150) })
                    }
                }
            }
        }
        res.json({ results })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/process/log', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const result = await client.get(`Processes('${encodeURIComponent(req.query.name)}')/ErrorLog`)
        const log = typeof result === 'string' ? result : (result?.value ?? '')
        res.json({ log })
    } catch (e) {
        res.json({ log: '' })
    }
})

app.post('/api/process/create', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.post('Processes', {
            Name: req.query.name,
            PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
            DataSource: { Type: 'None' },
            Parameters: [],
            Variables: [],
        })
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'PROCESS_CREATED', objectType: 'process', objectName: req.query.name, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/process', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client  = makeClient(req.query.server, req.ideToken)
        const current = await client.getProcess(req.query.name).catch(() => null)
        const beforeState = current ? {
            prolog:   current.PrologProcedure                             ?? '',
            metadata: current.MetaDataProcedure ?? current.MetadataProcedure ?? '',
            data:     current.DataProcedure                               ?? '',
            epilog:   current.EpilogProcedure                             ?? '',
        } : null
        const body = { ...req.body }
        if ('MetaDataProcedure' in body) {
            body.MetadataProcedure = body.MetaDataProcedure
            delete body.MetaDataProcedure
        }
        await client.patch(`Processes('${req.query.name}')`, body)
        const afterState = {
            prolog:   req.body.PrologProcedure                                       ?? beforeState?.prolog   ?? '',
            metadata: req.body.MetaDataProcedure ?? req.body.MetadataProcedure       ?? beforeState?.metadata ?? '',
            data:     req.body.DataProcedure                                         ?? beforeState?.data     ?? '',
            epilog:   req.body.EpilogProcedure                                       ?? beforeState?.epilog   ?? '',
        }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'PROCESS_SAVED', objectType: 'process', objectName: req.query.name, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        console.error('[api/process] SAVE failed:', e.response?.status, e.response?.data?.error?.message || e.message)
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/process/run', async (req, res) => {
    if (!gateReadOnly(res, req.query.server)) return
    const client   = makeClient(req.query.server, req.ideToken)
    const procName = req.query.name
    const RUN_ATTR = '__RUN_LOG'
    const safeName = procName.replace(/'/g, "''")

    // ── 1. Ensure __RUN_LOG attribute exists and is cleared ──────────────────
    try {
        await client.post(
            `Dimensions('%7DProcesses')/Hierarchies('%7DProcesses')/ElementAttributes`,
            { Name: RUN_ATTR, Type: 'String' }
        )
    } catch (_) { /* 409 = already exists — fine */ }
    try {
        await client.post('ExecuteProcessWithReturn?$expand=*', {
            Process: {
                Name: '_IDE_ClearRunLog',
                PrologProcedure: `AttrPutS('', '}Processes', '${safeName}', '${RUN_ATTR}');`,
                MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
                HasSecurityAccess: false, DataSource: { Type: 'None' },
                Parameters: [], Variables: [],
            }
        })
    } catch (_) { /* non-critical */ }

    // ── 2. Execute the process ────────────────────────────────────────────────
    let duration = null, runError = null, errorSection = null, errorLine = null, errorLogFilename = null
    try {
        const result = await client.executeProcess(procName, req.body.params ?? [])
        duration         = result?.Times?.ExecutionTimeInMilliseconds ?? null
        errorLogFilename = result?.ErrorLogFile?.Filename ?? null
    } catch (e) {
        const inner = e.response?.data?.error?.innererror ?? {}
        console.error('[process/run]', JSON.stringify(inner) || e.message)
        runError         = inner.Message || e.message
        errorSection     = inner.ProcedureSection ?? null
        errorLine        = inner.LineNumber ?? null
        // ErrorLogFile may be in the error response body
        errorLogFilename = e.response?.data?.error?.innererror?.ErrorLogFile?.Filename
                        ?? e.response?.data?.ErrorLogFile?.Filename
                        ?? null
    }

    // ── 3. Read __RUN_LOG back via MDX ────────────────────────────────────────
    let runLog = ''
    try {
        const mdxMember = procName.replace(/\]/g, ']]')
        const mdx = [
            `SELECT {[}ElementAttributes_}Processes].[}ElementAttributes_}Processes].[${RUN_ATTR}]} ON COLUMNS,`,
            `{[}Processes].[}Processes].[${mdxMember}]} ON ROWS`,
            `FROM [}ElementAttributes_}Processes]`,
        ].join(' ')
        const mdxResult = await client.executeMDX(mdx)
        runLog = (mdxResult?.Cells?.[0]?.Value ?? '').replace(/\r/g, '')
        console.log(`[process/run] __RUN_LOG MDX result: "${runLog.slice(0, 200)}"`)
    } catch (e) {
        console.error('[process/run] __RUN_LOG MDX failed:', e.message)
    }

    // ── 4. Fallback: if no __RUN_LOG and process errored, use TM1 ErrorLog ────
    if (!runLog && runError) {
        console.log('[process/run] __RUN_LOG empty, trying ErrorLog fallback')
        try {
            const errLog = await client.get(`Processes('${encodeURIComponent(procName)}')/ErrorLog`)
            runLog = typeof errLog === 'string' ? errLog : (errLog?.value ?? '')
            console.log(`[process/run] ErrorLog result: "${String(runLog).slice(0, 200)}"`)
        } catch (e) {
            console.error('[process/run] ErrorLog fallback failed:', e.message)
        }
    }

    // ── 5. Detect __ERROR: validation marker (written before ProcessQuit) ────────
    if (!runError && runLog.startsWith('__ERROR:')) {
        const msg = runLog.replace(/^__ERROR:/, '').trim()
        console.log(`[process/run] validation quit detected: "${msg}"`)
        return res.status(500).json({ error: msg, section: null, line: null, runLog: msg })
    }

    console.log(`[process/run] final runLog length: ${runLog.length}, runError: ${!!runError}`)
    if (runError) {
        res.status(500).json({ error: runError, section: errorSection, line: errorLine, runLog, errorLogFilename })
    } else {
        res.json({ ok: true, duration, runLog, errorLogFilename })
    }
})

// ── Cube dimensions ───────────────────────────────────────────────────────────
app.get('/api/cube/dimensions', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const cube   = await client.getCube(req.query.cube)
        const dims   = (cube?.Dimensions ?? []).map(d => d.Name)
        res.json(dims)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Dimension attributes ──────────────────────────────────────────────────────
app.get('/api/dimension/attributes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const attrs  = await client.getElementAttributes(req.query.dimension)
        res.json(attrs.map(a => ({ name: a.Name, type: a.Type })))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimension/alias-values', async (req, res) => {
    try {
        const { server, dimension, alias } = req.query
        const client = makeClient(server, req.ideToken)
        res.json(await client.getAliasValues(dimension, alias))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimension/cubes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getCubesForDimension(req.query.dimension))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Attribute grid (all elements × all attrs in one response) ─────────────────
app.get('/api/dimensions/format-attrs', async (req, res) => {
    try {
        const { server, dims } = req.query
        const dimensions = dims ? dims.split(',').filter(Boolean) : []
        if (!dimensions.length) return res.json({})
        const client = makeClient(server, req.ideToken)
        const result = {}
        await Promise.all(dimensions.map(async dim => {
            let map = await client.getAliasValues(dim, 'Format', dim).catch(() => null)
            if (!map || !Object.keys(map).length) {
                map = await client.getFormatAttrs(dim, dim).catch(() => ({}))
            }
            if (Object.keys(map).length) result[dim] = map
        }))
        res.json(result)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimension/attr-grid', async (req, res) => {
    try {
        const { server, dimension, hierarchy } = req.query
        const client = makeClient(server, req.ideToken)
        const [attrs, elements, edges] = await Promise.all([
            client.getElementAttributes(dimension, hierarchy),
            client.getElements(dimension, hierarchy),
            client.getEdges(dimension, hierarchy),
        ])
        const valueEntries = await Promise.all(
            elements.map(async el => {
                try { return [el.Name, await client.getElementAttributeValues(dimension, el.Name, hierarchy)] }
                catch  { return [el.Name, {}] }
            })
        )
        res.json({ attrs, elements, edges, values: Object.fromEntries(valueEntries) })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/dimension/attribute-def', async (req, res) => {
    try {
        const { server, dimension, name, type, hierarchy } = req.body
        if (!gateWrite(res, server)) return
        await makeClient(server, req.ideToken).createElementAttribute(dimension, name, type, hierarchy)
        const { hasSession } = cl.writeLog({ server, action: 'ATTRIBUTE_CREATED', objectType: 'attribute', objectName: name, detail: dimension, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/dimension/attribute-def', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        await makeClient(server, req.ideToken).deleteElementAttribute(dimension, name, hierarchy)
        const { hasSession } = cl.writeLog({ server, action: 'ATTRIBUTE_DELETED', objectType: 'attribute', objectName: name, detail: dimension, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/dimension/attribute/convert-to-alias', async (req, res) => {
    try {
        const { server, dimension, attribute, hierarchy = dimension } = req.body
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const elements = await client.getElements(dimension, hierarchy)
        const pairs = await Promise.all(
            elements.map(async el => {
                try {
                    const vals = await client.getElementAttributeValues(dimension, el.Name, hierarchy)
                    return [el.Name, vals[attribute] ?? null]
                } catch { return [el.Name, null] }
            })
        )
        const toRewrite = pairs.filter(([, v]) => v !== null && String(v) !== '')
        await client.deleteElementAttribute(dimension, attribute, hierarchy)
        await client.createElementAttribute(dimension, attribute, 'Alias', hierarchy)
        await Promise.all(
            toRewrite.map(([element, value]) =>
                client.writeElementAttribute(dimension, element, attribute, String(value), 'S', hierarchy).catch(() => {})
            )
        )
        cl.writeLog({ server, action: 'ATTRIBUTE_CONVERTED', objectType: 'attribute', objectName: attribute, detail: `${dimension} → Alias`, user: req.user })
        res.json({ converted: toRewrite.length })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/element/attribute', async (req, res) => {
    try {
        const { server, dimension, element, attribute, value, type, hierarchy } = req.body
        if (!gateReadOnly(res, server)) return
        await makeClient(server, req.ideToken).writeElementAttribute(dimension, element, attribute, value, type, hierarchy)
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Views ─────────────────────────────────────────────────────────────────────
app.get('/api/views', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getViews(req.query.cube))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/view', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getView(req.query.cube, req.query.name))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/view/execute', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.executeView(req.query.cube, req.query.view))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/view/save', async (req, res) => {
    try {
        const { server, cube, name } = req.query
        const { mdx, nativeAxes } = req.body
        if (!gateWrite(res, server)) return
        const client  = makeClient(server, req.ideToken)
        const current = await client.getView(cube, name).catch(() => null)
        const beforeState = current
            ? current['@odata.type']?.includes('MDXView')
                ? { type: 'mdx', mdx: current.MDX ?? '' }
                : { type: 'native', definition: current }
            : null
        if (nativeAxes) {
            console.log('[view/save] cube=%s name=%s nativeAxes=%s', cube, name, JSON.stringify(nativeAxes).slice(0, 500))
            await client.saveNativeView(cube, name, nativeAxes)
        } else {
            console.log('[view/save] cube=%s name=%s mdx=%s', cube, name, (mdx ?? '').slice(0, 300))
            await client.saveView(cube, name, mdx)
        }
        const afterState = nativeAxes ? { type: 'native', definition: nativeAxes } : { type: 'mdx', mdx: mdx ?? '' }
        const { hasSession } = cl.writeLog({ server, action: 'VIEW_SAVED', objectType: 'view', objectName: name, detail: cube, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.post('/api/view/set-default', async (req, res) => {
    try {
        const { server, cube, name } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.setDefaultView(cube, name)
        res.json({ ok: true, noSession: false })
    } catch (e) {
        console.error('[set-default]', e.message, e.response?.status, e.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : '')
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/view', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteView(req.query.cube, req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'VIEW_DELETED', objectType: 'view', objectName: req.query.name, detail: req.query.cube, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Elements ──────────────────────────────────────────────────────────────────
app.get('/api/elements', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getElements(req.query.dimension, req.query.hierarchy, req.query.index === '1'))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/elements/tree', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const result = await client.getElementsWithTree(req.query.dimension, req.query.hierarchy)
        const sample = result.slice(0, 3)
        console.log('[elements/tree] count:', result.length, 'sample:', JSON.stringify(sample))
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/elements/attributes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getElementsWithAttributes(req.query.dimension, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/element/attributes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getElementAttributeValues(req.query.dimension, req.query.element, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/edges', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getEdges(req.query.dimension, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Dimension element + edge write ───────────────────────────────────────────
app.post('/api/dimension/element', async (req, res) => {
    try {
        const { server, dimension, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.addElement(dimension, req.body.name, req.body.type, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_ADDED', objectType: 'dimension', objectName: req.body.name, detail: dimension, user: req.user })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/element', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.deleteElement(dimension, name, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_DELETED', objectType: 'dimension', objectName: name, detail: dimension, user: req.user })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/dimension/element', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.renameElement(dimension, name, req.body.newName, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_RENAMED', objectType: 'dimension', objectName: req.body.newName, detail: `${dimension} · was: ${name}`, user: req.user })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/dimension/edge', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.addEdge(req.query.dimension, req.body.parent, req.body.child, req.body.weight ?? 1, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/dimension/edge', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.updateEdgeWeight(req.query.dimension, req.query.parent, req.query.child, req.body.weight, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/edge', async (req, res) => {
    try {
        const { server, dimension, parent, child, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.deleteEdge(dimension, parent, child, hierarchy)
        cl.writeLog({ server, action: 'EDGE_REMOVED', objectType: 'dimension', objectName: child, detail: `${dimension} · removed from ${parent}`, user: req.user })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/hierarchies', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getHierarchies(req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/subset/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanSubsetUsage(req.query.dimension, req.query.subset))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/view/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanViewUsage(req.query.cube, req.query.view))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/dimension/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanDimensionUsage(req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/cube/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanCubeUsage(req.query.cube))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/process/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanProcessUsage(req.query.process))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/dimension/hierarchy', async (req, res) => {
    try {
        const { server, dimension, name } = req.body
        if (!gateWrite(res, server)) return
        await makeClient(server, req.ideToken).createHierarchy(dimension, name)
        cl.writeLog({ server, action: 'HIERARCHY_CREATED', objectType: 'dimension', objectName: name, detail: dimension, user: req.user })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/hierarchy', async (req, res) => {
    try {
        const { server, dimension, name } = req.query
        if (!gateWrite(res, server)) return
        await makeClient(server, req.ideToken).deleteHierarchy(dimension, name)
        cl.writeLog({ server, action: 'HIERARCHY_DELETED', objectType: 'dimension', objectName: name, detail: dimension, user: req.user })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Search index — all rules + all process code in one call ──────────────────
app.get('/api/search/index', async (req, res) => {
    console.log('[api/process] request:', req.query.server, req.query.name)
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const [cubes, processes] = await Promise.all([
            client.getCubes(),
            client.getProcesses(),
        ])

        const [rulesResults, processResults] = await Promise.all([
            Promise.all(cubes.map(async name => {
                const cube = await client.getCube(name)
                return { name, rules: cube?.Rules ?? '' }
            })),
            Promise.all(processes.map(async name => {
                const p = await client.getProcess(name)
                return {
                    name,
                    Prolog:   p.PrologProcedure   ?? '',
                    Metadata: p.MetaDataProcedure ?? '',
                    Data:     p.DataProcedure     ?? '',
                    Epilog:   p.EpilogProcedure   ?? '',
                }
            })),
        ])

        res.json({ rules: rulesResults, processes: processResults })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Subsets ───────────────────────────────────────────────────────────────────
app.get('/api/subsets', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getSubsets(req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/subset', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getSubset(req.query.dimension, req.query.name))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/subset', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client      = makeClient(req.query.server, req.ideToken)
        const current     = await client.getSubset(req.query.dimension, req.query.name).catch(() => null)
        const beforeState = current ? { expression: current.Expression ?? '' } : null
        await client.saveSubset(req.query.dimension, req.query.name, req.body.mdx)
        const afterState  = { expression: req.body.mdx }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'SUBSET_SAVED', objectType: 'subset', objectName: req.query.name, detail: req.query.dimension, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.get('/api/subset/elements', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getSubsetElements(req.query.dimension, req.query.name))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/subset/static', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client      = makeClient(req.query.server, req.ideToken)
        const currentEls  = await client.getSubsetElements(req.query.dimension, req.query.name).catch(() => null)
        const beforeState = currentEls ? { elements: currentEls.map(e => e.name) } : null
        await client.saveStaticSubset(req.query.dimension, req.query.name, req.body.elements)
        const afterState  = { elements: req.body.elements ?? [] }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'SUBSET_SAVED', objectType: 'subset', objectName: req.query.name, detail: req.query.dimension, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// Get distinct attribute values for a dimension (samples up to 500 elements)
app.get('/api/dimension/attribute-values', async (req, res) => {
    const { server, dimension, attribute } = req.query
    if (!server || !dimension || !attribute) return res.status(400).json({ error: 'server, dimension and attribute required' })
    try {
        const client = makeClient(server, req.ideToken)
        const elements = await client.getElements(dimension, dimension, { $top: 500 })
        const valueSet = new Set()
        const list = Array.isArray(elements?.value) ? elements.value : Array.isArray(elements) ? elements : []
        for (const el of list) {
            try {
                const vals = await client.getElementAttributeValues(dimension, el.Name, dimension)
                const v = (vals?.value ?? vals)?.[attribute]
                if (v !== undefined && v !== null && v !== '') valueSet.add(String(v))
            } catch {}
        }
        res.json({ values: [...valueSet].sort() })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/subset/preview', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const dim = req.query.dimension
        const members = await client.previewMDX(dim, req.body.mdx, req.body.limit ?? 100)
        // Batch-fetch attributes for up to 100 members
        const toFetch = members.slice(0, 100)
        if (toFetch.length > 0) {
            const attrResults = await Promise.all(
                toFetch.map(m =>
                    client.getElementAttributeValues(dim, m.name, dim)
                        .then(r => r?.value ?? r ?? {})
                        .catch(() => ({}))
                )
            )
            toFetch.forEach((m, i) => { m.attributes = attrResults[i] ?? {} })
        }
        res.json({ members })
    } catch (e) {
        console.error('[subset/preview]', e.message)
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/subset/generate', async (req, res) => {
    if (!ai.isConfigured()) {
        return res.status(400).json({ error: 'AI not configured — set AI_PROVIDER and AI_API_KEY in .env' })
    }
    try {
        const { server, dimension, prompt } = req.body
        const client   = makeClient(server, req.ideToken)
        const elements = await client.getElements(dimension)

        // Obfuscation (AI_OBFUSCATE_NAMES): swap every real name for an opaque
        // token before the request leaves, restore it in the response.
        const obf      = ai.shouldObfuscate()
        const map      = obfuscate.makeMap([dimension, ...elements.slice(0, 200).map(e => e.Name)])
        const hide     = obf ? t => obfuscate.obfuscateText(t, map.realToCode) : t => t
        const show     = obf ? t => obfuscate.restoreText(t, map.codeToReal)      : t => t
        const dimRef   = obf ? map.realToCode.get(dimension) : dimension

        const sample   = elements.slice(0, 200).map(e => `${e.Name} (${e.Type === 'N' ? 'leaf' : e.Type === 'C' ? 'consolidated' : 'string'}, level ${e.Level})`).join('\n')

        const mdx = await ai.complete({
            label: 'subset-generate', obfuscated: obf,
            maxTokens: 1024,
            system: `You are a TM1 MDX expert. Generate a valid TM1 MDX set expression for the given dimension.
Rules:
- Return ONLY the raw MDX expression — no markdown, no explanation, no code fences.
- The expression MUST be wrapped in outer curly braces {} to form a valid set literal.
- Use the dimension name exactly as provided.
- Reference members as [{dim}].[{dim}].[MemberName] or use set functions directly.
- Common functions: TM1FilterByLevel, TM1FilterByPattern, TM1Sort, TopCount, BottomCount, Filter, CrossJoin, Descendants, Children, Ancestors, Members.
- Leaf members are Type=N (level 0). Consolidated members are Type=C (level > 0).
- Example: {TM1FilterByLevel({[{dim}].[{dim}].Members}, 0)}`.replaceAll('{dim}', dimRef),
            user: hide(`Dimension: ${dimension}\n\nSample elements (up to 200):\n${sample}\n\nRequest: ${prompt}`),
        })

        res.json({ mdx: show(mdx) })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/mdx/generate', async (req, res) => {
    if (!ai.isConfigured()) {
        return res.status(400).json({ error: 'AI not configured — set AI_PROVIDER and AI_API_KEY in .env' })
    }
    try {
        const { server, cube, prompt } = req.body
        const client = makeClient(server, req.ideToken)
        const cubeMeta = await client.getCube(cube)
        const dims = (cubeMeta?.Dimensions ?? []).map(d => d.Name)

        // Fetch element samples for each dimension in parallel (max 60 per dim)
        const dimSamples = await Promise.all(dims.map(async dim => {
            try {
                const elems = await client.getElements(dim)
                const leaves = elems.filter(e => e.Type === 'N').slice(0, 30).map(e => e.Name)
                const consol = elems.filter(e => e.Type === 'C').slice(0, 20).map(e => e.Name)
                return { dim, leaves, consol, total: elems.length }
            } catch { return { dim, leaves: [], consol: [], total: 0 } }
        }))

        const dimContext = dimSamples.map(({ dim, leaves, consol, total }) => {
            const parts = []
            if (consol.length) parts.push(`  Consolidated: ${consol.join(', ')}`)
            if (leaves.length) parts.push(`  Leaf: ${leaves.join(', ')}`)
            return `${dim} (${total} elements)\n${parts.join('\n')}`
        }).join('\n\n')

        // Obfuscation (AI_OBFUSCATE_NAMES): hide every real cube/dim/element name
        // in what we send; the model still sees structure. Restore in response.
        const obf = ai.shouldObfuscate()
        const map = obfuscate.makeMap([
            cube,
            ...dimSamples.flatMap(d => [d.dim, ...d.leaves, ...d.consol]),
        ])
        const hide = obf ? t => obfuscate.obfuscateText(t, map.realToCode) : t => t
        const show = obf ? t => obfuscate.restoreText(t, map.codeToReal)      : t => t

        const mdx = await ai.complete({
            label: 'mdx-generate', obfuscated: obf,
            maxTokens: 2048,
            system: `You are a TM1 MDX expert. Generate a valid TM1 MDX SELECT query for the given cube.
Rules:
- Return ONLY the raw MDX — no markdown, no explanation, no code fences.
- Use standard TM1 MDX syntax: SELECT ... ON COLUMNS, ... ON ROWS FROM [Cube] WHERE (...)
- Reference members as [Dim].[Dim].[MemberName]
- Sets must be wrapped in {}. Use NON EMPTY where appropriate.
- The last dimension is typically the measures dimension and goes ON COLUMNS.
- Common set functions: TM1FilterByLevel, TM1FilterByPattern, TM1Sort, TopCount, BottomCount, Filter, Children, Descendants, Members, CrossJoin.
- Leaf members are level-0 numeric elements. Consolidated members are higher-level aggregations.
- If only one dimension member is needed for a dimension, use it as a WHERE slicer, not ON an axis.
- Keep it correct and executable. If uncertain about a member name, use a safe set like {[Dim].[Dim].Members}.`,
            user: hide(`Cube: ${cube}\n\nDimensions and sample members:\n${dimContext}\n\nRequest: ${prompt}`),
        })

        res.json({ mdx: show(mdx) })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── View → axis config (execute view, return cellset + axis dim names) ───────
// Extract member names from an inline Subset Expression like {[Dim].[Hier].[M1], [Dim].[Hier].[M2]}
function extractMembersFromExpression(expr) {
    if (!expr) return null
    const trimmed = expr.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
    const matches = [...trimmed.matchAll(/\[[^\]]+\]\.\[[^\]]+\]\.\[([^\]]+)\]/g)]
    return matches.length > 0 ? matches.map(m => m[1]) : null
}

app.get('/api/view/axes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const [data, viewDef] = await Promise.all([
            client.executeView(req.query.cube, req.query.view),
            client.getViewWithSubsets(req.query.cube, req.query.view),
        ])
        console.log('[view/axes] viewDef keys:', viewDef ? Object.keys(viewDef) : 'null', 'has _rows:', !!viewDef?._rows, 'has Rows:', !!(viewDef?.Rows?.length), 'Rows[0] keys:', viewDef?.Rows?.[0] ? Object.keys(viewDef.Rows[0]) : 'none', '_rows sample:', viewDef?._rows ? JSON.stringify(viewDef._rows).slice(0, 500) : 'none')
        // Parse dimension names from UniqueName: [Dim].[Hier].[Member] → Dim
        const parseDim = (uniqueName) => uniqueName?.match(/^\[([^\]]+)\]/)?.[1] ?? null
        const axisConfig = data.Axes.map(ax => ({
            ordinal: ax.Ordinal,
            dimensions: [...new Set(
                (ax.Tuples?.[0]?.Members ?? []).map(m => parseDim(m.UniqueName)).filter(Boolean)
            )],
            selectedMembers: ax.Ordinal === 2
                ? (ax.Tuples?.[0]?.Members ?? []).map(m => ({ dimension: parseDim(m.UniqueName), member: m.Name }))
                : [],
        }))
        // Build raw native config from view definition
        const extractAxis = (placement) => {
            const expr = (placement.Subset?.Expression ?? '').trim()
            const hasNamedSubset = !!(placement.SubsetName ?? (placement.Subset?.Name || null))
            return {
                dimension: placement.DimensionName ?? placement.Name,
                subset:    placement.SubsetName ?? (placement.Subset?.Name || null),
                memberSet: !hasNamedSubset && /^TM1SubsetAll\(/i.test(expr) ? 'all'
                         : !hasNamedSubset && /^TM1FILTERBYLEVEL\s*\(/i.test(expr) ? 'leaf'
                         : null,
                members:   !hasNamedSubset ? extractMembersFromExpression(expr) : null,
            }
        }
        const extractTitle = (t) => ({
            dimension: t.DimensionName ?? t.Name,
            member:    t.Selection?.Name ?? null,
        })
        const rawNative = viewDef ? {
            rows:    (viewDef.Rows ?? []).length > 0 ? (viewDef.Rows ?? []).map(extractAxis) : (viewDef._rows ?? []),
            columns: (viewDef.Columns ?? []).length > 0 ? (viewDef.Columns ?? []).map(extractAxis) : (viewDef._columns ?? []),
            titles:  (viewDef.Titles ?? []).length > 0 ? (viewDef.Titles ?? []).map(extractTitle) : (viewDef._titles ?? []),
            suppressEmptyRows:    !!viewDef.SuppressEmptyRows,
            suppressEmptyColumns: !!viewDef.SuppressEmptyColumns,
        } : null

        // Rebuild nativeConfig using axisConfig (cellset) for correct axis placement
        // and rawNative for subset/member info
        let nativeConfig = rawNative
        if (rawNative && axisConfig.length) {
            const dimInfo = {}
            for (const d of [...rawNative.rows, ...rawNative.columns, ...rawNative.titles])
                if (d.dimension) dimInfo[d.dimension] = { subset: d.subset ?? null, memberSet: d.memberSet ?? null, members: d.members ?? null }

            const colAxis    = axisConfig.find(a => a.ordinal === 0)
            const rowAxis    = axisConfig.find(a => a.ordinal === 1)
            const filterAxis = axisConfig.find(a => a.ordinal === 2)

            nativeConfig = {
                columns: (colAxis?.dimensions ?? []).map(d => ({ dimension: d, subset: dimInfo[d]?.subset ?? null, memberSet: dimInfo[d]?.memberSet ?? null, members: dimInfo[d]?.members ?? null })),
                rows:    (rowAxis?.dimensions ?? []).map(d => ({ dimension: d, subset: dimInfo[d]?.subset ?? null, memberSet: dimInfo[d]?.memberSet ?? null, members: dimInfo[d]?.members ?? null })),
                titles:  (filterAxis?.selectedMembers ?? rawNative.titles ?? []).map(t => ({
                    dimension: t.dimension,
                    member:    t.member ?? rawNative.titles?.find(n => n.dimension === t.dimension)?.member ?? null,
                })),
                suppressEmptyRows:    rawNative.suppressEmptyRows,
                suppressEmptyColumns: rawNative.suppressEmptyColumns,
            }
        }

        // For MDX views, return the MDX text so the client can parse it back to axes
        const mdxText = (viewDef && viewDef['@odata.type']?.includes('MDXView')) ? (viewDef.MDX || null) : null
        res.json({ axisConfig, cellset: data, viewType: data.ViewType, nativeConfig, mdx: mdxText })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── Native View Execute (with suppression toggle) ────────────────────────────
app.post('/api/view/execute-suppressed', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const { suppressZeros } = req.body
        res.json(await client.executeViewWithSuppression(req.query.cube, req.query.view, suppressZeros))
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── MDX Execute ──────────────────────────────────────────────────────────────
app.post('/api/mdx/execute', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.executeMDX(req.body.mdx))
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── Rules lineage ─────────────────────────────────────────────────────────────
function parseDbRefs(rules) {
    const refs = new Set()
    const re = /\bDB[S]?\s*\(\s*'([^']+)'/gi
    let m
    while ((m = re.exec(rules)) !== null) refs.add(m[1])
    return [...refs]
}

app.get('/api/lineage', async (req, res) => {
    try {
        const client   = makeClient(req.query.server, req.ideToken)
        const root     = req.query.cube
        const maxDepth = Math.min(parseInt(req.query.depth ?? '4'), 6)
        const visited  = new Set()
        const tree     = {}

        async function traverse(cube, depth) {
            if (depth === 0 || visited.has(cube)) return
            visited.add(cube)
            try {
                const data   = await client.getCube(cube)
                const rules  = data?.Rules ?? ''
                const sources = parseDbRefs(rules)
                tree[cube]   = { sources, hasRules: rules.trim().length > 0 }
                await Promise.all(sources.map(s => traverse(s, depth - 1)))
            } catch {
                tree[cube] = { sources: [], hasRules: false, error: true }
            }
        }

        await traverse(root, maxDepth)
        res.json({ root, tree })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/lineage/consumers', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const target = req.query.cube
        const cubes  = await client.getCubes()
        const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re      = new RegExp(`\\bDB[S]?\\s*\\(\\s*'${escaped}'`, 'i')

        const consumers = (await Promise.all(
            cubes
                .filter(name => name !== target)
                .map(async name => {
                    try {
                        const data = await client.getCube(name)
                        return re.test(data?.Rules ?? '') ? name : null
                    } catch { return null }
                })
        )).filter(Boolean)

        res.json({ cube: target, consumers })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── PAW Book Usage — which books reference a TM1 view ─────────────────────────
app.get('/api/paw/book-usage', async (req, res) => {
    try {
        const { server, cube, view } = req.query
        if (!server || !cube) return res.json({ books: [] })

        if (!PAW_HOST) return res.json({ books: [], pawUnavailable: true })

        let pawSession, csrf
        try {
            pawSession = await getCachedPawSession(req.ideToken)
            csrf = await getCSRF(pawSession)
        } catch {
            return res.json({ books: [], pawUnavailable: true })
        }
        const base = `${PAW_HOST}/pacontent/v1`

        // Recursively collect TM1 view references from PAW book content
        function collectViews(items) {
            const views = []
            for (const item of items) {
                const feats = item.features || {}
                const candidates = [
                    feats.PAProperties?.tm1,
                    feats.Models_internal?.data?.parentStore,
                ]
                for (const tm1 of candidates) {
                    if (tm1?.cube) {
                        const v = {
                            server: tm1.server || '',
                            cube:   tm1.cube || '',
                            view:   tm1.view || '',
                        }
                        if (!views.some(x => x.server === v.server && x.cube === v.cube && x.view === v.view)) {
                            views.push(v)
                        }
                    }
                }
                if (item.items) {
                    for (const v of collectViews(item.items)) {
                        if (!views.some(x => x.server === v.server && x.cube === v.cube && x.view === v.view)) {
                            views.push(v)
                        }
                    }
                }
            }
            return views
        }

        function extractTabs(content) {
            if (!content || !content.layout) return []
            const tabs = []
            for (const item of content.layout.items || []) {
                if (item.type === 'container') {
                    const name = item.title?.translationTable?.Default || 'Tab'
                    tabs.push({ name, views: collectViews(item.items || []) })
                }
            }
            return tabs
        }

        // Walk PAW content tree looking for books
        // PAW 2.1.8 uses 'folder' (lowercase) and book types 'dashboard'/'workbench'
        const encodePath = (p) => encodeURIComponent(encodeURIComponent(p))
        const books = []
        const walk = async (path) => {
            const url = `${base}/Assets(path='${encodePath(path)}')/Assets`
            try {
                const r = await pawSession.get(url, {
                    headers: { 'ba-sso-authenticity': csrf },
                    params: { '$select': 'name,id,path,type' }
                })
                for (const item of (r.data?.value ?? [])) {
                    if (item.type === 'folder') {
                        await walk(item.path)
                    } else if (item.type === 'dashboard' || item.type === 'workbench') {
                        try {
                            const book = await pawSession.get(
                                `${base}/Assets(path='${encodePath(item.path)}')?$expand=content`,
                                { headers: { 'ba-sso-authenticity': csrf } }
                            )
                            const content = book.data?.content
                            const tabs = extractTabs(content)
                            const found = tabs.some(tab =>
                                tab.views.some(v =>
                                    v.cube === cube && (!view || v.view === view) && v.server === server
                                )
                            )
                            if (found) {
                                books.push({
                                    name: item.name,
                                    path: item.path,
                                    id: item.id,
                                })
                            }
                        } catch { /* ignore unreadable books */ }
                    }
                }
            } catch { /* ignore inaccessible folders */ }
        }

        await walk('/shared')
        await walk('/users')

        res.json({ books, pawHost: PAW_HOST })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Model objects (non-control) ───────────────────────────────────────────────
app.get('/api/model/cubes', async (req, res) => {
    try {
        res.json(await makeClient(req.query.server, req.ideToken).getModelCubes())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/model/dimensions', async (req, res) => {
    try {
        res.json(await makeClient(req.query.server, req.ideToken).getModelDimensions())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Chore execute / activate / deactivate / create ────────────────────────────
app.post('/api/chore/execute', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.query.server)) return
        await makeClient(req.query.server, req.ideToken).executeChore(req.query.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/chore/activate', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.query.server)) return
        await makeClient(req.query.server, req.ideToken).activateChore(req.query.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/chore/deactivate', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.query.server)) return
        await makeClient(req.query.server, req.ideToken).deactivateChore(req.query.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/chore', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.query.server)) return
        await makeClient(req.query.server, req.ideToken).createChore(req.body)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Jobs ──────────────────────────────────────────────────────────────────────
app.get('/api/jobs', async (req, res) => {
    try {
        res.json(await makeClient(req.query.server, req.ideToken).getJobs())
    } catch (e) {
        // Jobs endpoint is V12+ only — return empty list with flag for V11 servers
        const is404 = e.message?.includes('404') || e.response?.status === 404
        if (is404) return res.json({ items: [], v12only: true })
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/job/cancel', async (req, res) => {
    try {
        await makeClient(req.query.server, req.ideToken).cancelJob(req.query.id)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Process error logs ────────────────────────────────────────────────────────
app.get('/api/process/errorlogs', async (req, res) => {
    try {
        res.json(await makeClient(req.query.server, req.ideToken).getErrorLogFiles())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/process/errorlog/content', async (req, res) => {
    try {
        const content = await makeClient(req.query.server, req.ideToken).getErrorLogContent(req.query.filename)
        res.json({ content })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Cell calculation trace ────────────────────────────────────────────────────
app.post('/api/cube/trace', async (req, res) => {
    try {
        const { server, cube, dimElemPairs } = req.body
        res.json(await makeClient(server, req.ideToken).traceCellCalculation(cube, dimElemPairs))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/cube/feeders', async (req, res) => {
    try {
        const { server, cube, dimElemPairs } = req.body
        res.json(await makeClient(server, req.ideToken).checkFeedersOfCell(cube, dimElemPairs))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/cube/breakdown', async (req, res) => {
    try {
        const { server, cube, dimElemPairs } = req.body
        const client = makeClient(server, req.ideToken)

        // Classify each element — C (has children) vs leaf (no children)
        const classified = await Promise.all(dimElemPairs.map(async p => {
            const children = await client.getElementChildren(p.dim, p.element).catch(() => [])
            return { ...p, children, isC: children.length > 0 }
        }))

        const cDims = classified.filter(d => d.isC)
        if (!cDims.length) return res.json({ sections: [], note: 'All elements are at leaf level' })

        // One MDX query per C-dim, keeping other dims at their current member
        const sections = await Promise.all(cDims.map(async cd => {
            const where   = classified.filter(d => d.dim !== cd.dim)
                                      .map(d => `[${d.dim}].[${d.dim}].[${d.element}]`)
            const setExpr = cd.children.map(c => `[${cd.dim}].[${cd.dim}].[${c.name}]`).join(', ')
            const mdx     = [`SELECT NON EMPTY {${setExpr}} ON COLUMNS`, `FROM [${cube}]`,
                             where.length ? `WHERE (${where.join(', ')})` : ''].filter(Boolean).join(' ')
            try {
                const result = await client.executeMDX(mdx)
                const tuples = result.Axes?.[0]?.Tuples ?? []
                const cells  = result.Cells ?? []
                const rows = tuples.map((t, i) => ({
                    element: t.Members?.[0]?.Name ?? '?',
                    weight:  cd.children.find(c => c.name === t.Members?.[0]?.Name)?.weight ?? 1,
                    value:   cells[i]?.Value ?? null,
                })).filter(r => r.value !== null).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                const abs = rows.reduce((s, r) => s + Math.abs(r.value ?? 0), 0)
                return {
                    dim: cd.dim, element: cd.element,
                    rows: rows.map(r => ({ ...r, pct: abs > 0 ? Math.round(Math.abs(r.value) / abs * 100) : 0 })),
                }
            } catch (e) {
                return { dim: cd.dim, element: cd.element, rows: [], error: e.message }
            }
        }))
        res.json({ sections })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/cube/leaves', async (req, res) => {
    try {
        const { server, cube, dimElemPairs } = req.body
        const client = makeClient(server, req.ideToken)

        const classified = await Promise.all(dimElemPairs.map(async p => {
            const children = await client.getElementChildren(p.dim, p.element).catch(() => [])
            return { ...p, children, isC: children.length > 0 }
        }))

        const cDims = classified.filter(d => d.isC)
        if (!cDims.length) return res.json({ sections: [], note: 'All elements are at leaf level' })

        const sections = await Promise.all(cDims.map(async cd => {
            // Fetch all edges once — build parent→children map, then BFS to find all leaf descendants
            const edges    = await client.getEdges(cd.dim)
            const childMap = new Map()
            for (const e of edges) {
                if (!childMap.has(e.ParentName)) childMap.set(e.ParentName, [])
                childMap.get(e.ParentName).push(e.ComponentName)
            }
            const leaves = [], queue = [cd.element], visited = new Set()
            while (queue.length) {
                const curr = queue.shift()
                if (visited.has(curr)) continue
                visited.add(curr)
                const kids = childMap.get(curr) ?? []
                if (kids.length) queue.push(...kids)
                else leaves.push(curr)
            }
            if (!leaves.length) return { dim: cd.dim, element: cd.element, rows: [], totalLeaves: 0 }

            const CAP     = 100
            const leafSet = leaves.slice(0, CAP)
            const where   = classified.filter(d => d.dim !== cd.dim)
                                      .map(d => `[${d.dim}].[${d.dim}].[${d.element}]`)
            const setExpr = leafSet.map(l => `[${cd.dim}].[${cd.dim}].[${l}]`).join(', ')
            const mdx     = [`SELECT NON EMPTY {${setExpr}} ON COLUMNS`, `FROM [${cube}]`,
                             where.length ? `WHERE (${where.join(', ')})` : ''].filter(Boolean).join(' ')
            try {
                const result = await client.executeMDX(mdx)
                const tuples = result.Axes?.[0]?.Tuples ?? []
                const cells  = result.Cells ?? []
                const rows = tuples.map((t, i) => ({
                    element: t.Members?.[0]?.Name ?? '?',
                    value:   cells[i]?.Value ?? null,
                }))
                .filter(r => r.value !== null && r.value !== 0)
                .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                .slice(0, 50)
                const abs = rows.reduce((s, r) => s + Math.abs(r.value ?? 0), 0)
                return {
                    dim: cd.dim, element: cd.element,
                    rows: rows.map(r => ({ ...r, pct: abs > 0 ? Math.round(Math.abs(r.value) / abs * 100) : 0 })),
                    totalLeaves: leaves.length, capped: leaves.length > CAP,
                }
            } catch (e) {
                return { dim: cd.dim, element: cd.element, rows: [], error: e.message, totalLeaves: leaves.length }
            }
        }))
        res.json({ sections })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/cube/rules/check-references', async (req, res) => {
    try {
        const { server, cube, rules } = req.body
        res.json(await makeClient(server, req.ideToken).checkRulesReferences(cube, rules))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/process/check-references', async (req, res) => {
    try {
        const { server, sections } = req.body
        res.json(await makeClient(server, req.ideToken).checkTIReferences(sections))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/cube/check-feeders-for-rules', async (req, res) => {
    try {
        const { server, cube } = req.body
        await makeClient(server, req.ideToken).checkFeedersForRules(cube)
        res.json({ ok: true })
    } catch (e) {
        if (e.response?.status === 404) {
            return res.json({ unsupported: true, message: 'Feeder check is not supported on this TM1 server version' })
        }
        res.status(500).json({ error: e.message })
    }
})

// ── Cell annotations ──────────────────────────────────────────────────────────
app.get('/api/cube/annotations', async (req, res) => {
    try {
        const { server, cube } = req.query
        res.json(await makeClient(server, req.ideToken).getAnnotations(cube))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/cube/annotations', async (req, res) => {
    try {
        const { server, cube, dimElemPairs, text } = req.body
        if (!gateReadOnly(res, server)) return
        res.json(await makeClient(server, req.ideToken).addAnnotation(cube, dimElemPairs, text))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/cube/annotations/:id', async (req, res) => {
    try {
        const { server } = req.query
        if (!gateReadOnly(res, server)) return
        res.json(await makeClient(server, req.ideToken).deleteAnnotation(req.params.id))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Transaction log ───────────────────────────────────────────────────────────
app.get('/api/transactions', async (req, res) => {
    try {
        const { server, cube, top, elements } = req.query
        const parsed = elements ? JSON.parse(elements) : null
        res.json(await makeClient(server, req.ideToken).getTransactionLog(cube, {
            top:      top ? parseInt(top) : 200,
            elements: parsed,
        }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── File management ───────────────────────────────────────────────────────────
app.get('/api/files/list', async (req, res) => {
    try {
        const { server, path: p } = req.query
        const pathParts = p ? JSON.parse(p) : ['Files']
        res.json(await makeClient(server, req.ideToken).listFiles(pathParts))
    } catch (e) {
        const is404 = e.response?.status === 404 || e.message?.includes('404')
        if (is404) return res.status(404).json({ error: 'File browsing is not available on this server. The Contents API requires Planning Analytics v12 or later.' })
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/files/content', async (req, res) => {
    try {
        const { server, path: p, name } = req.query
        const pathParts = p ? JSON.parse(p) : ['Files']
        const client = makeClient(server, req.ideToken)
        // Get raw content — stream back as download (binary, must bypass the JSON-returning adapter.get)
        const session = await getCachedPawSession(req.ideToken)
        const csrf    = await getCSRF(session)
        const apiPath = `${client._contentsPath(pathParts)}/Contents('${encodeURIComponent(name)}')/Content`
        const url     = `${PAW_HOST}/api/v0/tm1/${server}/api/v1/${apiPath}`
        const r = await session.get(url, { headers: { 'ba-sso-authenticity': csrf }, responseType: 'arraybuffer' })
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
        res.setHeader('Content-Type', 'application/octet-stream')
        res.send(Buffer.from(r.data))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/files/upload', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    try {
        const { server, path: p, name } = req.query
        if (!gateReadOnly(res, server)) return
        const pathParts = p ? JSON.parse(p) : ['Files']
        const client = makeClient(server, req.ideToken)
        // Create the document entry (ignore 409 if already exists)
        try { await client.createFileDocument(pathParts, name) } catch (e) {
            if (!e.message?.includes('already exists') && !(e.response?.status === 409)) throw e
        }
        await client.putFileContent(pathParts, name, req.body)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/files', async (req, res) => {
    try {
        const { server, path: p, name } = req.query
        if (!gateReadOnly(res, server)) return
        const pathParts = p ? JSON.parse(p) : ['Files']
        await makeClient(server, req.ideToken).deleteFile(pathParts, name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── TM1 sessions ──────────────────────────────────────────────────────────────
app.get('/api/tm1-sessions', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const sessions = await client.getSessions()
        res.json(sessions)
    } catch (e) {
        console.error('[sessions] error:', e.response?.status, e.response?.data ?? e.message)
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/session', async (req, res) => {
    try {
        await makeClient(req.query.server, req.ideToken).disconnectSession(req.query.id)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/threads', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const threads = await client.getThreads()
        res.json(threads)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/thread/cancel', async (req, res) => {
    try {
        await makeClient(req.query.server, req.ideToken).cancelThread(req.query.id)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Server admin ─────────────────────────────────────────────────────────────
app.get('/api/admin/metrics', async (req, res) => {
    try {
        const { server, cube } = req.query
        res.json(await makeClient(server, req.ideToken).getMetrics(cube || null))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/admin/configuration', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getActiveConfiguration())
    } catch (e) {
        console.error('[config] error:', e.response?.status, e.response?.data ?? e.message)
        res.status(500).json({ error: e.message })
    }
})

// ── Server version (drives function-catalog compat gating) ────────────────────
app.get('/api/server/version', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json({ version: await client.getProductVersion() })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.patch('/api/admin/configuration', async (req, res) => {
    try {
        const { server, section = 'Administration', values } = req.body
        if (!gateReadOnly(res, server)) return
        res.json(await makeClient(server, req.ideToken).patchStaticConfiguration(section, values))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/admin/maintenance/enable', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.body.server)) return
        res.json(await makeClient(req.body.server, req.ideToken).enableMaintenanceMode())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/admin/maintenance/disable', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.body.server)) return
        res.json(await makeClient(req.body.server, req.ideToken).disableMaintenanceMode())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── User management ───────────────────────────────────────────────────────────
// Acts on the server selected in the UI (?server= / body.server); the login
// server only when none is given.
const userServer = (req) => req.query?.server ?? req.body?.server ?? PAW_LOGIN_SERVER
app.post('/api/users/provision', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        const { name, password, groups = [], friendlyName = '' } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.createClient(name, password, friendlyName)
        for (const g of groups) {
            try { await cl.addClientToGroup(name, g) } catch {}
        }
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data ?? e.message
        console.error('[provisionUser]', e.response?.status, JSON.stringify(detail))
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.post('/api/users/:name/password', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        const { password } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.resetClientPassword(req.params.name, password)
        // Reset your own login on this server → keep the IDE signed in with the new one.
        const mine = getServerCredentials(req.ideToken, userServer(req))
        if (mine && mine.username.toLowerCase() === req.params.name.toLowerCase()) {
            setServerCredentials(req.ideToken, userServer(req), { username: mine.username, password }, mine.state)
        }
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.get('/api/users', async (req, res) => {
    try {
        const cl = makeClient(userServer(req), req.ideToken)
        res.json(await cl.getClients())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/users', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        const { name, password, friendlyName } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        res.json(await cl.createClient(name, password, friendlyName))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/users/:name', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        const { server: _s, ...patch } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.updateClient(req.params.name, patch)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/users/:name', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.deleteClient(req.params.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/groups', async (req, res) => {
    try {
        const cl = makeClient(userServer(req), req.ideToken)
        res.json(await cl.getGroups())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/users/:name/groups', async (req, res) => {
    try {
        const cl = makeClient(userServer(req), req.ideToken)
        res.json(await cl.getClientGroups(req.params.name))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/users/:name/groups', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        const { group } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.addClientToGroup(req.params.name, group)
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data ?? e.message
        console.error('[addClientToGroup]', e.response?.status, JSON.stringify(detail))
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.delete('/api/users/:name/groups/:group', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.removeClientFromGroup(req.params.name, req.params.group)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Forge (workspace persistence) ────────────────────────────────────────────
// ── Control Objects ───────────────────────────────────────────────────────────
app.get('/api/control/objects', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getControlObjects())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Period Builder ────────────────────────────────────────────────────────────
// Saves 3 TI processes to the target TM1 server.
// Request body: { server, processes: [{name, prolog, metadata, data, epilog, parameters}] }
app.post('/api/period-builder/run', async (req, res) => {
    const { server, processes } = req.body
    if (!server || !Array.isArray(processes)) {
        return res.status(400).json({ ok: false, error: 'server and processes required' })
    }
    if (!gateReadOnly(res, server)) return
    try {
        const client = makeClient(server, req.ideToken)
        for (const proc of processes) {
            await client.createOrReplaceProcess(proc)
        }
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message
        console.error('[period-builder]', detail)
        res.status(500).json({ ok: false, error: detail })
    }
})

app.get('/api/forge', (req, res) => {
    try {
        const data = fs.existsSync(FORGE_PATH)
            ? JSON.parse(fs.readFileSync(FORGE_PATH, 'utf8'))
            : {}
        res.json(data)
    } catch { res.json({}) }
})

app.post('/api/forge', (req, res) => {
    try {
        fs.mkdirSync(path.dirname(FORGE_PATH), { recursive: true })
        fs.writeFileSync(FORGE_PATH, JSON.stringify(req.body, null, 2))
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── SQL Editor ───────────────────────────────────────────────────────────────

const SQL_PASSWORD_MASK = '••••••••'

app.get('/api/sql/connections', (req, res) => {
    res.json(loadConnections().map(c => ({ ...c, password: c.password ? SQL_PASSWORD_MASK : '' })))
})

app.post('/api/sql/connections', (req, res) => {
    try {
        const conns = loadConnections()
        const conn  = { ...req.body, id: req.body.id || `sql-${Date.now()}` }
        const idx   = conns.findIndex(c => c.id === conn.id)
        // The edit form starts from the masked list entry — an untouched password
        // field comes back as the mask, which means "keep the stored one".
        if (conn.password === SQL_PASSWORD_MASK) conn.password = idx >= 0 ? conns[idx].password : ''
        if (idx >= 0) conns[idx] = conn; else conns.push(conn)
        saveConnections(conns)
        res.json({ ok: true, id: conn.id })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/sql/connections/:id', (req, res) => {
    try {
        saveConnections(loadConnections().filter(c => c.id !== req.params.id))
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sql/test', async (req, res) => {
    try {
        const conn = req.body.id ? getConnection(req.body.id) : req.body
        if (!conn) return res.status(404).json({ error: 'Connection not found' })
        await testConnection(conn)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sql/execute', async (req, res) => {
    try {
        const conn = req.body.connectionId ? getConnection(req.body.connectionId) : req.body.connection
        if (!conn) return res.status(404).json({ error: 'Connection not found' })
        const start  = Date.now()
        const result = await executeQuery(conn, req.body.sql, req.body.params)
        res.json({ ...result, duration: Date.now() - start })
    } catch (e) {
        console.error('[sql/execute]', e.message)
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/sql/schema/:id', async (req, res) => {
    try {
        const conn = getConnection(req.params.id)
        if (!conn) return res.status(404).json({ error: 'Connection not found' })
        res.json(await getSchema(conn))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sql/post-to-ti', async (req, res) => {
    try {
        const { connectionId, sql, server, processName, createNew = false } = req.body
        if (!connectionId || !sql || !server || !processName)
            return res.status(400).json({ error: 'connectionId, sql, server and processName are required' })
        if (!gateReadOnly(res, server)) return

        const conn = getConnection(connectionId)
        if (!conn) return res.status(404).json({ error: 'Connection not found' })
        if (!conn.dsn) return res.status(400).json({ error: 'Connection has no TM1 DSN configured' })

        const client = makeClient(server, req.ideToken)

        // Parse ?pParam? tokens from SQL
        const tokens = [...new Set([...sql.matchAll(/\?(\w+)\?/g)].map(m => m[1]))]

        // Prep TM1 comment header
        const paramList = tokens.length ? `-- Parameters: ${tokens.map(t => '?' + t + '?').join(', ')}\n` : ''
        const header    = `-- TM1 Process Datasource (via IDE)\n-- DSN: ${conn.dsn}\n${paramList}--\n\n`
        const sqlWithHeader = header + sql

        // TM1 REST API: all ODBC fields are camelCase inside the DataSource object
        const odbcProps = {
            DataSource: {
                Type:                   'ODBC',
                dataSourceNameForServer: conn.dsn,
                dataSourceNameForClient: '',
                query:                   sqlWithHeader,
                userName:                '',
                password:                '',
                usesUnicode:             true,
            },
        }

        if (createNew) {
            await client.post('Processes', {
                Name:               processName,
                PrologProcedure:    '',
                MetadataProcedure:  '',
                DataProcedure:      '',
                EpilogProcedure:    '',
                HasSecurityAccess:  false,
                ...odbcProps,
                Parameters:         tokens.map(t => ({ Name: t, Type: 'String', Value: '', Prompt: '' })),
                Variables:          [],
            })
            return res.json({ ok: true, created: true, dsn: conn.dsn, paramsAdded: tokens })
        }

        // Existing process — fetch, merge parameters, patch
        const proc      = await client.getProcess(processName)
        const existing  = (proc.Parameters ?? []).map(p => p.Name)
        const newParams = tokens.filter(t => !existing.includes(t))
            .map(t => ({ Name: t, Type: 'String', Value: '', Prompt: '' }))
        const parameters = [...(proc.Parameters ?? []), ...newParams]

        await client.patch(`Processes('${processName}')`, {
            ...odbcProps,
            Parameters: parameters,
        })

        res.json({ ok: true, created: createNew, dsn: conn.dsn, paramsAdded: newParams.map(p => p.Name) })
    } catch (e) {
        const tm1Msg = e.response?.data?.error?.message
        console.error('[sql/post-to-ti]', tm1Msg || e.message)
        res.status(500).json({ error: tm1Msg || e.message })
    }
})

app.post('/api/sql/preview-datasource', async (req, res) => {
    try {
        const { dsn, query } = req.body
        if (!dsn || !query) return res.status(400).json({ error: 'dsn and query are required' })
        const conn = loadConnections().find(c => c.dsn === dsn)
        if (!conn) return res.status(404).json({ error: `No SQL connection configured for DSN "${dsn}"` })
        const start  = Date.now()
        const result = await executeQuery(conn, query)
        res.json({ ...result, duration: Date.now() - start })
    } catch (e) {
        const tm1Msg = e.response?.data?.error?.message
        console.error('[sql/preview-datasource]', tm1Msg || e.message)
        res.status(500).json({ error: tm1Msg || e.message })
    }
})

app.get('/api/sql/queries', (req, res) => {
    const all = loadQueries()
    res.json(req.query.connectionId ? all.filter(q => q.connectionId === req.query.connectionId) : all)
})

app.post('/api/sql/queries', (req, res) => {
    try {
        const queries = loadQueries()
        const query   = { ...req.body, id: req.body.id || `sqlq-${Date.now()}` }
        const idx     = queries.findIndex(q => q.id === query.id)
        if (idx >= 0) queries[idx] = query; else queries.push(query)
        saveQueries(queries)
        res.json({ ok: true, id: query.id })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/sql/queries/:id', (req, res) => {
    try {
        saveQueries(loadQueries().filter(q => q.id !== req.params.id))
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Current user ──────────────────────────────────────────────────────────────
app.get('/api/whoami', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const name = await client.getCurrentUser()
        res.json({ name })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Cell write ────────────────────────────────────────────────────────────────
// Body: { server, cube, dims: [{ dim, element }, ...], value }
app.post('/api/cells/write', async (req, res) => {
    try {
        const { server, cube, dims, value } = req.body
        if (!gateReadOnly(res, server)) return
        console.log('[cells/write] REQUEST BODY:', JSON.stringify({ server, cube, dims, value }))
        if (!server || !cube || !Array.isArray(dims) || dims.length === 0)
            return res.status(400).json({ error: 'server, cube, and dims are required' })
        const client = makeClient(server, req.ideToken)
        const result = await client.writeCellValue(cube, dims, value)
        console.log('[cells/write] TM1 RESPONSE:', JSON.stringify(result))
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        console.error('[cells/write] ERROR:', detail)
        const msg = typeof detail === 'string' ? detail : JSON.stringify(detail)
        res.status(500).json({ error: msg })
    }
})

// ── Deploy pipeline ───────────────────────────────────────────────────────────

// When this server's baseline was last seeded — the start of its release window.
function baselineSeededAt(server) {
    return deployLoadBaseline(null, server)?._meta?.seeded_at ?? null
}

// Resolve the change-log entries a diff/package should work from:
// one change set (sessionId), or every object touched since the baseline (release).
// Release prefers the baseline's change-log position (deterministic); falls back
// to the seeded_at timestamp for baselines seeded before positions were stamped.
function deployEntries({ server, sessionId, release }) {
    if (!release) return cl.getSessionLog(sessionId)
    const base    = deployLoadBaseline(null, server)
    const sinceId = base?._meta?.last_entry_id
    return sinceId != null
        ? cl.getEntriesSinceId(server, sinceId)
        : cl.getEntriesSince(server, baselineSeededAt(server))
}

app.get('/api/deploy/object-diff', async (req, res) => {
    try {
        const { server, type, name, detail } = req.query
        const snapshot = deployLoadBaseline(null, server)
        if (!snapshot) return res.status(404).json({ error: 'No baseline seeded for this server' })
        const client = makeClient(server, req.ideToken)
        let before = null, after = null

        if (type === 'rules') {
            before = { text: snapshot.cubes?.[name]?.rules ?? '' }
            const cube = await client.getCube(name)
            after = { text: cube?.Rules ?? '' }
        } else if (type === 'process') {
            const bp = snapshot.processes?.[name]
            before = bp ? { prolog: bp.PrologProcedure ?? '', metadata: bp.MetadataProcedure ?? bp.MetaDataProcedure ?? '', data: bp.DataProcedure ?? '', epilog: bp.EpilogProcedure ?? '' } : null
            const p = await client.getProcess(name)
            after = { prolog: p.PrologProcedure ?? '', metadata: p.MetaDataProcedure ?? p.MetadataProcedure ?? '', data: p.DataProcedure ?? '', epilog: p.EpilogProcedure ?? '' }
        } else if (type === 'subset') {
            const bs = snapshot.subsets?.[detail]?.[detail]?.[name]
            before = bs ?? null
            const sub = await client.getSubset(detail, name, detail)
            after = sub?.Expression ? { expression: sub.Expression } : { elements: [] }
        } else if (type === 'view') {
            const bv = snapshot.views?.[detail]?.[name]
            before = bv ? (bv.type === 'mdx' ? { type: 'mdx', mdx: bv.MDX ?? bv.mdx ?? '' } : { type: 'native', definition: bv.definition }) : null
            const view = await client.getView(detail, name)
            after = view?.MDX ? { type: 'mdx', mdx: view.MDX } : { type: 'native', definition: view }
        } else {
            return res.status(400).json({ error: `Unsupported type: ${type}` })
        }

        res.json({ before, after })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/baseline', (req, res) => {
    try {
        const snapshot = deployLoadBaseline(null, req.query.server)
        if (!snapshot) return res.json({ exists: false })
        res.json({ exists: true, ...snapshot._meta })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/pre-delete-check', async (req, res) => {
    try {
        const { server, dimension, element, hierarchy } = req.body
        if (!server || !dimension || !element) return res.status(400).json({ error: 'server, dimension and element required' })
        const cl     = makeClient(server, req.ideToken)
        const result = await cl.preDeleteElementCheck(dimension, element, hierarchy ?? dimension)
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/seed', async (req, res) => {
    try {
        const { server, label } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        // stamp the change-log position so releases can window on id, not timestamp
        const extraMeta = { last_entry_id: cl.getMaxEntryId(server) }
        if (label) extraMeta.label = String(label)
        const snapshot = await deploySeed(server, null, req.ideToken, extraMeta)
        res.json({ ok: true, server, seeded_at: snapshot._meta.seeded_at, last_entry_id: snapshot._meta.last_entry_id, counts: snapshot._meta.counts })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Append-only baseline history for a server + move HEAD (recovery point).
app.get('/api/deploy/baselines', (req, res) => {
    try {
        if (!req.query.server) return res.status(400).json({ error: 'server required' })
        res.json(deployListBaselines(req.query.server))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/baseline/head', (req, res) => {
    try {
        const { server, file } = req.body
        if (!server || !file) return res.status(400).json({ error: 'server and file required' })
        res.json(deploySetBaselineHead(server, file))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/diff', async (req, res) => {
    try {
        const { server, sessionId, release } = req.body
        const entries = deployEntries({ server, sessionId, release })
        const result  = await deployDiff(server, entries, undefined, req.ideToken)
        // Release mode already unions every session's changes since the last baseline —
        // there's no "other session" boundary to warn about. Only a named, session-scoped
        // deploy can bleed in someone else's unrelated edit to a shared object.
        const crossSessionTouches = (!release && sessionId) ? cl.getCrossSessionTouches(server, sessionId, entries) : []
        res.json({ ...result, crossSessionTouches })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/package', async (req, res) => {
    try {
        const { server, sessionId, sessionName, release, forceInclude = [], selectedObjects } = req.body
        let entries = deployEntries({ server, sessionId, release })
        if (selectedObjects?.length) {
            const sel = new Set(selectedObjects.map(o => `${o.object_type}::${o.object_name}::${o.detail ?? ''}`))
            entries = entries.filter(e => sel.has(`${e.object_type}::${e.object_name}::${e.detail ?? ''}`))
        }
        const name = sessionName || (release ? `Release ${new Date().toISOString().slice(0, 10)}` : 'deploy')
        // no force — packager auto-suffixes rather than overwriting a retained package
        const result = await deployPack(server, entries, name, { forceInclude, sessionId }, req.ideToken)
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Read an existing package's manifest — used both by the freshly-built package
// (outputDir just returned from /api/deploy/package POST) and by an imported one.
app.get('/api/deploy/package', (req, res) => {
    try {
        const dir = req.query.dir
        if (!dir) return res.status(400).json({ error: 'dir required' })
        const resolved     = path.resolve(dir)
        const packagesRoot = path.resolve(__dirname, 'packages')
        if (resolved !== packagesRoot && !resolved.startsWith(packagesRoot + path.sep)) {
            return res.status(403).json({ error: 'path outside packages directory' })
        }
        const manifestPath = path.join(resolved, 'manifest.json')
        if (!fs.existsSync(manifestPath)) return res.status(404).json({ error: 'manifest.json not found' })
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        res.json({ outputDir: resolved, manifest })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Accept a package .zip (built by another IDE instance) and unpack it into
// packages/, so the admin can review + deploy it here without ever running
// the CLI or touching the source Dev server.
app.post('/api/deploy/import-zip', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
    try {
        if (!req.body?.length) return res.status(400).json({ error: 'Empty upload' })
        const AdmZip   = require('adm-zip')
        const zip      = new AdmZip(req.body)
        const entries  = zip.getEntries().filter(e => !e.isDirectory)
        if (!entries.length) return res.status(400).json({ error: 'Empty zip' })

        // Packages are zipped as <name>/manifest.json, <name>/rules/..., etc. —
        // strip that single common top-level folder on extract.
        const topNames  = new Set(entries.map(e => e.entryName.split('/')[0]))
        const zipTop    = topNames.size === 1 ? [...topNames][0] : null
        const requested = (req.query.name || '').toString().trim()
        let name = (requested || zipTop || `import-${new Date().toISOString().replace(/[:.]/g, '-')}`)
            .replace(/[^a-zA-Z0-9_.-]/g, '_')

        const packagesRoot = path.join(__dirname, 'packages')
        let outDir = path.join(packagesRoot, name)
        for (let n = 2; fs.existsSync(outDir); n++) outDir = path.join(packagesRoot, `${name}-${n}`)
        fs.mkdirSync(outDir, { recursive: true })

        for (const entry of entries) {
            const rel = zipTop ? entry.entryName.slice(zipTop.length + 1) : entry.entryName
            if (!rel) continue
            const dest = path.join(outDir, rel)
            if (!dest.startsWith(outDir + path.sep)) continue   // zip-slip guard
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            fs.writeFileSync(dest, entry.getData())
        }

        const manifestPath = path.join(outDir, 'manifest.json')
        if (!fs.existsSync(manifestPath)) {
            fs.rmSync(outDir, { recursive: true, force: true })
            return res.status(400).json({ error: 'Not a deploy package — no manifest.json found in the zip' })
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        // Tag as imported so /api/deploy/packages can tell it apart from a package
        // this IDE built itself — Import Package should only ever list handoffs.
        manifest._meta = { ...(manifest._meta ?? {}), imported: true, imported_at: new Date().toISOString() }
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
        res.json({ dir: outDir, name: path.basename(outDir), manifest })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/packages', (req, res) => {
    try {
        const dir = path.join(__dirname, 'packages')
        if (!fs.existsSync(dir)) return res.json([])
        const importedOnly = req.query.imported === '1'
        const items = fs.readdirSync(dir)
            .filter(n => fs.statSync(path.join(dir, n)).isDirectory())
            .map(n => {
                const mp = path.join(dir, n, 'manifest.json')
                if (!fs.existsSync(mp)) return null
                const m = JSON.parse(fs.readFileSync(mp, 'utf8'))
                return { dir: path.join(dir, n), name: n, meta: m._meta, objectCount: m.objects?.length ?? 0 }
            })
            .filter(Boolean)
            .filter(p => !importedOnly || p.meta?.imported === true)
            .sort((a, b) => (b.meta?.packaged_at ?? '').localeCompare(a.meta?.packaged_at ?? ''))
        res.json(items)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Stream a package folder as a .zip for handoff to an admin who will deploy it.
app.get('/api/deploy/package-zip', (req, res) => {
    try {
        const dir = req.query.dir
        if (!dir) return res.status(400).json({ error: 'dir required' })
        const resolved      = path.resolve(dir)
        const packagesRoot  = path.resolve(__dirname, 'packages')
        if (resolved !== packagesRoot && !resolved.startsWith(packagesRoot + path.sep)) {
            return res.status(403).json({ error: 'path outside packages directory' })
        }
        if (!fs.existsSync(path.join(resolved, 'manifest.json'))) {
            return res.status(404).json({ error: 'not a package (no manifest.json)' })
        }
        const { ZipArchive } = require('archiver')
        const name = path.basename(resolved)
        res.attachment(`${name}.zip`)
        const zip = new ZipArchive({ zlib: { level: 9 } })
        zip.on('error', err => res.destroy(err))
        zip.pipe(res)
        zip.directory(resolved, name)
        zip.finalize()
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/drift-check', async (req, res) => {
    try {
        const { packageDir, target } = req.body
        if (!packageDir || !target) return res.status(400).json({ error: 'packageDir and target required' })
        const result = await deployDriftCheck(packageDir, target, req.ideToken)
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/risk', async (req, res) => {
    try {
        const { packageDir, target } = req.body
        const result = await analyzeRisk(packageDir, target, req.ideToken)
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/execute', async (req, res) => {
    try {
        const { packageDir, target, dryRun, force } = req.body
        const result = await deployExecute(packageDir, target, { dryRun, force, skipRiskCheck: true }, req.ideToken)
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Re-run a source server's stored assertions against any target, on demand.
// Same check the deploy pipeline runs post-deploy (B3) — but standalone, so you
// can re-verify after a post-deploy fix (seed processes, feeder reprocess, …)
// without re-deploying.
app.post('/api/deploy/verify', async (req, res) => {
    try {
        const { source, target, tags } = req.body
        if (!source) return res.status(400).json({ error: 'source (server whose assertions to run) required' })
        const result = await require('./core/assertions').run(source, { targetServer: target || source, tags, ideToken: req.ideToken })
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/approve', (req, res) => {
    try {
        const { source, target, approver, notes, packaged, session, packageDir } = req.body
        const id = new Date().toISOString()
        const record = { id, approved_at: id, approver, notes: notes ?? '', source, target, packaged, session, packageDir }
        const file = path.join(__dirname, 'config', 'deploy-approvals.json')
        const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
        existing.push(record)
        fs.writeFileSync(file, JSON.stringify(existing, null, 2))
        res.json(record)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/scoped-snapshot', async (req, res) => {
    try {
        const { packageDir, target } = req.body
        const manifestPath = path.join(packageDir, 'manifest.json')
        if (!fs.existsSync(manifestPath)) return res.status(400).json({ error: 'No manifest found' })
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        const result = await deployScopedSnapshot(manifest, target, req.ideToken)
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/archive', (req, res) => {
    try {
        const { approval, deployResult, manifest, source, target, deployer, preSnapshot, postSnapshot } = req.body
        const now = new Date()
        const stamp = now.toISOString().replace(/[:.]/g, '-')
        const filename = `${stamp}_${(source ?? '').replace(/\W+/g, '_')}_to_${(target ?? '').replace(/\W+/g, '_')}.json`
        const dir = path.join(__dirname, 'config', 'archives')
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        const record = { archived_at: now.toISOString(), source, target, deployer, approval, deploy: deployResult, manifest, preSnapshot, postSnapshot }
        fs.writeFileSync(path.join(dir, filename), JSON.stringify(record, null, 2))
        res.json({ id: filename.replace('.json', ''), ...record })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/archives', (req, res) => {
    try {
        const dir = path.join(__dirname, 'config', 'archives')
        if (!fs.existsSync(dir)) return res.json([])
        const archives = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .sort().reverse()
            .map(f => {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
                    return { id: f.replace('.json', ''), archived_at: data.archived_at, source: data.source, target: data.target, deployer: data.deployer, approval: data.approval, deployStats: { deployed: data.deploy?.deployed, failed: data.deploy?.failed, dry_run: data.deploy?.dry_run } }
                } catch { return null }
            })
            .filter(Boolean)
        res.json(archives)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/archives/:id', (req, res) => {
    try {
        const file = path.join(__dirname, 'config', 'archives', `${req.params.id}.json`)
        if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
        res.json(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Admin: function catalog overrides — compat, user additions, deletions
const CATALOG_OVERRIDES_PATH = path.join(__dirname, 'config', 'function-catalog-overrides.json')
const EMPTY_OVERRIDES = {
    ti:    { overrides: {}, additions: {}, deletions: [] },
    rules: { overrides: {}, additions: {}, deletions: [] },
    mdx:   { overrides: {}, additions: {}, deletions: [] },
}
app.get('/api/admin/catalog-overrides', (req, res) => {
    try {
        if (!fs.existsSync(CATALOG_OVERRIDES_PATH)) return res.json(EMPTY_OVERRIDES)
        res.json(JSON.parse(fs.readFileSync(CATALOG_OVERRIDES_PATH, 'utf8')))
    } catch (e) { res.status(500).json({ error: e.message }) }
})
app.put('/api/admin/catalog-overrides', (req, res) => {
    try {
        fs.writeFileSync(CATALOG_OVERRIDES_PATH, JSON.stringify(req.body, null, 2))
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── SPA fallback ──────────────────────────────────────────────────────────────
// Admin: validate TI function names against the live TM1 server using syntax check.
// Client sends { server, tests: [{name, code}] } where code is minimal TI calling that function.
// Each function is tested by creating a temp TI process; success = TM1 accepts the syntax.
app.post('/api/admin/validate-ti-functions', async (req, res) => {
    try {
        const { server, tests } = req.body
        if (!gateReadOnly(res, server)) return
        const client = makeClient(server, req.ideToken)
        const results = []
        for (const { name, code } of tests) {
            const procName = `}IDE_FnTest_${name}_${Date.now()}`
            let status = 'unknown'
            let message = ''
            try {
                await client.post('Processes', {
                    Name: procName,
                    PrologProcedure: code,
                    MetadataProcedure: '',
                    DataProcedure: '',
                    EpilogProcedure: '',
                    Parameters: [],
                    Variables: [],
                })
                status = 'valid'
                try { await client.delete(`Processes('${encodeURIComponent(procName)}')`) } catch {}
            } catch (e) {
                message = e.message ?? ''
                status = message.toLowerCase().includes('syntax') || message.toLowerCase().includes('equal sign') ? 'invalid' : 'error'
                try { await client.delete(`Processes('${encodeURIComponent(procName)}')`) } catch {}
            }
            results.push({ name, status, message })
        }
        res.json({ results })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Cube Map ──────────────────────────────────────────────────────────────────
app.get('/api/cubemap/model', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const allCubes = await client.getAllCubesWithRules()

        // Parse DB() references from rules text
        const DB_RE = /\bDB\s*\(\s*'([^']+)'/gi
        // Remove `#` / `//` comments (quote-aware, newlines preserved so nothing
        // else that depends on line structure breaks). Stops a comment like
        // `# CellPutN(v, 'Budget', ...)` from creating a phantom edge.
        function stripComments(code) {
            let out = ''
            let i = 0
            const n = code.length
            while (i < n) {
                const ch = code[i]
                if (ch === "'") {
                    out += "'"; i++
                    while (i < n && code[i] !== "'") { out += code[i]; i++ }
                    if (i < n) { out += "'"; i++ }
                    continue
                }
                if (ch === '#' || (ch === '/' && code[i + 1] === '/')) {
                    while (i < n && code[i] !== '\n') i++
                    continue
                }
                out += ch
                i++
            }
            return out
        }
        function scanRefs(text) {
            const clean = stripComments(text)
            const refs = new Set()
            let m
            while ((m = DB_RE.exec(clean)) !== null) refs.add(m[1])
            DB_RE.lastIndex = 0
            return [...refs]
        }

        const cubeNames = new Set(allCubes.map(c => c.Name))
        const dimNames  = new Set(await client.getDimensions().catch(() => []))

        // Fetch TI process code for write-ref and call-chain analysis (best-effort — skip if slow/unavailable)
        // Catches three patterns, not just a literal cube name in CellPutN:
        //   1. CellPutN(value, 'Literal Cube', ...)              — direct literal
        //   2. cCube = 'Literal Cube'; ... CellPutN(value, cCube, ...) — var assigned a literal earlier, then used
        //   3. ExecuteProcess('GenericCopier', 'pCube', 'Literal Cube', ...) — a generic process (its own
        //      CellPutN target is a parameter, unresolvable in isolation) attributed via the call site that
        //      names the real cube — this is how Bedrock-style reusable copy processes get credited correctly.
        const tiWriteMap = {}
        const tiReadMap  = {}
        const processCallers = {} // calledProcess -> [callerProcess, ...] (reverse of ExecuteProcess/RunProcess)
        // Per-process view for the map's "All TI" mode and the Show playback. `steps` is every distinct
        // read/write/call in code order (first occurrence), which is the order the playback walks.
        const processes = {}
        const procEntry = name => (processes[name] ??= { reads: [], writes: [], calls: [], dimWrites: [], steps: [] })
        const dimWriteMap = {} // dim -> [process, ...]
        // Dimension-changing TI calls, derived from the shared catalog (never hand-listed): a statement
        // that takes a dimname and no cubename (View*/CubeCreate take a dimname but don't change it).
        // Subset calls are excluded — the temp-view scaffolding every clear-and-rebuild process does
        // (SubsetCreate/ElementInsert/Destroy) would link nearly every process to its cube's dimensions.
        // The value is the dimname's argument position.
        const DIM_WRITE_FNS = Object.fromEntries(Object.entries(require('./shared/tm1-function-catalog.json'))
            .filter(([, f]) => f.language !== 'rules' && f.isStatement && (f.params ?? []).includes('dimname')
                && !(f.params ?? []).some(x => x.startsWith('cubename') || x.startsWith('subset')))
            .map(([name, f]) => [name, f.params.indexOf('dimname')]))
        const DIM_CALL_RE = new RegExp(`\\b(${Object.keys(DIM_WRITE_FNS).join('|')})\\s*\\(`, 'gi')
        // Top-level args of the call whose '(' is at openIdx — quote- and paren-aware
        const splitArgs = (code, openIdx) => {
            const args = []; let depth = 0, cur = '', inStr = false
            for (let i = openIdx + 1; i < code.length; i++) {
                const ch = code[i]
                if (inStr) { cur += ch; if (ch === "'") inStr = false; continue }
                if (ch === "'") { inStr = true; cur += ch; continue }
                if (ch === '(') depth++
                if (ch === ')') { if (depth === 0) { args.push(cur); break } depth-- }
                if (ch === ',' && depth === 0) { args.push(cur); cur = ''; continue }
                if (ch === ';' && depth === 0) break
                cur += ch
            }
            return args
        }
        try {
            const pd = await client.get('Processes', {
                '$select': 'Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,DataSource,Parameters',
            })
            const ASSIGN_RE     = /\b([A-Za-z_]\w*)\s*=\s*'([^']*)'\s*;/g
            const VAR_ASSIGN_RE = /\b([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*;/g
            // cube is the 2nd arg: CellPutN/S, CellPutNComplete, CellIncrementN/S (accumulating write)
            const CELLPUT_RE    = /\b(?:CellPut[NS](?:Complete)?|CellIncrement[NS])\s*\(\s*[^,]+,\s*([^,]+),/gi
            // cube is the 1st arg: functions that change a cube's data without CellPut — clear-and-rebuild
            // processes (ViewZeroOut then CellIncrementN) were invisible on the Cube Map without these
            const CUBE_FIRST_RE = /\b(?:ViewZeroOut|CubeClearData|CubeProcessFeeders)\s*\(\s*([^,)]+)/gi
            // reads: cube is the 1st arg
            const CELLGET_RE    = /\bCellGet[NS]\s*\(\s*([^,)]+)/gi
            const EXEC_RE       = /\b(?:ExecuteProcess|RunProcess)\s*\(([\s\S]*?)\)\s*;/gi
            const CUBE_PARAM_RE = /'([pP]\w*[Cc]ube\w*)'\s*,\s*'([^']+)'/g

            const addStep = (proc, kind, target, pos) => {
                const e = procEntry(proc)
                const list = { read: e.reads, write: e.writes, call: e.calls, dimwrite: e.dimWrites }[kind]
                if (list.includes(target)) return
                list.push(target)
                e.steps.push({ kind, target, pos })
            }
            const addWriter = (cube, proc, pos = Infinity) => {
                if (!cubeNames.has(cube)) return
                if (!tiWriteMap[cube]) tiWriteMap[cube] = []
                if (!tiWriteMap[cube].includes(proc)) tiWriteMap[cube].push(proc)
                addStep(proc, 'write', cube, pos)
            }
            const addReader = (cube, proc, pos) => {
                if (!cubeNames.has(cube)) return
                if (!tiReadMap[cube]) tiReadMap[cube] = []
                if (!tiReadMap[cube].includes(proc)) tiReadMap[cube].push(proc)
                addStep(proc, 'read', cube, pos)
            }
            // An object-name expression -> its value: 'literal', a resolved variable, or a `|` concatenation
            // of those (e.g. sDimension | '.Refresh Subsets'). Anything else is unresolvable -> undefined.
            const resolveName = (ref, varValues) => {
                const parts = []; let cur = '', inStr = false
                for (const ch of ref) {
                    if (ch === "'") inStr = !inStr
                    if (ch === '|' && !inStr) { parts.push(cur); cur = '' } else cur += ch
                }
                parts.push(cur)
                let out = ''
                for (const part of parts.map(s => s.trim())) {
                    const lit = part.match(/^'([^']*)'$/)
                    const val = lit ? lit[1] : varValues[part]
                    if (val === undefined) return undefined
                    out += val
                }
                return out || undefined
            }

            for (const p of (pd.value ?? []).filter(p => !p.Name.startsWith('}'))) {
                const code = stripComments([p.PrologProcedure, p.MetadataProcedure, p.DataProcedure, p.EpilogProcedure]
                    .filter(Boolean).join('\n'))

                // Resolve `var = 'literal';` assignments so CellPutN(value, var, ...) can be traced, seeded
                // with parameter defaults and following `a = b;` chains (sDimension = pDimension). A default is
                // what the process uses when run as-is, so it's the name the map attributes it to.
                const varValues = {}
                for (const prm of p.Parameters ?? []) {
                    if (typeof prm.Value === 'string' && prm.Value) varValues[prm.Name] = prm.Value
                }
                let am
                ASSIGN_RE.lastIndex = 0
                while ((am = ASSIGN_RE.exec(code)) !== null) varValues[am[1]] = am[2]
                for (let pass = 0; pass < 3; pass++) {
                    VAR_ASSIGN_RE.lastIndex = 0
                    while ((am = VAR_ASSIGN_RE.exec(code)) !== null) {
                        if (varValues[am[1]] === undefined && varValues[am[2]] !== undefined) varValues[am[1]] = varValues[am[2]]
                    }
                }

                CELLPUT_RE.lastIndex = 0
                let m
                while ((m = CELLPUT_RE.exec(code)) !== null) {
                    const cubeName = resolveName(m[1], varValues)
                    if (cubeName) addWriter(cubeName, p.Name, m.index)
                }

                CUBE_FIRST_RE.lastIndex = 0
                while ((m = CUBE_FIRST_RE.exec(code)) !== null) {
                    const cubeName = resolveName(m[1], varValues)
                    if (cubeName) addWriter(cubeName, p.Name, m.index)
                }

                CELLGET_RE.lastIndex = 0
                while ((m = CELLGET_RE.exec(code)) !== null) {
                    const cubeName = resolveName(m[1], varValues)
                    if (cubeName) addReader(cubeName, p.Name, m.index)
                }

                DIM_CALL_RE.lastIndex = 0
                while ((m = DIM_CALL_RE.exec(code)) !== null) {
                    const ref = splitArgs(code, m.index + m[0].length - 1)[DIM_WRITE_FNS[m[1].toUpperCase()]]
                    const dim = ref && resolveName(ref, varValues)
                    if (!dim || !dimNames.has(dim)) continue
                    if (!dimWriteMap[dim]) dimWriteMap[dim] = []
                    if (!dimWriteMap[dim].includes(p.Name)) dimWriteMap[dim].push(p.Name)
                    addStep(p.Name, 'dimwrite', dim, m.index)
                }

                // A cube-view datasource is a read of the whole view, before any code runs
                const ds = p.DataSource
                if (ds?.Type === 'TM1CubeView' && ds.dataSourceNameForServer) addReader(ds.dataSourceNameForServer, p.Name, -1)

                EXEC_RE.lastIndex = 0
                while ((m = EXEC_RE.exec(code)) !== null) {
                    const argList = m[1]
                    const nameRef = splitArgs(`(${argList})`, 0)[0]
                    const called = nameRef && resolveName(nameRef, varValues)
                    if (!called) continue
                    if (called !== p.Name) {
                        if (!processCallers[called]) processCallers[called] = []
                        if (!processCallers[called].includes(p.Name)) processCallers[called].push(p.Name)
                        addStep(p.Name, 'call', called, m.index)
                    }
                    CUBE_PARAM_RE.lastIndex = 0
                    let cm
                    while ((cm = CUBE_PARAM_RE.exec(argList)) !== null) addWriter(cm[2], called)
                }
            }
        } catch { /* TI refs unavailable — continue without them */ }

        const cubes = {}

        for (const c of allCubes) {
            const rules = c.Rules ?? ''
            const feederIdx = rules.search(/^FEEDERS\s*;/im)
            const calcText   = feederIdx >= 0 ? rules.slice(0, feederIdx) : rules
            const feederText = feederIdx >= 0 ? rules.slice(feederIdx) : ''

            const calcRefs   = scanRefs(calcText).filter(n => cubeNames.has(n) && n !== c.Name)
            const feederRefs = scanRefs(feederText).filter(n => cubeNames.has(n) && n !== c.Name)

            // Non-blank, non-comment lines in the calc section
            const ruleLoc = calcText.split('\n')
                .filter(l => { const t = l.trim(); return t && !t.startsWith('#') && !t.startsWith('//') })
                .length

            cubes[c.Name] = {
                dims:           (c.Dimensions ?? []).map(d => d.Name),
                hasRules:       rules.trim().length > 0,
                ruleCalcRefs:   calcRefs,
                ruleFeederRefs: feederRefs,
                ruleLoc,
                tiWriters:      tiWriteMap[c.Name] ?? [],
                tiReaders:      tiReadMap[c.Name] ?? [],
            }
        }

        for (const e of Object.values(processes)) e.steps.sort((a, b) => a.pos - b.pos)

        // Only dimensions some process changes — the map never draws every dimension (see IMPROVEMENTS 7.1)
        const dims = Object.fromEntries(Object.entries(dimWriteMap).map(([d, procs]) => [d, {
            writers: procs,
            cubes:   allCubes.filter(c => (c.Dimensions ?? []).some(x => x.Name === d)).map(c => c.Name),
        }]))

        const chores = await client.getChoresWithTasks().catch(() => [])

        res.json({ cubes, processCallers, processes, dims, chores })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})


// ── Lenses ────────────────────────────────────────────────────────────────────
// Lens HTML lives in config/lenses/*.html (git-versioned). Metadata lives ONLY
// in the }Lenses control cube — never a second copy in JSON files. The bridge
// runs as the viewing user (req.ideToken), never the MCP admin path.

app.get('/api/lenses', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const lenses = lensStore.listFiles()
        const enriched = await Promise.all(lenses.map(async f => {
            try { return { ...f, ...(await lensStore.readMeta(client, f.name)) } }
            catch { return { ...f } }
        }))
        res.json(enriched)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/lenses/:name', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const lens = lensStore.readLens(req.params.name)
        const meta = await lensStore.readMeta(client, req.params.name).catch(() => ({}))
        res.json({ ...lens, meta })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/lenses/:name', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const { html, description, publish, force } = req.body
        if (typeof html !== 'string' || !html.trim()) return res.status(400).json({ error: 'html is required' })
        const errors = await lensBridge.validateLens(client, html)
        if (errors.length && !force) {
            return res.status(400).json({ error: `Lens validation failed (${errors.length}):`, validation: errors })
        }
        const saved = lensStore.saveLens(client, req.params.name, html, req.user, { publish: !!publish, description })
        res.json({ ...saved, validation: errors })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/lenses/:name', (req, res) => {
    try {
        lensStore.deleteLens(req.params.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/lenses/generate', async (req, res) => {
    try {
        const { server, cube, description } = req.body
        if (!description?.trim()) return res.status(400).json({ error: 'description is required' })
        const client = makeClient(server, req.ideToken)
        const meta = await lensBridge.getMeta(client, cube)

        // No AI key → return a model-aware starter lens so the editor always works.
        if (!ai.isConfigured()) {
            return res.json({ html: lensBridge.buildStarterLens(meta, cube), mode: 'starter' })
        }

        const obf = ai.shouldObfuscate()
        const names = [
            ...(meta.cubes ?? []), ...(meta.dimensions ?? []), ...(meta.cubeDims ?? []),
            ...Object.values(meta.elements ?? {}).flat(),
        ]
        const map = obfuscate.makeMap(names)
        const hide = obf ? t => obfuscate.obfuscateText(t, map.realToCode) : t => t
        const show = obf ? t => obfuscate.restoreText(t, map.codeToReal) : t => t

        let html
        try {
            html = await ai.complete({
                label: 'lens-generate', obfuscated: obf, maxTokens: 8000,
                system: `You are a front-end developer building an executive dashboard that runs inside a sandboxed iframe and reads live IBM Planning Analytics (TM1) data.

The ONLY way to get data is the bridge API below. There is NO network access, no fetch to any other URL, no external libraries, no CDN, no external fonts or images.

Bridge API (always available):
  window.lensBridge.call('execMDX', { mdx: '<MDX SELECT>' }) -> Promise<{ Axes, Cells }>
      Cells: [{ Ordinal, Value, FormattedValue }] — Value is a number or null.
  window.lensBridge.call('readCell', { cube: '<cube>', coordinates: { '<dim>': '<elem>', ... } }) -> Promise<number|string|null>
      coordinates must name EVERY dimension of the cube.
  window.lensBridge.call('getMeta', { cube: '<cube>' }) -> Promise<{ cubes, dimensions, cubeDims, elements }>

Rules:
- Return a SINGLE complete HTML document (html, head, style, body, script). No markdown, no code fences, no explanation.
- Draw all charts with inline SVG or canvas and vanilla JS. Everything inline. No external anything.
- Style it as a polished executive dashboard: card layout, clear hierarchy, good typography, whitespace, a coherent color scheme. Add a small refresh button that re-runs the data calls.
- All numbers must come from the bridge at runtime — never hard-code values.
- Use EXACT cube/dimension/element names from the model context. In MDX reference members as [Dim].[Dim].[Member].
- Prefer readCell for single values and execMDX for series/sets. Keep MDX simple and correct. The Measures dimension is typically the last one — put it on columns.
- Render loading states and handle null/empty values gracefully (show '—').`,
                user: hide(`Model context:\n${JSON.stringify(meta)}\n\nBuild a lens described as: ${description}`),
            })
        } catch (e) {
            return res.json({ html: lensBridge.buildStarterLens(meta, cube), mode: 'starter', note: `AI call failed (${e.message}) — returned a starter lens instead.` })
        }

        res.json({ html: show(html), mode: 'ai' })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Lens bridge (read-only, runs as the viewing user) ────────────────────────

app.post('/api/lens/exec-mdx', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await lensBridge.execMDX(client, req.body?.mdx))
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.post('/api/lens/read-cell', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const { cube, coordinates } = req.body
        res.json({ value: await lensBridge.readCell(client, cube, coordinates) })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.get('/api/lens/meta', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await lensBridge.getMeta(client, req.query.cube))
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// Sandboxed frame render. The CSP `sandbox` directive is the security boundary —
// it applies even when the URL is opened directly in a tab (the iframe sandbox
// attribute alone would not). The frame has no same-origin and no network, so AI
// script cannot read localStorage['tm1-token'] or exfiltrate anything. Never add
// allow-same-origin here. Live data only flows through the IDE host page bridge.

const LENS_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; connect-src 'none'"
const LENS_BRIDGE_STUB = "<script>window.lensBridge={call(){return Promise.reject(new Error('Lens opened standalone — live data requires the IDE session'))}}<\/script>"

app.get('/lenses/:server/:name', (req, res) => {
    try {
const lens = lensStore.readLens(req.params.name)
        res.setHeader('Content-Security-Policy', LENS_CSP)
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Cache-Control', 'no-store')
        res.type('html').send(LENS_BRIDGE_STUB + lens.html)
    } catch {
        res.status(404).send('Lens not found')
    }
})


app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'))
})

app.listen(PORT, HOST, () => {
    const shown = (HOST === '0.0.0.0' ? `all interfaces on :${PORT} (LAN-exposed — no TLS)` : `http://${HOST}:${PORT}`)
        + (LOGIN_REQUIRED ? ' · IDE sign-in required' : ' · local only, no IDE sign-in (sign in per server)')
    console.log(`TM1 IDE running at ${shown}`)
})

// HTTPS listener for embedding lenses in HTTPS hosts (e.g. PAW over HTTPS): a
// self-signed cert in config/certs/ide-{cert,key}.pem. Same app, so /lenses/...
// is served on both ports. Browsers must be told to trust the cert once.
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '8443', 10)
try {
    const https = require('https')
    const key  = fs.readFileSync(path.join(__dirname, 'config', 'certs', 'ide-key.pem'))
    const cert = fs.readFileSync(path.join(__dirname, 'config', 'certs', 'ide-cert.pem'))
    https.createServer({ key, cert }, app).listen(HTTPS_PORT, HOST, () => {
        console.log(`TM1 IDE HTTPS (self-signed) at https://${HOST}:${HTTPS_PORT} — /lenses/... for PAW embedding`)
    })
} catch (e) {
    console.warn(`HTTPS listener not started: ${e.message} — generate config/certs/ide-{cert,key}.pem to enable`)
}
