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
const { createProvisionUserRoute } = require('./core/user_admin')
const { createCancelJobRoute } = require('./core/admin_routes')
const { createStartSessionRoute } = require('./core/session_routes')
const { createCatalogOverrideRoutes } = require('./core/catalog_overrides')
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

const PORT = process.env.PORT || 8083
// TM1 IDE is a local single-user developer tool — bind loopback only (see SECURITY.md).
// Override with HOST=0.0.0.0 only if you deliberately need LAN access and understand
// that the browser<->server leg is then plaintext HTTP with no transport security.
const HOST = process.env.HOST || '127.0.0.1'

const IDE_LOGIN    = String(process.env.IDE_LOGIN || 'auto').toLowerCase()
const LOCAL_ONLY   = ['127.0.0.1', 'localhost', '::1'].includes(HOST)
const LOGIN_REQUIRED = IDE_LOGIN === 'always' || !LOCAL_ONLY

function createApp() {
const app  = express()

// ── IDE sign-in (Architect model) ─────────────────────────────────────────────
// IDE_LOGIN=auto (default): no IDE login when the IDE listens on this machine only
//   — open it, pick a server, sign in to that server. When HOST exposes it to the
//   network, an IDE sign-in (through any server) is required: otherwise anyone on
//   the network could reach stored SQL logins, the AI key and change history.
// IDE_LOGIN=always: require the IDE sign-in even when local (e.g. a shared PC).
// There is deliberately no "never" for a network-exposed IDE.
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




















// ── Servers ───────────────────────────────────────────────────────────────────
app.get('/api/servers', (req, res) => {
    try { res.json(listServersWithFlags()) }
    catch (e) { fail(res, e) }
})

// ── Cubes ─────────────────────────────────────────────────────────────────────


// ── Dimensions ────────────────────────────────────────────────────────────────


// Bulk import: rows = [{ name, type, parent, weight }]


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












// ── Processes ─────────────────────────────────────────────────────────────────




// ── Chores ────────────────────────────────────────────────────────────────────








// ── Rules ─────────────────────────────────────────────────────────────────────






// ── Process detail + execute ──────────────────────────────────────────────────


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











// ── Cube dimensions ───────────────────────────────────────────────────────────


// ── Dimension attributes ──────────────────────────────────────────────────────






// ── Attribute grid (all elements × all attrs in one response) ─────────────────












// ── Views ─────────────────────────────────────────────────────────────────────












// ── Elements ──────────────────────────────────────────────────────────────────








// ── Dimension element + edge write ───────────────────────────────────────────








// Place an existing element under a parent at a given position (drag-and-drop).






















// Alternate Hierarchies — what a hierarchy is (default / alternate / TM1's Leaves) and which
// processes build it; an element's parents in each hierarchy; build one from an attribute.








// ── Search index — all rules + all process code in one call ──────────────────
// Scope: Rules + TI, used by Find & Replace. The Explorer's Ctrl+Shift+F quick
// search is deliberately TI-only (see /api/processes/search and FEATURES.md).


// ── Subsets ───────────────────────────────────────────────────────────────────










// Get distinct attribute values for a dimension (samples up to 500 elements)








// ── View → axis config (execute view, return cellset + axis dim names) ───────
// Extract member names from an inline Subset Expression like {[Dim].[Hier].[M1], [Dim].[Hier].[M2]}
function extractMembersFromExpression(expr) {
    if (!expr) return null
    const trimmed = expr.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
    const matches = [...trimmed.matchAll(/\[[^\]]+\]\.\[[^\]]+\]\.\[([^\]]+)\]/g)]
    return matches.length > 0 ? matches.map(m => m[1]) : null
}



// ── Native View Execute (with suppression toggle) ────────────────────────────
// ── MDX Execute ──────────────────────────────────────────────────────────────


// ── Rules lineage ─────────────────────────────────────────────────────────────
function parseDbRefs(rules) {
    const refs = new Set()
    const re = /\bDB[S]?\s*\(\s*'([^']+)'/gi
    let m
    while ((m = re.exec(rules)) !== null) refs.add(m[1])
    return [...refs]
}





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


// ── Chore execute / activate / deactivate / create ────────────────────────────


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

app.post('/api/job/cancel', createCancelJobRoute({ makeClient, requireTm1Admin }))

// ── Process error logs ────────────────────────────────────────────────────────


// ── Cell calculation trace ────────────────────────────────────────────────────






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
app.post('/api/users/provision', createProvisionUserRoute({ makeClient, gateReadOnly, requireTm1Admin, userServer, fail }))

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


// ── Period Builder ────────────────────────────────────────────────────────────
// Saves 3 TI processes to the target TM1 server.
// Request body: { server, processes: [{name, prolog, metadata, data, epilog, parameters}] }






// ── SQL Editor ───────────────────────────────────────────────────────────────

const SQL_PASSWORD_MASK = '••••••••'























// ── Current user ──────────────────────────────────────────────────────────────
// ── Cell write ────────────────────────────────────────────────────────────────
// Body: { server, cube, dims: [{ dim, element }, ...], value }


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


