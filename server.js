'use strict'

require('dotenv').config({ path: require('path').join(__dirname, '.env') })

const express   = require('express')
const path      = require('path')
const fs        = require('fs')
const ai        = require('./core/ai/registry')
const obfuscate = require('./core/ai/obfuscate')
const { makeClient, makeClientWithCredentials, needsServerLogin, isDirectServer, isPawNativeServer, probeAuthMethod, listServers, listServersWithFlags, isSimple, simpleSource, getLoginServer } = require('./core/adapter-registry')
const { loadConnections, saveConnections, getConnection, executeQuery, testConnection, getSchema, loadQueries, saveQueries } = require('./core/sql-client')
const { createSession, createDirectSession, createLocalSession, attachPawSession, getSessionUser, touchSession, invalidateSession, getCachedPawSession, getCSRF, PAW_HOST, setServerCredentials, getServerCredentials, clearServerCredentials, getServerStatus, listServerEntries, getSessionCredentials } = require('./core/paw-connect')
const cl = require('./core/change-log')
const { canManageSession } = require('./core/session_access')
// Persisted Git token (never returned to the client) — env wins, else the secrets file.
const gitSecrets = require('./core/git-secrets')
const { odataKey } = require('./core/odata-key')
if (!process.env.TM1_GIT_TOKEN && gitSecrets.getToken()) process.env.TM1_GIT_TOKEN = gitSecrets.getToken()
const lensStore = require('./core/lens-store')
const { logLensWrite, logLensRun, logLensNote, readLensActivity } = require('./core/lens-activity-log')
const lensBridge = require('./core/lens-bridge')
const { readOnlyRefusal } = require('./core/readonly')
const { createSaveDataAllRoute, isAdminGroups } = require('./core/save-data-all')
const { createAdminGate } = require('./core/admin_gate')
const { createProvisionUserRoute } = require('./core/user_admin')
const { createCancelJobRoute } = require('./core/admin_routes')
const { createStartSessionRoute } = require('./core/session_routes')
const { createCatalogOverrideRoutes } = require('./core/catalog_overrides')
const { setSimpleInModes } = require('./core/ide-modes')
const { createHttp } = require('./routes/_http')
const { createServerHelpers } = require('./core/server_helpers')

const http = createHttp({
    cl, isSimple, isAdminGroups, makeClient, canManageSession, readOnlyRefusal, createAdminGate,
})
const {
    mayManageSession, gateReadOnly, gateWrite, fail, isTm1Admin, requireTm1Admin,
    scanIdentity, isLoopbackReq, sendMaintenanceError, NEEDS_LOGIN_RE,
} = http

const helpers = createServerHelpers({
    cl, makeClientWithCredentials, isDirectServer, PAW_LOGIN_SERVER: process.env.PAW_LOGIN_SERVER,
    createCatalogOverrideRoutes, gateReadOnly, requireTm1Admin,
})
const {
    loginRateLimit, SAMPLE_PASSWORD_WARNING, isSampleLogin, SQL_PASSWORD_MASK, _GI, _GITOK,
    catalogRoutes, LENS_CATALOGUE, txLogSearches, lensUsageCache, userServer,
    closeServerSession, setupBlankAdmin, sendSetupError, logAttributeValue, joinContinuations,
    extractMembersFromExpression, parseDbRefs, processCode, summaryPrompt,
} = helpers

const { getCubeDataSources, getViewSourceUsage, getProcessFacts, listProcessSummaries, invalidate: invalidateCubeSources } = require('./core/cube-data-sources')
const { buildCubeMapModel } = require('./core/cubemap')
const { parseRuleLens } = require('./core/rule-lens')
const processSummaries = require('./core/process-summaries')
const { seed: deploySeed } = require('./tools/tm1deploy/src/snapshot')
const { loadBaseline: deployLoadBaseline } = require('./tools/tm1deploy/src/diff')

const FORGE_PATH = path.join(__dirname, 'config', 'forge.json')
const PAW_LOGIN_SERVER = process.env.PAW_LOGIN_SERVER

const PORT = process.env.PORT || 8083
const HOST = process.env.HOST || '127.0.0.1'

const IDE_LOGIN    = String(process.env.IDE_LOGIN || 'auto').toLowerCase()
const LOCAL_ONLY   = ['127.0.0.1', 'localhost', '::1'].includes(HOST)
const LOGIN_REQUIRED = IDE_LOGIN === 'always' || !LOCAL_ONLY

function createApp() {
const app  = express()

app.use(express.json({ limit: '10mb' }))
app.use(express.static(path.join(__dirname, 'static'), {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store')
    }
}))

// ── Auth ──────────────────────────────────────────────────────────────────────

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

// No API response may be cached by the browser — the IDE serves live model state
// and lens HTML; a heuristic-cached GET would show stale content after an edit.
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
})

const routeDeps = { FORGE_PATH, LENS_CATALOGUE, LOCAL_ONLY, LOGIN_REQUIRED, PAW_HOST, PAW_LOGIN_SERVER, SAMPLE_PASSWORD_WARNING, SQL_PASSWORD_MASK, _GI, _GITOK, ai, attachPawSession, buildCubeMapModel, catalogRoutes, cl, clearServerCredentials, closeServerSession, createCancelJobRoute, createDirectSession, createLocalSession, createProvisionUserRoute, createSaveDataAllRoute, createSession, createStartSessionRoute, deployLoadBaseline, deploySeed, executeQuery, express, extractMembersFromExpression, fail, fs, gateReadOnly, gateWrite, getCSRF, getCachedPawSession, getConnection, getCubeDataSources, getLoginServer, getProcessFacts, getSchema, getServerCredentials, getServerStatus, getSessionCredentials, getViewSourceUsage, gitSecrets, invalidateCubeSources, invalidateSession, isAdminGroups, isDirectServer, isLoopbackReq, isPawNativeServer, isSampleLogin, isTm1Admin, joinContinuations, lensBridge, lensStore, lensUsageCache, listProcessSummaries, listServerEntries, listServers, listServersWithFlags, loadConnections, loadQueries, logAttributeValue, logLensNote, logLensRun, logLensWrite, loginRateLimit, makeClient, makeClientWithCredentials, mayManageSession, obfuscate, odataKey, parseDbRefs, parseRuleLens, path, probeAuthMethod, processCode, processSummaries, readLensActivity, requireTm1Admin, saveConnections, saveQueries, scanIdentity, sendMaintenanceError, sendSetupError, setServerCredentials, setSimpleInModes, setupBlankAdmin, simpleSource, summaryPrompt, testConnection, txLogSearches, userServer }
for (const file of ['workspace','search','sql','ai','lenses','views','processes','cubes','dimensions','changesets','deploy','admin','auth'])
    require(`./routes/${file}`).register(app, routeDeps)

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
