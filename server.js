'use strict'

require('dotenv').config({ path: require('path').join(__dirname, '.env') })

const express   = require('express')
const path      = require('path')
const fs        = require('fs')
const crypto    = require('crypto')
const ai        = require('./core/ai/registry')
const obfuscate = require('./core/ai/obfuscate')
const { makeClient, makeClientWithCredentials, needsServerLogin, isDirectServer, isPawNativeServer, probeAuthMethod, listServers, listServersWithFlags, isSimple, simpleSource, getDefaultAdapterType, getLoginServer } = require('./core/adapter_registry')
const { loadConnections, saveConnections, getConnection, executeQuery, testConnection, getSchema, loadQueries, saveQueries } = require('./core/sql_client')
const { createSession, createDirectSession, createLocalSession, attachPawSession, getSessionUser, touchSession, invalidateSession, getCachedPawSession, getCSRF, PAW_HOST, setServerCredentials, getServerCredentials, clearServerCredentials, getServerStatus, listServerEntries, getSessionCredentials } = require('./core/paw_connect')
const cl = require('./core/change_log')
const { canManageSession } = require('./core/session_access')
// Persisted Git token (never returned to the client) — env wins, else the secrets file.
const gitSecrets = require('./core/git-secrets')
const { odataKey } = require('./core/odata-key')
if (!process.env.TM1_GIT_TOKEN && gitSecrets.getToken()) process.env.TM1_GIT_TOKEN = gitSecrets.getToken()
const lensStore = require('./core/lens_store')
const { logLensWrite, logLensRun, logLensNote, readLensActivity } = require('./core/lens_activity_log')
const lensBridge = require('./core/lens_bridge')
const { readOnlyRefusal } = require('./core/readonly')
const { createSaveDataAllRoute, isAdminGroups } = require('./core/save_data_all')
const { createAdminGate } = require('./core/admin_gate')
const { setSimpleInModes } = require('./core/ide_modes')

// Session (Change Set) is optional for using the IDE — it groups changes for
// deployment, it is not a login and must never gate whether a save works.
// User attribution is independent of session: every write always logs the
// actual acting user (req.user / AGENT_USER), whether or not a session is
// open. Set TM1_REQUIRE_SESSION=1 to opt back into hard-gating writes behind
// an open session, for anyone who wants that stricter posture.
const SESSION_GATE_ENABLED = ['1', 'true', 'yes'].includes(String(process.env.TM1_REQUIRE_SESSION ?? '0').toLowerCase())
function requireSession(server, user) {
    if (!SESSION_GATE_ENABLED) return true
    // A Simple-mode server hides change sets, so it can never demand one
    if (isSimple(server)) return true
    return !!cl.getActiveSession(server, user)
}
const { isTm1Admin, requireTm1Admin } = createAdminGate({ makeClient, isAdminGroups })

async function mayManageSession(req, session) {
    if (canManageSession(req.user, session)) return true
    return isTm1Admin(req, session.server)
}

const NO_SESSION_ERROR = 'No change set is open for this server — start one first (Change Log → Start change set) so this change can be attributed and deployed.'
function gateReadOnly(res, server) {
    const refusal = readOnlyRefusal(server)
    if (refusal) {
        res.status(409).json(refusal)
        return false
    }
    return true
}
function gateWrite(res, server) {
    if (!gateReadOnly(res, server)) return false
    // Key the session gate by the acting user, so each person's saves are
    // attributed to their own change set on a shared DEV.
    if (!requireSession(server, res.req?.user)) {
        res.status(409).json({ error: NO_SESSION_ERROR })
        return false
    }
    return true
}
// One failure shape for every route (see core/tm1-error.js for the message).
function fail(res, e) {
    const status = e?.status ?? e?.response?.status
    const code = e?.code
    const out = status === 400 ? 400
        : status === 401 || status === 403 || status === 404 ? status
        : status === 409 || code === 'READ_ONLY' || code === 'LOCKED' ? 409
        : 500
    return res.status(out).json({ error: e?.message || 'Request failed' })
}
const { getCubeDataSources, getViewSourceUsage, getProcessFacts, listProcessSummaries, invalidate: invalidateCubeSources } = require('./core/cube_data_sources')
const { buildCubeMapModel } = require('./core/cubemap')
const { parseRuleLens } = require('./core/rule_lens')
const processSummaries = require('./core/process_summaries')
const { seed: deploySeed } = require('./tools/tm1deploy/src/snapshot')
const { loadBaseline: deployLoadBaseline } = require('./tools/tm1deploy/src/diff')

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
// Small in-memory per-IP throttle on the unauthenticated sign-in endpoints
// (shared with the Lens app: core/login-rate-limit.js).
const loginRateLimit = require('./core/login-rate-limit').createIpLimiter({ max: 10, windowMs: 15 * 60_000 })