// ── Assertions management ───────────────────────────────────────────────────
// List, add, update, remove and run the model's stored assertions. Writes are
// gated on read-only posture like other model edits.







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
        const dir = path.join(__dirname, 'data', 'archives')
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
        const file = path.join(__dirname, 'data', 'archives', `${req.params.id}.json`)
        if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
        res.json(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Admin: function catalog overrides — compat, user additions, deletions
const CATALOG_OVERRIDES_PATH = path.join(__dirname, 'config', 'function-catalog-overrides.json')
const catalogRoutes = createCatalogOverrideRoutes({
    filePath: CATALOG_OVERRIDES_PATH,
    requireTm1Admin,
    gateReadOnly,
    serverOf: req => req.query.server ?? req.body?.server ?? PAW_LOGIN_SERVER,
})
app.get('/api/admin/catalog-overrides', catalogRoutes.get)
app.put('/api/admin/catalog-overrides', catalogRoutes.put)

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







// Rule lens — a cube's rules broken into target areas, measures, DB sources and feeders.


// Where a cube's data comes from — writers / readers / rule dependencies (Rules editor strip)




// ── Lenses ────────────────────────────────────────────────────────────────────
// A Lens lives in the model it belongs to: one document per Lens under
// Applications/Governance/Lenses (core/lens_store.js → core/model-store.js),
// holding the HTML and its details. Nothing is stored locally. Every call runs as
// the signed-in user (req.ideToken), never the MCP's builder path. Saves and
// deletes are model changes: they need a writable server and an open change set,
// and are recorded in it.

// Lens patterns — reference Lenses to start a new one from (a copy, never a link).





// Which processes the Lenses run (their declared lens-runs), as { process: [lens, ...] } — so the
// IDE can mark front-end actions without anyone tagging them. Cached briefly per user and server.
const lensUsageCache = new Map()








const LENS_CATALOGUE = JSON.stringify(require('./shared/lens-components.json'), null, 1)


// ── Lens bridge (runs as the viewing user) ───────────────────────────────────





// Write-back from a Lens preview — same checks as the Lens app (declared cubes,
// numbers only, no calculated cells, nothing changed since it loaded), as the
// IDE user. Data entry, not a model change, so no change set is needed; a
// read-only (PROD-posture) server refuses it here.


// History from a Lens preview — the same activity log and the same rules as the
// Lens app's /api/lens/:name/history: recent saves and runs through this saved
// Lens on this server; a match slice is checked as the IDE user first.


// Who the IDE user is on this server, and their TM1 groups (Lens.whoami()).


// Action buttons from a Lens preview — the process must be declared by the
// saved Lens; parameters checked; runs as the IDE user; logged.


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


// Lens.pivot: a dimension's hierarchies (main + any ALT H), for the hierarchy choice.


// Lens.pivot: one dimension's element tree, read as the IDE user.






const routeDeps = { FORGE_PATH, LENS_CATALOGUE, LOCAL_ONLY, LOGIN_REQUIRED, PAW_HOST, PAW_LOGIN_SERVER, SAMPLE_PASSWORD_WARNING, SQL_PASSWORD_MASK, _GI, _GITOK, ai, attachPawSession, buildCubeMapModel, catalogRoutes, cl, clearServerCredentials, closeServerSession, createCancelJobRoute, createDirectSession, createLocalSession, createProvisionUserRoute, createSaveDataAllRoute, createSession, createStartSessionRoute, deployLoadBaseline, deploySeed, executeQuery, express, extractMembersFromExpression, fail, fs, gateReadOnly, gateWrite, getCSRF, getCachedPawSession, getConnection, getCubeDataSources, getLoginServer, getProcessFacts, getSchema, getServerCredentials, getServerStatus, getSessionCredentials, getViewSourceUsage, gitSecrets, invalidateCubeSources, invalidateSession, isAdminGroups, isDirectServer, isLoopbackReq, isPawNativeServer, isSampleLogin, isTm1Admin, joinContinuations, lensBridge, lensStore, lensUsageCache, listProcessSummaries, listServerEntries, listServers, listServersWithFlags, loadConnections, loadQueries, logAttributeValue, logLensNote, logLensRun, logLensWrite, loginRateLimit, makeClient, makeClientWithCredentials, mayManageSession, obfuscate, odataKey, parseDbRefs, parseRuleLens, path, probeAuthMethod, processCode, processSummaries, readLensActivity, requireTm1Admin, saveConnections, saveQueries, scanIdentity, sendMaintenanceError, sendSetupError, setServerCredentials, setSimpleInModes, setupBlankAdmin, simpleSource, summaryPrompt, testConnection, txLogSearches, userServer }
require('./routes/workspace').register(app, routeDeps)

require('./routes/search').register(app, routeDeps)

require('./routes/sql').register(app, routeDeps)

require('./routes/ai').register(app, routeDeps)

require('./routes/lenses').register(app, routeDeps)

require('./routes/views').register(app, routeDeps)

require('./routes/processes').register(app, routeDeps)

require('./routes/cubes').register(app, routeDeps)

require('./routes/dimensions').register(app, routeDeps)

require('./routes/changesets').register(app, routeDeps)

app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'))
})

return app
}

const app = createApp()

if (require.main === module) {
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
}

module.exports = { app, createApp }