app.use(express.json({ limit: '10mb' }))
app.use(express.static(path.join(__dirname, 'static'), {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store')
    }
}))

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', loginRateLimit, async (req, res) => {
    const clearHits = () => loginRateLimit.clear(req)
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
        loginRateLimit.clear(req)
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
app.get('/api/auth/servers', async (req, res) => {
    try {
        res.json(await Promise.all(listServers().map(async name => {
            if (!isDirectServer(name)) return { name, status: 'paw', isAdmin: false }
            const st = getServerStatus(req.ideToken, name)
            const status = st === 'ok' ? 'signed-in' : st === 'rejected' ? 'rejected' : 'needs-login'
            return {
                name,
                status,
                username: getServerCredentials(req.ideToken, name)?.username ?? null,
                isAdmin: status === 'signed-in' ? await isTm1Admin(req, name) : false,
            }
        })))
    } catch (e) { fail(res, e) }
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
            loginRateLimit.clear(req)
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
        loginRateLimit.clear(req)
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
        // Read-only (PROD posture) servers don't take change sets — same refusal the
        // MCP's start_change_set gives, with readOnly: true so the client can react.
        if (!gateReadOnly(res, server)) return
        res.json(cl.startSession(name.trim(), server, req.user))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sessions/close', async (req, res) => {
    try {
        const { id } = req.body
        if (!id) return res.status(400).json({ error: 'id required' })
        const sess = cl.getSession(id)
        if (!sess) return res.status(404).json({ error: `No change set ${id}` })
        if (!gateReadOnly(res, sess.server)) return
        if (!(await mayManageSession(req, sess))) {
            return res.status(403).json({ error: `Change set ${id} belongs to ${sess.user ?? 'another user'}.` })
        }
        // Run the tests server-side — do not trust the client's results. Refuse to
        // close while any block-severity assertion is failing.
        let tests = null
        try {
            const { run } = require('./core/assertions')
            const r = await run(sess.server, { ideToken: req.ideToken })
            const blocking = r.results.filter(x => !x.pass && (x.severity ?? 'block') === 'block')
            if (blocking.length) {
                return res.status(409).json({
                    error: `Cannot close: ${blocking.length} block-severity assertion${blocking.length !== 1 ? 's' : ''} failing. Fix them, or set severity to warn.`,
                    blocking: blocking.map(b => ({ id: b.id, description: b.description, expected: b.expected, actual: b.actual, error: b.error ?? null })),
                })
            }
            tests = { passed: r.passed, total: r.total, blocking: 0 }
        } catch (e) {
            return res.status(500).json({ error: `Could not run tests to close: ${e.message}` })
        }
        // Write the immutable closed record to the model (loud on a migrated server —
        // a write failure fails the close, and the change set stays open). Open
        // change sets stay in the local log until this moment.
        const { closeChangeSet } = require('./core/change-set-service')
        const closed = await closeChangeSet(id, { user: req.user, tests, ideToken: req.ideToken })
        res.json(closed)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sessions/resume', async (req, res) => {
    try {
        const { id } = req.body
        if (!id) return res.status(400).json({ error: 'id required' })
        const sess = cl.getSession(id)
        if (!sess) return res.status(404).json({ error: `No change set ${id}` })
        if (!gateReadOnly(res, sess.server)) return
        if (!(await mayManageSession(req, sess))) {
            return res.status(403).json({ error: `Change set ${id} belongs to ${sess.user ?? 'another user'}.` })
        }
        res.json(cl.resumeSession(id))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions/active', (req, res) => {
    try {
        const s = cl.getActiveSession(req.query.server, req.user)
        if (!s) return res.json(null)
        res.json({ ...s, entry_count: (() => { try { return cl.getSessionLog(s.id).length } catch { return 0 } })() })
    } catch (e) { res.status(500).json({ error: e.message }) }
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

app.patch('/api/sessions/:id/description', async (req, res) => {
    try {
        const sess = cl.getSession(req.params.id)
        if (!sess) return res.status(404).json({ error: `No change set ${req.params.id}` })
        if (!gateReadOnly(res, sess.server)) return
        if (!(await mayManageSession(req, sess))) {
            return res.status(403).json({ error: `Change set ${req.params.id} belongs to ${sess.user ?? 'another user'}.` })
        }
        res.json(cl.updateSessionDescription(req.params.id, req.body.description))
    } catch (e) { res.status(500).json({ error: e.message }) }
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

        if (entry.object_type === 'rules') {
            await client.patch(`Cubes('${odataKey(entry.object_name)}')`, { Rules: before.text ?? '' })
        } else if (entry.object_type === 'process') {
            await client.patch(`Processes('${odataKey(entry.object_name)}')`, {
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
    catch (e) { fail(res, e) }
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

function logAttributeValue({ server, dimension, element, attribute, hierarchy, before, after, user }) {
    if (String(before ?? '') === String(after ?? '')) return
    try {
        cl.writeLog({
            server,
            action: 'ATTRIBUTE_VALUE_SET',
            objectType: 'attribute-value',
            objectName: `${dimension}:${element}:${attribute}`,
            detail: { dimension, hierarchy: hierarchy ?? dimension, element, attribute, before: before ?? null, after: after ?? null },
            user,
        })
    } catch { /* history must not block the value write */ }
}

// Bulk attribute import: rows = [{ element, attrName, value }]
app.post('/api/dimension/bulk-attr-import', async (req, res) => {
    try {
        const { server, dimension, hierarchy = dimension, rows } = req.body
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const errors = []
        for (const row of rows) {
            if (!row.element?.trim() || !row.attrName?.trim()) continue
            const element = row.element.trim()
            const attribute = row.attrName.trim()
            try {
                const current = await client.getElementAttributeValues(dimension, element, hierarchy).catch(() => ({}))
                const before = current?.[attribute] ?? null
                await client.writeElementAttribute(dimension, element, attribute, row.value ?? '', row.type || 'S', hierarchy)
                logAttributeValue({ server, dimension, element, attribute, hierarchy, before, after: row.value ?? '', user: req.user })
            } catch (e) { errors.push(`${row.element}[${row.attrName}]: ${e.message}`) }
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
        fail(res, e)
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
        await client.patch(`Cubes('${odataKey(req.query.cube)}')`, { Rules: req.body.rules })
        invalidateCubeSources(req.query.server)
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
        const result = await client.post(`Cubes('${odataKey(cube)}')/tm1.CheckRules`, { Rules: rules })
        res.json({ errors: result.value ?? [] })
    } catch (e) { fail(res, e) }
})

// ── Process detail + execute ──────────────────────────────────────────────────
app.get('/api/process', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getProcess(req.query.name))
    } catch (e) {
        console.error('[api/process] GET failed:', e.response?.status, e.message)
        fail(res, e)
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
    const { server, name, params, sections, watches, breakpoints, captureWhen } = req.body
    if (!gateReadOnly(res, server)) return
    const client   = makeClient(server, req.ideToken)
    const tempName = `_IDE_Debug_${Date.now()}`
    let log = '', runError = null

    // ── 1. Fetch source process metadata ─────────────────────────────────────
    let proc
    try {
        proc = await client.get(`Processes('${odataKey(name)}')`)
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
        // capped: a breakpoint in the Data section fires once per record, and the log is one growing
        // string — capturing every record made a debug run on a big view crawl past the 2-minute timeout
        const guard = String(captureWhen ?? '').replace(/[\r\n]/g, ' ').trim()
        const condition = guard
            ? `nDBGHit__IDE__ < ${MAX_HITS} & (${guard})`
            : `nDBGHit__IDE__ < ${MAX_HITS}`
        const lines = [`IF( ${condition} ); nDBGHit__IDE__ = nDBGHit__IDE__ + 1;`,
                       `sDBGLog__IDE__ = ATTRS('}Processes', '${AT}', '${ATTR}');`]
        lines.push(`sDBGLog__IDE__ = sDBGLog__IDE__ | '${label}' | CHAR(10);`)
        for (const w of (watches ?? [])) {
            const val = w.type === 'number' ? `NumberToString(${w.name})` : w.name
            lines.push(`sDBGLog__IDE__ = sDBGLog__IDE__ | '__DBG_VAR:${w.name}__${sectionLabel}__${lineNum}=' | ${val} | CHAR(10);`)
        }
        lines.push(`AttrPutS(sDBGLog__IDE__, '}Processes', '${AT}', '${ATTR}');`)
        lines.push('ENDIF;')
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
    const MAX_HITS   = 50
    // The hit counter starts on its own line before the Prolog. Prefixing it to
    // line 1 broke processes whose first line was a #Region/comment.
    const prologInst = (hasCapture ? 'nDBGHit__IDE__ = 0;\n' : '') + instrumentSection(sections.PrologProcedure, 'PrologProcedure', 'Prolog')
    // TM1's property is MetadataProcedure (lowercase d); an older client may still send MetaDataProcedure
    const metaSrc    = sections.MetadataProcedure ?? sections.MetaDataProcedure ?? ''
    if (breakpoints && breakpoints.MetadataProcedure == null && breakpoints.MetaDataProcedure) breakpoints.MetadataProcedure = breakpoints.MetaDataProcedure
    const metaInst   = metaSrc.trim()
        ? instrumentSection(metaSrc, 'MetadataProcedure', 'Metadata')
        : (jc(metaSrc))
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
            // the copy must keep the datasource + its variables, or the Data section never runs
            datasource: proc.DataSource ? stripMeta(proc.DataSource) : undefined,
            variables:  (proc.Variables ?? []).map(stripMeta),
        })
    } catch (e) {
        return res.status(500).json({ error: `Failed to create debug process: ${e.message}` })
    }

    // ── 5. Execute ─────────────────────────────────────────────────────────────
    try {
        const dbgRun = await client.executeProcess(tempName, params ?? [])
        const status = dbgRun?.ProcessExecuteStatusCode
        if (status && !['CompletedSuccessfully', 'HasMinorErrors', 0].includes(status)) {
            const errFile = dbgRun?.ErrorLogFile?.Filename
            runError = errFile
                ? ((await client.getErrorLogContent(errFile).catch(() => null))?.Content || `Debug run ${status}`)
                : `Debug run ${status}`
        }
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
        await client.patch(`Processes('${odataKey(req.query.name)}')`, body)
        invalidateCubeSources(req.query.server)
        const afterState = {
            prolog:   req.body.PrologProcedure                                       ?? beforeState?.prolog   ?? '',
            metadata: req.body.MetaDataProcedure ?? req.body.MetadataProcedure       ?? beforeState?.metadata ?? '',
            data:     req.body.DataProcedure                                         ?? beforeState?.data     ?? '',
            epilog:   req.body.EpilogProcedure                                       ?? beforeState?.epilog   ?? '',
        }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'PROCESS_SAVED', objectType: 'process', objectName: req.query.name, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        console.error('[api/process] SAVE failed:', e.response?.status, e.message)
        fail(res, e)
    }
})

app.post('/api/process/run', async (req, res) => {
    if (!gateReadOnly(res, req.query.server)) return
    const procName = req.query.name
    if (!procName) return res.status(400).json({ error: 'name required' })
    try {
        const client   = makeClient(req.query.server, req.ideToken)
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
            } catch (e) {
            console.error('[process/run] __RUN_LOG MDX failed:', e.message)
        }

        // ── 4. Fallback: if no __RUN_LOG and process errored, use TM1 ErrorLog ────
        if (!runLog && runError) {
                try {
                const errLog = await client.get(`Processes('${odataKey(procName)}')/ErrorLog`)
                runLog = typeof errLog === 'string' ? errLog : (errLog?.value ?? '')
            } catch (e) {
                console.error('[process/run] ErrorLog fallback failed:', e.message)
            }
        }

        // ── 5. Detect __ERROR: validation marker (written before ProcessQuit) ────────
        if (!runError && runLog.startsWith('__ERROR:')) {
            const msg = runLog.replace(/^__ERROR:/, '').trim()
            return res.status(500).json({ error: msg, section: null, line: null, runLog: msg })
        }

        if (runError) {
            res.status(500).json({ error: runError, section: errorSection, line: errorLine, runLog, errorLogFilename })
        } else {
            res.json({ ok: true, duration, runLog, errorLogFilename })
        }
    } catch (e) { fail(res, e) }
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
        const client = makeClient(server, req.ideToken)
        const current = await client.getElementAttributeValues(dimension, element, hierarchy).catch(() => ({}))
        const before = current?.[attribute] ?? null
        await client.writeElementAttribute(dimension, element, attribute, value, type, hierarchy)
        logAttributeValue({ server, dimension, element, attribute, hierarchy, before, after: value, user: req.user })
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

app.post('/api/view/preview-records', async (req, res) => {
    try {
        const { server, cube, view } = req.query
        res.json(await makeClient(server, req.ideToken).previewViewRecords(cube, view, 20))
    } catch (e) { fail(res, e) }
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
            await client.saveNativeView(cube, name, nativeAxes)
        } else {
            await client.saveView(cube, name, mdx)
        }
        const afterState = nativeAxes ? { type: 'native', definition: nativeAxes } : { type: 'mdx', mdx: mdx ?? '' }
        const { hasSession } = cl.writeLog({ server, action: 'VIEW_SAVED', objectType: 'view', objectName: name, detail: cube, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { fail(res, e) }
})

app.post('/api/view/set-default', async (req, res) => {
    try {
        const { server, cube, name } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.setDefaultView(cube, name)
        res.json({ ok: true, noSession: false })
    } catch (e) {
        console.error('[set-default]', e.message, e.response?.status)
        fail(res, e)
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
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
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
        const { name, type, parent, before } = req.body
        await client.addElementAt(dimension, name, type, hierarchy, { parent, before })
        const where = parent ? ` under ${parent}${before ? ` before ${before}` : ''}` : before ? ` before ${before}` : ''
        cl.writeLog({ server, action: 'ELEMENT_ADDED', objectType: 'dimension', objectName: dimension, detail: `${name}${where}`, user: req.user })
        res.json({ ok: true })
    } catch (e) {
        console.error(`[dimension/element] ${req.query.dimension}: ${e.message}`)
        fail(res, e)
    }
})

app.delete('/api/dimension/element', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.deleteElement(dimension, name, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_DELETED', objectType: 'dimension', objectName: dimension, detail: name, user: req.user })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/dimension/element', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.renameElement(dimension, name, req.body.newName, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_RENAMED', objectType: 'dimension', objectName: dimension, detail: `${name} → ${req.body.newName}`, user: req.user })
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

// Place an existing element under a parent at a given position (drag-and-drop).
app.post('/api/dimension/component', async (req, res) => {
    try {
        const { server, dimension, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const { parent, child, before, weight } = req.body
        await client.setComponent(dimension, parent, child, before ?? null, weight ?? 1, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_LINKED', objectType: 'dimension', objectName: dimension, detail: `${child} under ${parent}${before ? ` before ${before}` : ''}`, user: req.user })
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
        cl.writeLog({ server, action: 'EDGE_REMOVED', objectType: 'dimension', objectName: dimension, detail: `${parent} · removed ${child}`, user: req.user })
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
        res.json(await client.scanSubsetUsage(req.query.dimension, req.query.subset, req.query.hierarchy || req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/view/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanViewUsage(req.query.cube, req.query.view))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/view/source-usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await getViewSourceUsage(client, req.query.server, req.query.cube, req.query.view, scanIdentity(req)))
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

// Alternate Hierarchies — what a hierarchy is (default / alternate / TM1's Leaves) and which
// processes build it; an element's parents in each hierarchy; build one from an attribute.
app.get('/api/hierarchy/info', async (req, res) => {
    try {
        const { server, dimension, hierarchy } = req.query
        res.json(await makeClient(server, req.ideToken).hierarchyInfo(dimension, hierarchy))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/element/hierarchy-parents', async (req, res) => {
    try {
        const { server, dimension, element } = req.query
        res.json(await makeClient(server, req.ideToken).elementHierarchyParents(dimension, element))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/hierarchy/from-attribute', async (req, res) => {
    try {
        const { server, dimension, hierarchy, attribute, levelDimension, hookProcess } = req.body
        if (!gateWrite(res, server)) return
        const r = await makeClient(server, req.ideToken).buildHierarchyFromAttribute({ dimension, hierarchy, attribute, levelDimension, hookProcess })
        cl.writeLog({ server, action: 'PROCESS_SAVED', objectType: 'process', objectName: r.process, detail: `builds the "${hierarchy}" Alternate Hierarchy on ${dimension} from ${attribute}`, user: req.user })
        cl.writeLog({ server, action: 'HIERARCHY_CREATED', objectType: 'dimension', objectName: hierarchy, detail: dimension, user: req.user })
        if (r.hooked) cl.writeLog({ server, action: 'PROCESS_SAVED', objectType: 'process', objectName: r.hooked, detail: `now runs ${r.process}`, user: req.user })
        res.json({ ok: true, ...r })
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
// Scope: Rules + TI, used by Find & Replace. The Explorer's Ctrl+Shift+F quick
// search is deliberately TI-only (see /api/processes/search and FEATURES.md).
app.get('/api/search/index', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const [cubes, processData] = await Promise.all([
            client.getAllCubesWithRules(),
            client.get('Processes', {
                '$select': 'Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure',
            }),
        ])
        const rulesResults = cubes.map(c => ({ name: c.Name, rules: c.Rules ?? '' }))
        const processResults = (processData.value ?? [])
            .filter(p => !p.Name.startsWith('}'))
            .map(p => ({
                name: p.Name,
                Prolog:   p.PrologProcedure ?? '',
                Metadata: p.MetaDataProcedure ?? p.MetadataProcedure ?? '',
                Data:     p.DataProcedure ?? '',
                Epilog:   p.EpilogProcedure ?? '',
            }))
        console.log('[api/search/index] request:', req.query.server, `${rulesResults.length} rules, ${processResults.length} processes`)
        res.json({ rules: rulesResults, processes: processResults })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Subsets ───────────────────────────────────────────────────────────────────
app.get('/api/subsets', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getSubsets(req.query.dimension, req.query.hierarchy || undefined))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/subset', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getSubset(req.query.dimension, req.query.name, req.query.hierarchy || undefined))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/subset', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client      = makeClient(req.query.server, req.ideToken)
        const current     = await client.getSubset(req.query.dimension, req.query.name, req.query.hierarchy || undefined).catch(() => null)
        const beforeState = current ? { expression: current.Expression ?? '' } : null
        await client.saveSubset(req.query.dimension, req.query.name, req.body.mdx, req.query.hierarchy || undefined)
        const afterState  = { expression: req.body.mdx }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'SUBSET_SAVED', objectType: 'subset', objectName: req.query.name, detail: req.query.dimension, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { fail(res, e) }
})

app.get('/api/subset/elements', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getSubsetElements(req.query.dimension, req.query.name, req.query.hierarchy || undefined))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/subset/static', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client      = makeClient(req.query.server, req.ideToken)
        const currentEls  = await client.getSubsetElements(req.query.dimension, req.query.name, req.query.hierarchy || undefined).catch(() => null)
        const beforeState = currentEls ? { elements: currentEls.map(e => e.name) } : null
        await client.saveStaticSubset(req.query.dimension, req.query.name, req.body.elements, req.query.hierarchy || undefined)
        const afterState  = { elements: req.body.elements ?? [] }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'SUBSET_SAVED', objectType: 'subset', objectName: req.query.name, detail: req.query.dimension, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { fail(res, e) }
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
    } catch (e) { fail(res, e) }
})

// ── Native View Execute (with suppression toggle) ────────────────────────────
// ── MDX Execute ──────────────────────────────────────────────────────────────
app.post('/api/mdx/execute', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.executeMDX(req.body.mdx))
    } catch (e) { fail(res, e) }
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
        const encodePath = (p) => encodeURIComponent(encodeURIComponent(p)) // odata-key: ok — PAW Assets path, not a TM1 key
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

// ── Chore execute / activate / deactivate / create ────────────────────────────
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
        if (!(await requireTm1Admin(req, res, req.query.server))) return
        await makeClient(req.query.server, req.ideToken).cancelJob(req.query.id)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Process error logs ────────────────────────────────────────────────────────
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
    } catch (e) { fail(res, e) }
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

// ── Cell annotations ──────────────────────────────────────────────────────────
// ── Transaction log ───────────────────────────────────────────────────────────
// A TM1 log search can't be cancelled once started, so a repeat of the same search by the same
// user (a second click, a refresh) joins the one already running instead of starting another.
const txLogSearches = new Map()
app.get('/api/transactions', async (req, res) => {
    try {
        const { server, cube, top, elements, days } = req.query
        const parsed = elements ? JSON.parse(elements) : null
        const nDays  = Math.min(Math.max(parseInt(days) || 7, 1), 366)
        const client = makeClient(server, req.ideToken)
        // Logging off: TM1 keeps no history for this cube, so don't make it search for nothing.
        if (await client.getCubeLoggingOff(cube) === true) return res.json({ entries: [], loggingOff: true, days: nDays })
        const key = [req.ideToken ?? '', server, cube, nDays].join('|')
        let search = txLogSearches.get(key)
        if (!search) {
            search = client.getTransactionLog(cube, { top: 5000, days: nDays }).finally(() => txLogSearches.delete(key))
            txLogSearches.set(key, search)
        }
        const rows = await search
        const want = Array.isArray(parsed) ? parsed : null
        const entries = rows
            .filter(e => !want || want.every((el, i) => !el || (e.Tuple?.[i] ?? '') === el))
            .slice(0, top ? parseInt(top) : 200)
        res.json({ entries, loggingOff: false, days: nDays })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Restore one cell to the value it had before a logged change (the Log panel's Restore button).
// TM1 admins only — the log isn't filtered by cell security. Refuses, unless forced, when the cell
// has changed again since that log row, so a newer change is never wiped by accident. The write
// goes through the user's own TM1 login, so TM1 still decides whether the cell can be written.
app.post('/api/transactions/restore', async (req, res) => {
    try {
        const { server, cube, tuple, restoreTo, expectNow, force } = req.body ?? {}
        if (!gateReadOnly(res, server)) return
        if (!server || !cube || !Array.isArray(tuple) || !tuple.length)
            return res.status(400).json({ error: 'server, cube and tuple are required' })
        const client = makeClient(server, req.ideToken)
        const me = await client.get('ActiveUser', { '$expand': 'Groups($select=Name)' })
        if (!isAdminGroups(me?.Groups))
            return res.status(403).json({ error: `Only TM1 admins can restore values from the transaction log on ${server}.` })
        const dims = ((await client.get(`Cubes('${odataKey(cube)}')/Dimensions`, { '$select': 'Name' })).value ?? []).map(d => d.Name)
        if (dims.length !== tuple.length)
            return res.status(400).json({ error: `The log row has ${tuple.length} elements but ${cube} has ${dims.length} dimensions.` })
        const br = x => String(x).replace(/]/g, ']]')
        // TM1 v11 rejects an axis-less SELECT, so the last dimension goes on columns, the rest in WHERE.
        const mem = i => `[${br(dims[i])}].[${br(dims[i])}].[${br(tuple[i])}]`
        const last = dims.length - 1
        const where = dims.slice(0, last).map((_, i) => mem(i)).join(',')
        const cell = await client.post('ExecuteMDX?$expand=Cells($select=Value)', {
            MDX: `SELECT {${mem(last)}} ON 0 FROM [${br(cube)}]${where ? ` WHERE (${where})` : ''}` })
        const current = cell?.Cells?.[0]?.Value ?? null
        const same = (a, b) => (a == null || a === '' ? 0 : a) == (b == null || b === '' ? 0 : b) || String(a ?? '') === String(b ?? '')
        if (!force && !same(current, expectNow))
            return res.status(409).json({ error: 'changed since', current })
        await client.writeCellValue(cube, dims.map((dim, i) => ({ dim, element: tuple[i] })), restoreTo ?? 0)
        cl.writeLog({ server, action: 'CELL_RESTORED', objectType: 'cell', objectName: cube,
            detail: `${tuple.join(' · ')}: ${current} → ${restoreTo} (restored from the transaction log)`,
            beforeState: { tuple, value: current }, afterState: { tuple, value: restoreTo }, user: req.user })
        res.json({ ok: true, previous: current, value: restoreTo })
    } catch (e) { fail(res, e) }
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
        const content = await client.downloadFile(pathParts, name)
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
        res.setHeader('Content-Type', 'application/octet-stream')
        res.send(Buffer.isBuffer(content) ? content : Buffer.from(content))
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
        if (!(await requireTm1Admin(req, res, req.query.server))) return
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
        if (!(await requireTm1Admin(req, res, req.query.server))) return
        await makeClient(req.query.server, req.ideToken).cancelThread(req.query.id)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Server admin ─────────────────────────────────────────────────────────────
app.get('/api/admin/metrics', async (req, res) => {
    try {
        const { server, cube } = req.query
        if (!(await requireTm1Admin(req, res, server))) return
        res.json(await makeClient(server, req.ideToken).getMetrics(cube || null))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/admin/configuration', async (req, res) => {
    try {
        if (!(await requireTm1Admin(req, res, req.query.server))) return
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

// Write all changed cube data to disk. Admin-only; falls back to }IDE.SaveDataAll
// on servers without the REST tm1.SaveDataAll action.
app.post('/api/server/save-data-all', createSaveDataAllRoute({
    makeClient,
    gateReadOnly,
    writeLog: cl.writeLog,
}))

// Simple mode switch (Server Admin → IDE). It changes the IDE for everyone on the
// server, so only TM1 admins may flip it. Kept in config/ide-modes.json; a server
// marked simple in servers.json can't be switched off here.
app.post('/api/server/simple-mode', async (req, res) => {
    const { server, simple } = req.body ?? {}
    if (!server) return res.status(400).json({ error: 'server required' })
    try {
        if (simpleSource(server) === 'config') {
            return res.status(409).json({ error: `Simple mode for ${server} is set in config/servers.json — change it there.` })
        }
        const me = await makeClient(server, req.ideToken).get('ActiveUser', { '$expand': 'Groups($select=Name)' })
        if (!isAdminGroups(me?.Groups)) {
            return res.status(403).json({ error: `Only TM1 admins can change Simple mode on ${server}.` })
        }
        setSimpleInModes(server, !!simple)
        cl.writeLog({ server, action: simple ? 'SIMPLE_MODE_ON' : 'SIMPLE_MODE_OFF', objectType: 'server', objectName: server, detail: `Simple mode ${simple ? 'on' : 'off'}`, user: req.user })
        res.json({ ok: true, server, simple: !!simple })
    } catch (e) { fail(res, e) }
})

app.patch('/api/admin/configuration', async (req, res) => {
    try {
        const { server, section = 'Administration', values } = req.body
        if (!gateReadOnly(res, server)) return
        if (!(await requireTm1Admin(req, res, server))) return
        res.json(await makeClient(server, req.ideToken).patchStaticConfiguration(section, values))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// tm1s.Enable/DisableMaintenanceMode arrived in TM1 12.6 — older servers 404.
function sendMaintenanceError(res, e) {
    const is404 = e.response?.status === 404 || e.message?.includes('404')
    if (is404) return res.status(404).json({ error: 'Maintenance mode is not available on this server — it needs TM1 12.6 or later.' })
    res.status(500).json({ error: e.message })
}

app.post('/api/admin/maintenance/enable', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.body.server)) return
        if (!(await requireTm1Admin(req, res, req.body.server))) return
        res.json(await makeClient(req.body.server, req.ideToken).enableMaintenanceMode())
    } catch (e) { sendMaintenanceError(res, e) }
})

app.post('/api/admin/maintenance/disable', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.body.server)) return
        if (!(await requireTm1Admin(req, res, req.body.server))) return
        res.json(await makeClient(req.body.server, req.ideToken).disableMaintenanceMode())
    } catch (e) { sendMaintenanceError(res, e) }
})

// ── User management ───────────────────────────────────────────────────────────
// Acts on the server selected in the UI (?server= / body.server); the login
// server only when none is given.
const userServer = (req) => req.query?.server ?? req.body?.server ?? PAW_LOGIN_SERVER
app.post('/api/users/provision', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
        const { name, password, groups = [], friendlyName = '' } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.createClient(name, password, friendlyName)
        for (const g of groups) {
            try { await cl.addClientToGroup(name, g) } catch {}
        }
        res.json({ ok: true })
    } catch (e) {
        console.error('[provisionUser]', e.response?.status, e.message)
        fail(res, e)
    }
})

app.post('/api/users/:name/password', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
        const { password } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.resetClientPassword(req.params.name, password)
        // Reset your own login on this server → keep the IDE signed in with the new one.
        const mine = getServerCredentials(req.ideToken, userServer(req))
        if (mine && mine.username.toLowerCase() === req.params.name.toLowerCase()) {
            setServerCredentials(req.ideToken, userServer(req), { username: mine.username, password }, mine.state)
        }
        res.json({ ok: true })
    } catch (e) { fail(res, e) }
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
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
        const { name, password, friendlyName } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        res.json(await cl.createClient(name, password, friendlyName))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/users/:name', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
        const { server: _s, ...patch } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.updateClient(req.params.name, patch)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/users/:name', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
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
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
        const { group } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.addClientToGroup(req.params.name, group)
        res.json({ ok: true })
    } catch (e) {
        console.error('[addClientToGroup]', e.response?.status, e.message)
        fail(res, e)
    }
})

app.delete('/api/users/:name/groups/:group', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
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
    if (!gateWrite(res, server)) return
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
    } catch (e) { fail(res, e) }
})

app.post('/api/forge', (req, res) => {
    try {
        fs.mkdirSync(path.dirname(FORGE_PATH), { recursive: true })
        // The workspace file is layout only. Strip an old client's editor bodies and
        // dirty flags so they cannot be written back.
        const body = { ...(req.body ?? {}) }
        if (Array.isArray(body.tabs)) body.tabs = body.tabs.map(({ content: _c, dirty: _d, ...meta }) => meta)
        fs.writeFileSync(FORGE_PATH, JSON.stringify(body, null, 2))
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
        if (!gateWrite(res, server)) return

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

        await client.patch(`Processes('${odataKey(processName)}')`, {
            ...odbcProps,
            Parameters: parameters,
        })

        res.json({ ok: true, created: createNew, dsn: conn.dsn, paramsAdded: newParams.map(p => p.Name) })
    } catch (e) {
        console.error('[sql/post-to-ti]', e.message)
        fail(res, e)
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
        console.error('[sql/preview-datasource]', e.message)
        fail(res, e)
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
// ── Cell write ────────────────────────────────────────────────────────────────
// Body: { server, cube, dims: [{ dim, element }, ...], value }
app.post('/api/cells/write', async (req, res) => {
    try {
        const { server, cube, dims, value } = req.body
        if (!gateReadOnly(res, server)) return
        if (!server || !cube || !Array.isArray(dims) || dims.length === 0)
            return res.status(400).json({ error: 'server, cube, and dims are required' })
        const client = makeClient(server, req.ideToken)
        const result = await client.writeCellValue(cube, dims, value)
        res.json({ ok: true })
    } catch (e) {
        console.error('[cells/write] ERROR:', e.message)
        fail(res, e)
    }
})

// ── Deploy pipeline ───────────────────────────────────────────────────────────

// When this server's baseline was last seeded — the start of its release window.
app.post('/api/deploy/pre-delete-check', async (req, res) => {
    try {
        const { server, dimension, element, hierarchy } = req.body
        if (!server || !dimension || !element) return res.status(400).json({ error: 'server, dimension and element required' })
        const client = makeClient(server, req.ideToken)
        res.json(await client.preDeleteElementCheck(dimension, element, hierarchy ?? dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/baseline', (req, res) => {
    try {
        const snapshot = deployLoadBaseline(null, req.query.server)
        if (!snapshot) return res.json({ exists: false })
        res.json({ exists: true, ...snapshot._meta })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Git readiness check (IMPROVEMENTS 10.2) ─────────────────────────────────
// On demand, single server or cross-server. Also run as a blocker in the deploy
// risk check before every push. Findings: member-less view titles, stale member
// references in views/subsets, names TM1 Git won't round-trip, tm1project Ignore.
app.get('/api/git-readiness', async (req, res) => {
    try {
        const { scan } = require('./core/git-readiness')
        const { listServers } = require('./core/adapter_registry')
        if (req.query.all === '1') {
            const results = []
            for (const s of listServers()) {
                try { results.push(await scan(s, { ideToken: req.ideToken })) }
                catch (e) { results.push({ server: s, error: e.message }) }
            }
            return res.json({ results })
        }
        if (!req.query.server) return res.status(400).json({ error: 'server or all=1 required' })
        res.json(await scan(req.query.server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Model health (v1) ───────────────────────────────────────────────────────
// "Does the model compute right, would TM1 Git accept it, does it meet house
// standards". POST: it runs assertions (MDX) + the full scan. Button-triggered.
app.post('/api/model-health', async (req, res) => {
    try {
        const server = req.query.server ?? req.body?.server
        if (!server) return res.status(400).json({ error: 'server required' })
        const { check } = require('./core/model-health')
        res.json(await check(server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Assertions management ───────────────────────────────────────────────────
// List, add, update, remove and run the model's stored assertions. Writes are
// gated on read-only posture like other model edits.
app.get('/api/assertions', async (req, res) => {
    try {
        const { list } = require('./core/assertions')
        if (!req.query.server) return res.status(400).json({ error: 'server required' })
        res.json(await list(req.query.server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/assertions', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const { add } = require('./core/assertions')
        const { author: _author, changeSet: _changeSet, user: _user, createdBy: _createdBy, ...body } = req.body
        const active = cl.getActiveSession(req.query.server, req.user)
        res.json(await add(req.query.server, { ...body, author: req.user, changeSet: active?.id ?? null }, { ideToken: req.ideToken }))
    } catch (e) { res.status(e.status ?? 500).json({ error: e.message }) }
})
app.patch('/api/assertions/:id', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const { update } = require('./core/assertions')
        const { changeSet: _changeSet, user: _user, createdBy: _createdBy, ...body } = req.body
        const r = await update(req.query.server, req.params.id, body, { ideToken: req.ideToken, by: req.user })
        if (!r) return res.status(404).json({ error: `No assertion ${req.params.id}` })
        res.json(r)
    } catch (e) { res.status(e.status ?? 500).json({ error: e.message }) }
})
app.delete('/api/assertions/:id', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const { remove } = require('./core/assertions')
        const ok = await remove(req.query.server, req.params.id, { ideToken: req.ideToken })
        res.json({ ok })
    } catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/assertions/run', async (req, res) => {
    try {
        const { run, runOne } = require('./core/assertions')
        if (!req.query.server) return res.status(400).json({ error: 'server required' })
        if (req.body?.id) return res.json(await runOne(req.query.server, req.body.id, { ideToken: req.ideToken }))
        res.json(await run(req.query.server, { kind: req.body?.kind, severity: req.body?.severity, tags: req.body?.tags, ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})
app.get('/api/assertions/history', async (req, res) => {
    try {
        const { makeClient } = require('./core/adapter_registry')
        const { recentRuns } = require('./core/test-results')
        if (!req.query.server) return res.status(400).json({ error: 'server required' })
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await recentRuns(client, { assertionId: req.query.id, limit: Number(req.query.limit) || 10 }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Git deploy (IMPROVEMENTS 10.1 hybrid) ───────────────────────────────────
// Prepare = target baseline + pull plan preview (read-only). Execute = atomic
// pull + control checks on the target (a real deploy — gated by the UI/approval).
app.post('/api/deploy/git/prepare', async (req, res) => {
    try {
        const { prepare } = require('./core/git-deploy')
        const { source, target, branch, session } = req.body
        if (!source || !target) return res.status(400).json({ error: 'source and target required' })
        res.json(await prepare(source, target, { branch, token: process.env.TM1_GIT_TOKEN, ideToken: req.ideToken, session }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/deploy/git/execute', async (req, res) => {
    try {
        // Not gated by read-only: a recorded approval (enforced inside execute(),
        // non-optionally) is what authorises shipping to a PROD-posture target.
        const { execute } = require('./core/git-deploy')
        const { target, branch, source, session } = req.body
        if (!target) return res.status(400).json({ error: 'target required' })
        const result = await execute(target, { branch, token: process.env.TM1_GIT_TOKEN, ideToken: req.ideToken, source, by: req.user, session })
        if (result?.missingSource) return res.status(400).json({ error: result.error })
        if (result?.approvalSession && result?.executed && result?.controlOk) try { cl.markSessionDeployed(result.approvalSession, target) } catch { /* link is best-effort */ }
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})
// Push the source server's live state to the repo (step 2 of the deploy flow).
// TM1 Git commits the whole model; the plan is ephemeral, so create AND execute
// atomically. Does not touch the target.
app.post('/api/deploy/git/push', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.body?.source)) return
        const { source, branch = 'dev', message, session } = req.body
        if (!source) return res.status(400).json({ error: 'source required' })
        const { pushReadiness } = require('./core/git-readiness')
        const readiness = await pushReadiness(source, { ideToken: req.ideToken })
        if (!readiness.ok) {
            return res.status(409).json({
                error: `Readiness blockers must be fixed before pushing: ${readiness.blockers.join('; ')}`,
                blockers: readiness.blockers,
                readiness: readiness.readiness,
            })
        }
        const c = makeClient(source, req.ideToken)
        const gi = require('./core/git-identity')
        const creds = { Username: gi.user(), Password: process.env.TM1_GIT_TOKEN }
        const plan = await c.post('GitPush', {
            Branch: branch, NewBranch: '', Force: false,
            Message: message || `Deploy from ${source}`,
            Author: req.user ?? gi.user(), Email: gi.email(), ...creds,
        })
        await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        if (session) try { cl.setSessionCommit(session, plan.NewCommit?.ID ?? null) } catch { /* link is best-effort */ }
        res.json({ pushed: true, commit: plan.NewCommit?.ID ?? null, summary: plan.NewCommit?.Summary ?? null, readiness: readiness.readiness })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Change-set-scoped release ─────────────────────────────────────────────────
// Build branch release-<target> = the target's recorded deployed commit + only
// this change set's files. Deploying it ships exactly this change set.
app.post('/api/deploy/git/release', async (req, res) => {
    try {
        const { target, session } = req.body
        if (!target) return res.status(400).json({ error: 'target required' })
        const changeSet = session ? cl.getSession(session) : null
        if (!changeSet) return res.status(400).json({ error: 'a change set (session) is required' })
        const { buildRelease } = require('./core/git-release')
        const r = await buildRelease(changeSet, target, { token: process.env.TM1_GIT_TOKEN, gitUser: _GI().user(), ideToken: req.ideToken })
        if (r.refused) return res.status(409).json({ error: r.error })
        if (r.ok === false) return res.status(500).json({ error: r.error })
        cl.setSessionRelease(changeSet.id, r.releaseCommit, target)
        res.json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Approval — the recorded human decision that gates a deploy. ─────────────
// Bound to a specific commit + target: a new commit invalidates the old approval.
// Stored locally (gitignored) via core/git-approvals.
app.post('/api/deploy/git/approve', async (req, res) => {
    try {
        const { source, target, commit, note } = req.body
        if (!target || !commit) return res.status(400).json({ error: 'target and commit required' })
        const approvals = require('./core/git-approvals')
        // Rule 1: only a BUILT RELEASE links to an approval (release_commit, built
        // for this exact target) — never a raw DEV commit_ref, and never a release
        // built for a different target. linkedChangeSet enforces both.
        const linkedSession = approvals.linkedChangeSet(commit, target)
        if (!linkedSession) {
            return res.status(409).json({ error: `Refused: commit ${commit} is not a release built for ${target}. Build the release first, then approve it.` })
        }
        let tests = null
        try { tests = linkedSession.close_tests ? JSON.parse(linkedSession.close_tests) : null } catch { tests = null }
        if (!tests || tests.blocking > 0) {
            return res.status(409).json({ error: `Refused: the change set for commit ${commit} has failing block-severity tests. Fix and re-close before approving.` })
        }
        // Dependency check before approval: rules must CheckRules clean on the target
        // and processes must pass TI lint — a failed reference may belong to another
        // change set (ship it too, or build a combined release).
        if (linkedSession.release_commit) {
            const { checkDependencies } = require('./core/git-release')
            const dep = await checkDependencies(linkedSession.release_commit, target, { token: process.env.TM1_GIT_TOKEN, gitUser: _GI().user(), ideToken: req.ideToken })
            if (!dep.ok) {
                return res.status(409).json({ error: `Refused: the release has failing dependencies — ${(dep.blockers ?? []).map(b => `${b.object}: ${b.message}`).join(' | ') || dep.error}`, blockers: dep.blockers ?? [] })
            }
        }
        const rec = await approvals.append({
            id: new Date().toISOString(), approved_at: new Date().toISOString(),
            approver: req.user ?? 'unknown', notes: note ?? '',
            source: source ?? null, target, commit, session: linkedSession.id, packageDir: null,
        }, { ideToken: req.ideToken })
        res.json(rec)
    } catch (e) { res.status(500).json({ error: e.message }) }
})
app.get('/api/deploy/git/approval', async (req, res) => {
    try {
        const approvals = require('./core/git-approvals')
        res.json(await approvals.find(req.query.target, req.query.commit, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})
// Review — the actual content diff the target will receive (read-only).
// ── Drift (#3): PROD pushes prod-live; diff vs its deployed commit. ─────────
app.post('/api/git/drift', async (req, res) => {
    try {
        const { driftCheck } = require('./core/git-drift')
        const server = req.body?.server ?? req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        res.json(await driftCheck(server, { token: process.env.TM1_GIT_TOKEN, ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})
// Deploy lock — is anything deploying to a target right now?
app.get('/api/git/lock', async (req, res) => {
    try {
        const { current } = require('./core/git-lock')
        const server = req.query?.server
        if (!server) return res.status(400).json({ error: 'server required' })
        res.json(await current(server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})
// Clear a STALE deploy lock (one a deploy that died left behind). Refuses to
// clear a live lock; records who/when in the deploy history.
app.post('/api/git/lock/clear', async (req, res) => {
    try {
        const { clear } = require('./core/git-lock')
        const server = req.body?.server
        if (!server) return res.status(400).json({ error: 'server required' })
        const result = await clear(server, { by: req.user, ideToken: req.ideToken })
        res.json(result)
    } catch (e) {
        res.status(e.refused ? 409 : 500).json({ error: e.message })
    }
})

// ── Git connection setup (first-time, guarded) ───────────────────────────────
// Link an EXISTING repo only — creating one needs a broader GitHub token, so the
// UI gives instructions instead. The token is never shown, logged or returned.
// Already-initialised servers report their link and are never re-initialised.
// Guardrails: no silent failures — every step reports, and a failure stops.
const _GI = () => require('./core/git-identity')
const _GITOK = () => process.env.TM1_GIT_TOKEN || ''

app.get('/api/git/setup/status', async (req, res) => {
    try {
        const server = req.query?.server
        if (!server) return res.status(400).json({ error: 'server required' })
        const st = await makeClient(server, req.ideToken).post('GitStatus', { Username: _GI().user(), Password: _GITOK() })
        res.json({ linked: !!st?.URL, repoUrl: st?.URL ?? null, deployment: st?.Deployment ?? null, connected: st?.Remote?.Connected ?? false })
    } catch (e) { fail(res, e) }
})

app.post('/api/git/setup/token', (req, res) => {
    try {
        gitSecrets.setToken(req.body?.token)
        res.json({ ok: true, note: 'token set ✓' })   // never the token itself
    } catch (e) { res.status(400).json({ error: e.message }) }
})

app.get('/api/git/setup/readiness', async (req, res) => {
    try {
        const { server } = req.query
        if (!server) return res.status(400).json({ error: 'server required' })
        const { scan } = require('./core/git-readiness')
        res.json(await scan(server, { gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/git/setup/init', async (req, res) => {
    try {
        const { server, repo, deployment, force } = req.body
        if (!server || !repo || !deployment) return res.status(400).json({ error: 'server, repo and deployment required' })
        if (!/^(DEV|TEST|PROD)$/i.test(deployment)) return res.status(400).json({ error: 'deployment should be DEV, TEST or PROD' })
        const { init } = require('./core/git-setup')
        const r = await init(server, { repo, deployment, force, gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken })
        if (r.refused) return res.status(409).json({ error: r.error })
        res.json(r)
    } catch (e) { fail(res, e) }
})

// DEV first push — the initial commit.
app.post('/api/git/setup/first-push', async (req, res) => {
    try {
        const { server, message } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        const c = makeClient(server, req.ideToken)
        const plan = await c.post('GitPush', { Branch: 'dev', NewBranch: '', Force: false, Message: message || `Initial state of ${server}`, Author: req.user ?? _GI().user(), Email: _GI().email(), Username: _GI().user(), Password: _GITOK() })
        await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        res.json({ ok: true, commit: plan.NewCommit?.ID ?? null, note: `First commit of ${server} pushed to the repo.` })
    } catch (e) { fail(res, e) }
})

// PROD first pull — full overwrite; requires the typed confirmation. The object
// list is shown first via the normal prepare route (fullOverwrite flag).
app.post('/api/git/setup/first-pull', async (req, res) => {
    try {
        const { server, branch = 'dev', confirm } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        const { firstPull } = require('./core/git-setup')
        const r = await firstPull(server, { branch, confirm, gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken })
        if (r.refused) return res.status(409).json({ error: r.error })
        if (r.ok === false) return res.status(400).json({ error: r.error })
        res.json(r)
    } catch (e) { fail(res, e) }
})

// ── Governance mirror (#4): Applications/Governance ⇄ governance/ in the repo ──
// ── Git reconcile (#6): deletes + attribute values the pull won't cover ──────
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

// Git deploy history for the History rail: the IDE-recorded deploy and the
// approvals for this target. Package archives stay available below as legacy.
app.get('/api/deploy/git/history', async (req, res) => {
    try {
        const target = req.query.target
        if (!target) return res.status(400).json({ error: 'target required' })
        const state = require('./core/git-state').load()[target] ?? null
        const approvals = await require('./core/git-approvals').readFor(target, { ideToken: req.ideToken })
        res.json({ target, deploy: state, approvals })
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
app.get('/api/admin/catalog-overrides', async (req, res) => {
    try {
        if (!(await requireTm1Admin(req, res, req.query.server))) return
        if (!fs.existsSync(CATALOG_OVERRIDES_PATH)) return res.json(EMPTY_OVERRIDES)
        res.json(JSON.parse(fs.readFileSync(CATALOG_OVERRIDES_PATH, 'utf8')))
    } catch (e) { res.status(500).json({ error: e.message }) }
})
app.put('/api/admin/catalog-overrides', async (req, res) => {
    try {
        if (!(await requireTm1Admin(req, res, req.query.server ?? req.body?.server))) return
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
        if (!gateWrite(res, server)) return
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
                try { await client.delete(`Processes('${odataKey(procName)}')`) } catch {}
            } catch (e) {
                message = e.message ?? ''
                status = message.toLowerCase().includes('syntax') || message.toLowerCase().includes('equal sign') ? 'invalid' : 'error'
                try { await client.delete(`Processes('${odataKey(procName)}')`) } catch {}
            }
            results.push({ name, status, message })
        }
        res.json({ results })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// Cache identity for model-wide scans: the per-user session token, hashed so the
// raw token never sits in a module-level Map. Fall back to the acting user name.
function scanIdentity(req) {
    if (req.ideToken) return crypto.createHash('sha256').update(String(req.ideToken)).digest('hex').slice(0, 16)
    return req.user ?? ''
}

// ── Cube Map ──────────────────────────────────────────────────────────────────
// The Runbook reads chores (from /api/cubemap/model) — a runbook is a chore, so there's no runbook file.

// ── Process summaries (AI worded, stored outside the TI) ─────────────────────
function processCode(p) {
    return [p.PrologProcedure, p.MetaDataProcedure ?? p.MetadataProcedure, p.DataProcedure, p.EpilogProcedure]
        .filter(Boolean).join('\n')
}

function summaryPrompt(p, f, includeCode) {
    const writes = f.writes.map(w => {
        const what = w.measures?.length ? w.measures.join(', ')
            : w.kinds?.includes('clear') ? 'cleared'
            : w.kinds?.includes('feeders') ? 'feeders recalculated'
            : 'written'
        return `- ${w.cube}: ${what}`
    }).join('\n')
    const params = (p.Parameters ?? []).map(x =>
        `${x.Name}${x.Value !== '' && x.Value != null ? ` (default ${x.Value})` : ''}${x.Prompt ? ` — ${x.Prompt}` : ''}`
    ).join('; ')
    const system = 'You document IBM TM1 TurboIntegrator processes for a data-lineage tooltip. Write plain English for an admin. ' +
        'Return ONLY: one or two sentences on what the process does and when it runs, then one line starting "Writes:" listing cube -> measures (or "clears"/"feeders"), ' +
        'then one line "Reads:" with the source cubes if any. No headings, no bullets, no code fences, no invented facts, no permissions unless they change what it does. Max 90 words.'
    const user = [
        `Process: ${p.Name}`,
        `Author's header:\n${f.header || '(none)'}`,
        `Parameters: ${params || '(none)'}`,
        `Datasource: ${f.source}`,
        `Writes (scanned from the code):\n${writes || '(no cube writes)'}`,
        `Reads (scanned): ${f.reads.join(', ') || '(none)'}`,
        `Called by: ${f.calledBy.join(', ') || '(nothing)'}`,
        includeCode ? `Code:\n${processCode(p).slice(0, 12000)}` : '',
    ].filter(Boolean).join('\n\n')
    return { system, user }
}

app.get('/api/process/summaries', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json({ processes: await listProcessSummaries(client, req.query.server, scanIdentity(req)), aiConfigured: ai.isConfigured() })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/process/summary', async (req, res) => {
    try {
        const { server, name } = req.body
        if (!ai.isConfigured()) return res.status(503).json({ error: 'AI not configured — set AI_PROVIDER and AI_API_KEY in .env (or write a summary by hand)' })
        const client = makeClient(server, req.ideToken)
        const p = await client.getProcess(name)
        if (!p?.Name) return res.status(404).json({ error: `Process "${name}" not found` })
        const hash = processSummaries.hashCode(processCode(p))
        if (!req.body.force) {
            const hit = processSummaries.get(server, name, hash)
            if (hit) return res.json({ ...hit, cached: true })
        }
        const facts = await getProcessFacts(client, server, name, scanIdentity(req))
        const obf = ai.shouldObfuscate()
        let { system, user } = summaryPrompt(p, facts, !obf)
        let map = null
        if (obf) {
            const names = [name, ...(facts.parameters ?? []), ...(facts.calledBy ?? []), ...(facts.reads ?? []),
                ...facts.writes.flatMap(w => [w.cube, ...(w.measures ?? [])])]
            map = obfuscate.makeMap(names)
            user = obfuscate.obfuscateText(user, map.realToCode)
        }
        let out = await ai.complete({ system, user, maxTokens: 400, label: 'process-summary', obfuscated: obf })
        if (map) out = obfuscate.restoreText(out, map.codeToReal)
        const summary = String(out ?? '').replace(/```[a-z]*\s*/gi, '').replace(/```/g, '').trim().slice(0, 1200)
        if (!summary) return res.status(502).json({ error: 'The model returned an empty summary' })
        if (!gateReadOnly(res, server)) return
        const entry = await processSummaries.put(server, name, { hash, summary, source: 'ai', model: process.env.AI_MODEL || '' })
        res.json({ ...entry, cached: false })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.put('/api/process/summary', async (req, res) => {
    try {
        const { server, name, summary } = req.body
        if (!String(summary ?? '').trim()) return res.status(400).json({ error: 'Summary is empty' })
        const client = makeClient(server, req.ideToken)
        const p = await client.getProcess(name)
        if (!p?.Name) return res.status(404).json({ error: `Process "${name}" not found` })
        if (!gateReadOnly(res, server)) return
        const entry = await processSummaries.put(server, name, {
            hash: processSummaries.hashCode(processCode(p)),
            summary: String(summary).trim().slice(0, 1200),
            source: 'manual',
        })
        res.json(entry)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// Rule lens — a cube's rules broken into target areas, measures, DB sources and feeders.
app.get('/api/cube/rules-lens', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const name = req.query.cube
        const cube = await client.getCube(name)
        if (!cube) return res.status(404).json({ error: `Cube "${name}" not found` })
        const dims = (cube.Dimensions ?? []).map(d => d.Name)
        const measureDim = dims.find(d => /measure/i.test(d)) ?? null
        const measureEls = measureDim ? await client.getElements(measureDim).catch(() => []) : []
        const allCubes = await client.getAllCubesWithRules().catch(() => [])
        const cubeNames = new Set(allCubes.map(c => c.Name))
        const parsed = parseRuleLens(cube.Rules ?? '', { measureElements: new Set(measureEls.map(e => e.Name)) })
        const checks = []
        const referenced = parsed.items.flatMap(i => [...(i.dbSources ?? []), ...(i.targetCubes ?? [])])
        const missing = [...new Set(referenced.filter(c => !cubeNames.has(c)))]
        if (missing.length) checks.push({ level: 'error', message: `Reads or feeds cubes that do not exist: ${missing.join(', ')}` })
        if ((cube.Rules ?? '').trim() && parsed.summary.feeders === 0) checks.push({ level: 'warn', message: 'No feeder statements found.' })
        res.json({ cube: name, dims, measureDim, hasRules: !!(cube.Rules ?? '').trim(), ...parsed, checks })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// Where a cube's data comes from — writers / readers / rule dependencies (Rules editor strip)
app.get('/api/cube/data-sources', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        if (req.query.refresh) invalidateCubeSources(req.query.server)
        const data = await getCubeDataSources(client, req.query.server, req.query.cube, scanIdentity(req))
        res.json({ ...data, aiConfigured: ai.isConfigured() })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/cubemap/model', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await buildCubeMapModel(client))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Lenses ────────────────────────────────────────────────────────────────────
// A Lens lives in the model it belongs to: one document per Lens under
// Applications/Governance/Lenses (core/lens_store.js → core/model-store.js),
// holding the HTML and its details. Nothing is stored locally. Every call runs as
// the signed-in user (req.ideToken), never the MCP's builder path. Saves and
// deletes are model changes: they need a writable server and an open change set,
// and are recorded in it.

// Lens examples — reference Lenses to start a new one from (a copy, never a link).
app.get('/api/lens-examples', (req, res) => {
    try { res.json(require('./core/lens_examples').listExamples()) } catch (e) { res.status(500).json({ error: e.message }) }
})
app.get('/api/lens-examples/:name', (req, res) => {
    try {
        const ex = require('./core/lens_examples')
        const meta = ex.listExamples().find(e => e.name === req.params.name)
        if (!meta) return res.status(404).json({ error: `Unknown Lens example "${req.params.name}"` })
        res.json({ meta, html: ex.readExample(req.params.name) })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/lenses', async (req, res) => {
    try {
        const server = req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        res.json(await lensStore.listLenses(server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Which processes the Lenses run (their declared lens-runs), as { process: [lens, ...] } — so the
// IDE can mark front-end actions without anyone tagging them. Cached briefly per user and server.
const lensUsageCache = new Map()
app.get('/api/lens/process-usage', async (req, res) => {
    try {
        const server = req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        const key = `${req.ideToken ?? ''}|${server}`
        const hit = lensUsageCache.get(key)
        if (hit && Date.now() - hit.at < 60_000) return res.json(hit.data)
        const usage = {}
        for (const l of await lensStore.listLensRuns(server, lensBridge.lensRuns, { ideToken: req.ideToken })) {
            for (const p of l.runs) (usage[p] ??= []).push(l.title || l.name)
        }
        lensUsageCache.set(key, { at: Date.now(), data: usage })
        res.json(usage)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/lenses/:name', async (req, res) => {
    try {
        const server = req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        const doc = await lensStore.readLens(server, req.params.name, { ideToken: req.ideToken })
        const { html: _own, ...meta } = doc
        res.json({ name: meta.name, html: doc.html ?? '', meta })
    } catch (e) { res.status(/not found/.test(e.message) ? 404 : 500).json({ error: e.message }) }
})

app.post('/api/lenses/:name', async (req, res) => {
    try {
        const server = req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const { html, description, folder, title, icon, color, image, config, publish, force } = req.body
        if (typeof html !== 'string' || !html.trim()) return res.status(400).json({ error: 'html is required' })
        const errors = await lensBridge.validateLens(client, html)
        if (errors.length && !force) {
            return res.status(400).json({ error: `Lens validation failed (${errors.length}):`, validation: errors })
        }
        const saved = await lensStore.saveLens(server, req.params.name, html, req.user, { publish: !!publish, description, folder, title, icon, color, image, config, ideToken: req.ideToken })
        cl.writeLog({ server, action: publish ? 'LENS_PUBLISHED' : 'LENS_SAVED', objectType: 'lens', objectName: saved.name,
            detail: `version ${saved.version}${description ? ` — ${description}` : ''}`, user: req.user })
        res.json({ ...saved, validation: errors })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/lenses/:name', async (req, res) => {
    try {
        const server = req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        if (!gateWrite(res, server)) return
        await lensStore.deleteLens(server, req.params.name, { ideToken: req.ideToken })
        cl.writeLog({ server, action: 'LENS_DELETED', objectType: 'lens', objectName: req.params.name, user: req.user })
        res.json({ ok: true })
    } catch (e) { res.status(/not found/.test(e.message) ? 404 : 500).json({ error: e.message }) }
})

const LENS_CATALOGUE = JSON.stringify(require('./shared/lens-components.json'), null, 1)
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

The ONLY way to get data is the bridge API below. There is NO network access, no fetch to any other URL, no CDN, no external fonts or images. The ONLY library is the Lens toolkit, served by the app: include <script src="/lens-kit/lens-kit.js"></script> before your own script.

Bridge API (always available):
  window.lensBridge.call('execMDX', { mdx: '<MDX SELECT>' }) -> Promise<{ Axes, Cells }>
      Cells: [{ Ordinal, Value, FormattedValue, RuleDerived, Consolidated }] — Value is a number or null.
  window.lensBridge.call('readCell', { cube: '<cube>', coordinates: { '<dim>': '<elem>', ... } }) -> Promise<number|string|null>
      coordinates must name EVERY dimension of the cube.
  window.lensBridge.call('getMeta', { cube: '<cube>' }) -> Promise<{ cubes, dimensions, cubeDims, elements }>
  window.lensBridge.call('elementTree', { dimension: '<dim>', hierarchy: '<hier>' }) -> Promise<[{ Name, Type, Level, Components }]>  (one dimension's tree; Lens.pivot uses it for drill-down; hierarchy optional, e.g. an ALT H)
  window.lensBridge.call('hierarchies', { dimension: '<dim>' }) -> Promise<[name]>  (the dimension's hierarchies: its main one and any ALT H)

Rules:
- Return a SINGLE complete HTML document (html, head, style, body, script). No markdown, no code fences, no explanation.
- Use the Lens toolkit (window.Lens) for charts, tables and networks wherever a component fits — it is described in the catalogue below. Turn every execMDX result into rows with Lens.rows(result). Write your own SVG/canvas only for a visual no component covers. No other external anything.

Lens toolkit catalogue:
${LENS_CATALOGUE}
- Style it as a polished executive dashboard: card layout, clear hierarchy, good typography, whitespace, a coherent color scheme. Add a small refresh button that re-runs the data calls.
- All numbers must come from the bridge at runtime — never hard-code values.
- Only build input (write-back) when the request asks for it: an editable Lens.grid plus Lens.save, and declare the cube in the head with <meta name="lens-writes" content="Cube Name">.
- Only add action buttons when asked: Lens.run('Process', { params }), declared with <meta name="lens-runs" content="Process Name">.
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

// ── Lens bridge (runs as the viewing user) ───────────────────────────────────

app.post('/api/lens/exec-mdx', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await lensBridge.execMDX(client, req.body?.mdx))
    } catch (e) { fail(res, e) }
})

app.post('/api/lens/read-cell', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const { cube, coordinates } = req.body
        res.json({ value: await lensBridge.readCell(client, cube, coordinates) })
    } catch (e) { fail(res, e) }
})

// Write-back from a Lens preview — same checks as the Lens app (declared cubes,
// numbers only, no calculated cells, nothing changed since it loaded), as the
// IDE user. Data entry, not a model change, so no change set is needed; a
// read-only (PROD-posture) server refuses it here.
app.post('/api/lens/write-cells', async (req, res) => {
    try {
        const server = req.query.server
        if (!gateReadOnly(res, server)) return
        const client = makeClient(server, req.ideToken)
        const name = req.body?.lens
        if (!name || typeof name !== 'string') throw new Error('lens is required')
        const doc = await lensStore.readLens(server, name, { ideToken: req.ideToken })
        const result = await lensBridge.writeCells(client, { cube: req.body?.cube, cells: req.body?.cells, allowedCubes: lensBridge.lensWrites(doc) })
        logLensWrite({ server, app: 'ide', user: req.user, lens: doc.name, cube: req.body.cube, changes: result.changes })
        res.json({ written: result.written })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.message
        res.status(e.conflicts ? 409 : 400).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail), conflicts: e.conflicts })
    }
})

// History from a Lens preview — the same activity log and the same rules as the
// Lens app's /api/lens/:name/history: recent saves and runs through this saved
// Lens on this server; a match slice is checked as the IDE user first.
app.get('/api/lens/history', async (req, res) => {
    try {
        const server = req.query.server, name = req.query.lens
        if (!name || typeof name !== 'string') throw new Error('lens is required')
        const doc = await lensStore.readLens(server, name, { ideToken: req.ideToken })
        let match = {}
        try { match = JSON.parse(String(req.query.match ?? '{}')) } catch { throw new Error('match must be JSON') }
        if (!match || typeof match !== 'object' || Array.isArray(match)) throw new Error('match must be { dimension: element }')
        if (Object.keys(match).length) {
            const cube = lensBridge.lensWrites(doc)[0]
            if (!cube) throw new Error('a history slice needs a Lens that changes data (lens-writes)')
            const client = makeClient(server, req.ideToken)
            const q = s => String(s).replace(/]/g, ']]')
            for (const [dim, el] of Object.entries(match)) {
                await client.executeMDX(`SELECT {} ON 0, {[${q(dim)}].[${q(dim)}].[${q(el)}]} ON 1 FROM [${q(cube)}]`)
                    .catch(() => { throw new Error(`you can't see ${dim} "${el}"`) })
            }
        }
        const skip = String(req.query.skip ?? '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 20)
        res.json(readLensActivity({ server, lens: doc.name, match, skip, limit: Math.min(Number(req.query.limit) || 30, 100) }))
    } catch (e) { res.status(400).json({ error: e.message }) }
})

// Who the IDE user is on this server, and their TM1 groups (Lens.whoami()).
app.get('/api/lens/whoami', async (req, res) => {
    try {
        const d = await makeClient(req.query.server, req.ideToken).get('ActiveUser', { '$expand': 'Groups($select=Name)' })
        res.json({ user: d?.Name ?? req.user, groups: (d?.Groups ?? []).map(g => g.Name) })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Action buttons from a Lens preview — the process must be declared by the
// saved Lens; parameters checked; runs as the IDE user; logged.
app.post('/api/lens/run-process', async (req, res) => {
    const server = req.query.server, name = req.body?.lens, process = req.body?.process, params = req.body?.params ?? {}
    try {
        if (!gateReadOnly(res, server)) return
        if (!name || typeof name !== 'string') throw new Error('lens is required')
        const doc = await lensStore.readLens(server, name, { ideToken: req.ideToken })
        const result = await lensBridge.runProcess(makeClient(server, req.ideToken), { process, params, allowedProcesses: lensBridge.lensRuns(doc), user: req.user })
        logLensRun({ server, app: 'ide', user: req.user, lens: doc.name, process, params, status: result.status, message: result.message, detail: result.detail })
        res.json(result)
    } catch (e) {
        if (e.status) logLensRun({ server, app: 'ide', user: req.user, lens: name, process, params, status: e.status, message: e.message, detail: e.detail })
        const detail = e.response?.data?.error?.message ?? e.message
        res.status(e.status ? 422 : 400).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail), status: e.status })
    }
})

// A cell's story for a Lens's right-click menu — why (rule trace), who changed it
// (transaction log), notes — read as the IDE user; adding a note needs the saved
// Lens to declare the cube (lens-notes / lens-writes) and is logged.
for (const [route, fn] of [['cell-trace', (c, b) => lensBridge.cellTrace(c, b.cube, b.coordinates)],
                           ['cell-log',   (c, b) => lensBridge.cellLog(c, b.cube, b.coordinates, b.top)],
                           ['cell-notes', (c, b) => lensBridge.cellNotes(c, b.cube, b.coordinates)]]) {
    app.post(`/api/lens/${route}`, async (req, res) => {
        try { res.json(await fn(makeClient(req.query.server, req.ideToken), req.body ?? {})) }
        catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
    })
}
app.post('/api/lens/add-note', async (req, res) => {
    try {
        const server = req.query.server
        if (!gateReadOnly(res, server)) return
        const name = req.body?.lens
        if (!name || typeof name !== 'string') throw new Error('lens is required')
        const doc = await lensStore.readLens(server, name, { ideToken: req.ideToken })
        const note = await lensBridge.addCellNote(makeClient(server, req.ideToken), { cube: req.body?.cube, coordinates: req.body?.coordinates, text: req.body?.text, allowedCubes: lensBridge.lensNotes(doc) })
        logLensNote({ server, app: 'ide', user: req.user, lens: doc.name, ...note })
        res.json({ ok: true })
    } catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
})

// Lens.pivot: a dimension's hierarchies (main + any ALT H), for the hierarchy choice.
app.get('/api/lens/hierarchies', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await lensBridge.hierarchies(client, req.query.dimension))
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.message
        res.status(400).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// Lens.pivot: one dimension's element tree, read as the IDE user.
app.get('/api/lens/element-tree', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await lensBridge.elementTree(client, req.query.dimension, req.query.hierarchy))
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.message
        res.status(400).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.get('/api/lens/meta', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await lensBridge.getMeta(client, req.query.cube))
    } catch (e) { fail(res, e) }
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
