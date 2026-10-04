'use strict'

const fs    = require('fs')
const path  = require('path')
const axios = require('axios')
const { PawNativeAdapter }  = require('./adapters/paw_native')
const { DirectV11Adapter, httpsAgentFor, TM1AuthRejected }  = require('./adapters/direct_v11')
const { PawOAuth2Adapter }  = require('./adapters/paw_oauth2')
const { getServerCredentials, markServerRejected, hasPawSession } = require('./paw_connect')

const SERVERS_PATH = path.join(__dirname, '..', 'config', 'servers.json')

// ── Config ────────────────────────────────────────────────────────────────────

// Re-read on change (not require(), which caches for the life of the process) so
// edits to servers.json — a new server, a TLS setting — apply without a restart.
// A file saved mid-edit with broken JSON keeps the last good config rather than
// failing every request.
let _cfgCache = { mtimeMs: -1, cfg: null }

function _readServersJson() {
    const { mtimeMs } = fs.statSync(SERVERS_PATH)
    if (mtimeMs === _cfgCache.mtimeMs) return _cfgCache.cfg
    try {
        _cfgCache = { mtimeMs, cfg: JSON.parse(fs.readFileSync(SERVERS_PATH, 'utf8')) }
    } catch (e) {
        if (!_cfgCache.cfg) throw e
        console.warn(`⚠  servers.json is not valid JSON (${e.message}) — keeping the last good config.`)
        _cfgCache.mtimeMs = mtimeMs   // warn once per bad save, not on every request
    }
    return _cfgCache.cfg
}

function _loadConfig() {
    const cfg = _readServersJson()
    if (Array.isArray(cfg)) {
        return {
            adminHosts:      [],
            connections:     [{ name: 'default', adapter: 'paw-native', pawHost: process.env.PAW_HOST, servers: cfg.map(s => s.name) }],
            readOnlyServers: [],
        }
    }
    return { adminHosts: cfg.adminHosts ?? [], connections: cfg.connections ?? [], readOnlyServers: cfg.readOnlyServers ?? [] }
}

// ── TLS ───────────────────────────────────────────────────────────────────────
// Per-server TLS policy from servers.json:
//   "tls": "verify" (default) | "chain-only" | "insecure"
//   "tlsCaFile": <path>  — extra CA/cert to trust (verify + chain-only)
// Legacy "tlsInsecure": true still maps to "insecure".
function _tlsFor(cfg) {
    const mode = cfg?.tls ?? (cfg?.tlsInsecure === true ? 'insecure' : 'verify')
    return { mode, caFile: cfg?.tlsCaFile ?? null }
}

// ── Admin host URL resolution ─────────────────────────────────────────────────

const _urlCache = new Map()  // `${adminHostUrl}::${serverNameLower}` → resolved base URL

async function _resolveServerUrl(adminHost, serverName) {
    const key = `${adminHost.url}::${serverName.toLowerCase()}`
    if (_urlCache.has(key)) return _urlCache.get(key)

    const reqOpts = { timeout: 10_000 }
    if (adminHost.url?.startsWith('https')) reqOpts.httpsAgent = httpsAgentFor(_tlsFor(adminHost)).agent
    const resp    = await axios.get(`${adminHost.url}/api/v1/Servers`, reqOpts)
    const servers = resp.data?.value ?? []
    const match   = servers.find(s => s.Name.toLowerCase() === serverName.toLowerCase())
    if (!match) throw new Error(`Server "${serverName}" not found on admin host ${adminHost.url}`)

    const ip       = new URL(adminHost.url).hostname
    const protocol = match.UsingSSL ? 'https' : 'http'
    const url      = `${protocol}://${ip}:${match.HTTPPortNumber}`
    _urlCache.set(key, url)
    return url
}

// ── Lookup helpers ────────────────────────────────────────────────────────────

function _findAdminHost(serverName, adminHosts) {
    const lower = serverName.toLowerCase()
    for (const h of adminHosts) {
        if ((h.servers ?? []).some(s => s.toLowerCase() === lower)) return h
    }
    return null
}

function _findConnection(serverName, connections) {
    const lower = serverName.toLowerCase()
    for (const conn of connections) {
        if ((conn.servers ?? [conn.name]).some(s => s.toLowerCase() === lower)) return conn
    }
    return null
}

// paw-oauth2 tokens are per-connection (machine credential, not per-user)
const _oauth2Cache = new Map()

// ── Per-server logins ─────────────────────────────────────────────────────────
// Direct connections sign in to each TM1 server separately. A user session with
// no login for a server gets NeedsServerLogin — never another server's password.

class NeedsServerLogin extends Error {
    constructor(serverName, rejected = false) {
        super(rejected
            ? `TM1 rejected the login for server "${serverName}" — sign in to it again`
            : `Sign in to server "${serverName}" to use it`)
        this.code = 'NEEDS_SERVER_LOGIN'
        this.server = serverName
        this.rejected = rejected
    }
}

// Service logins (no user session — the MCP, internal jobs): per-server
// credentials from servers.json, falling back to the admin host / connection.
//   "serverCredentials": { "MyServer": { "username": "...", "password": "..." } }
// One TM1 session per service login; a rejected one fails fast until the
// credentials in servers.json change (never retried against TM1).
const _serviceState = new Map()   // `${serverLower}::${username}::${password}` → { cookie, rejected }

function _serviceCredentials(serverName, hostOrConn) {
    const cfg = _readServersJson()
    const per = Array.isArray(cfg) ? null : cfg.serverCredentials ?? null
    const hit = per && Object.entries(per).find(([k]) => k.toLowerCase() === serverName.toLowerCase())?.[1]
    if (hit?.username) return { username: hit.username, password: hit.password ?? '' }
    return { username: hostOrConn.username, password: hostOrConn.password ?? '' }
}

function _serviceStateFor(serverName, creds) {
    const key = `${serverName.toLowerCase()}::${creds.username}::${creds.password}`
    let st = _serviceState.get(key)
    if (!st) { st = {}; _serviceState.set(key, st) }
    if (st.rejected) throw new NeedsServerLogin(serverName, true)
    return st
}

// The direct-connection config (admin host or connection) for a server, or null
// when the server is reached through PAW (where PAW owns the login).
function _directConfig(serverName) {
    const { adminHosts, connections } = _loadConfig()
    const adminHost = _findAdminHost(serverName, adminHosts)
    if (adminHost && (adminHost.adapter ?? 'direct-v11') === 'direct-v11') return { cfg: adminHost }
    const conn = _findConnection(serverName, connections)
    if (conn && conn.adapter === 'direct-v11') return { cfg: conn }
    return null
}

function _directAdapter(serverName, cfg, creds, state, onRejected) {
    return new DirectV11Adapter({
        urlResolver:  () => _resolveServerUrl(cfg, serverName),
        serverName,
        username:     creds.username,
        password:     creds.password,
        camNamespace: creds.namespace ?? cfg.camNamespace ?? '',
        tls:          _tlsFor(cfg),
        state,
        onRejected,
    })
}

// Is this server reached directly (so it has its own per-server login)?
function isDirectServer(serverName) {
    return !!(serverName && _directConfig(serverName))
}

// Does this user session need to sign in to this server before using it?
// false for PAW-routed servers (PAW owns the login) and service calls (no token).
function needsServerLogin(serverName, ideToken) {
    if (!serverName || !ideToken) return false
    if (_directConfig(serverName)) return !getServerCredentials(ideToken, serverName)
    // PAW-native: one PAW sign-in covers every server behind that PAW.
    if (isPawNativeServer(serverName)) return !hasPawSession(ideToken)
    return false   // paw-oauth2: machine credential, no user sign-in
}

function isPawNativeServer(serverName) {
    if (!serverName || _directConfig(serverName)) return false
    const conn = _findConnection(serverName, _loadConfig().connections)
    return (conn?.adapter ?? 'paw-native') === 'paw-native'
}

// ── Adapter factory ───────────────────────────────────────────────────────────
function getAdapter(serverName, ideToken) {
    const direct = _directConfig(serverName)
    if (direct) {
        if (ideToken) {
            const creds = getServerCredentials(ideToken, serverName)
            if (!creds) throw new NeedsServerLogin(serverName)
            return _directAdapter(serverName, direct.cfg, creds, creds.state,
                () => markServerRejected(ideToken, serverName))
        }
        const creds = _serviceCredentials(serverName, direct.cfg)
        const state = _serviceStateFor(serverName, creds)
        return _directAdapter(serverName, direct.cfg, creds, state, () => { state.rejected = true; state.cookie = null })
    }
    const { connections } = _loadConfig()
    const conn = _findConnection(serverName, connections)
    const type = conn?.adapter ?? 'paw-native'
    if (type === 'paw-native') {
        return new PawNativeAdapter({ pawHost: conn?.pawHost ?? process.env.PAW_HOST, serverName, token: ideToken })
    }
    if (type === 'paw-oauth2') {
        const key = `${conn.name}:${serverName}`
        if (!_oauth2Cache.has(key)) {
            _oauth2Cache.set(key, new PawOAuth2Adapter({ pawHost: conn.pawHost, serverName, clientId: conn.client_id, clientSecret: conn.client_secret }))
        }
        return _oauth2Cache.get(key)
    }
    throw new Error(`Unknown adapter type: ${type}`)
}

// ── Sign-in method detection ──────────────────────────────────────────────────
// Ask a direct TM1 server how it wants to be signed in to, WITHOUT credentials:
// the 401 answer's WWW-Authenticate line lists the schemes it accepts. No
// username is sent, so this never counts as a failed login.
//   method: 'native' (Basic: TM1 security or LDAP check) | 'cam' | 'integrated'
//         | 'native-or-windows' (mode 2) | 'paw' | 'unknown'
async function probeAuthMethod(serverName) {
    const direct = _directConfig(serverName)
    if (!direct) return { server: serverName, method: isPawNativeServer(serverName) ? 'paw' : 'unknown' }
    const url = await _resolveServerUrl(direct.cfg, serverName)
    const opts = { timeout: 10_000, validateStatus: () => true }
    if (url.startsWith('https')) opts.httpsAgent = httpsAgentFor(_tlsFor(direct.cfg)).agent
    const r = await axios.get(`${url}/api/v1/Configuration/ProductVersion`, opts)
    const raw = [].concat(r.headers['www-authenticate'] ?? []).join(', ')
    const has = (re) => re.test(raw)
    const cam = has(/cam/i), win = has(/negotiate|ntlm/i), basic = has(/basic/i)
    const method = cam ? 'cam' : win && basic ? 'native-or-windows' : win ? 'integrated' : basic ? 'native' : 'unknown'
    return {
        server: serverName,
        url,
        status: r.status,
        method,
        wwwAuthenticate: raw,
        camGateway: (raw.match(/https?:\/\/[^\s",]+/) ?? [null])[0],
        camNamespace: direct.cfg.camNamespace ?? null,
        tls: url.startsWith('https') ? _tlsFor(direct.cfg).mode : 'none (http)',
    }
}

// A client for a direct server with explicit credentials and a fresh TM1 session
// — used to test a login before storing it, and by "Set up new server".
// Returns null for PAW-routed servers.
function makeClientWithCredentials(serverName, creds, state = {}) {
    const direct = _directConfig(serverName)
    if (!direct) return null
    const { TM1Client } = require('./tm1_client')
    return new TM1Client(serverName, _directAdapter(serverName, direct.cfg, creds, state, null))
}

function makeClient(serverName, ideToken) {
    const { TM1Client } = require('./tm1_client')
    return new TM1Client(serverName, getAdapter(serverName, ideToken))
}

// ── Login helpers (used by server.js login route) ─────────────────────────────

function getDefaultAdapterType() {
    const { adminHosts, connections } = _loadConfig()
    if (adminHosts.length)  return adminHosts[0].adapter  ?? 'direct-v11'
    if (connections.length) return connections[0].adapter ?? 'paw-native'
    return 'paw-native'
}

function getLoginServer() {
    const { adminHosts, connections } = _loadConfig()
    if (adminHosts.length)  return adminHosts[0].loginServer  ?? adminHosts[0].servers?.[0]  ?? null
    if (connections.length) return connections[0].loginServer ?? connections[0].servers?.[0] ?? null
    return null
}

// ── Server list ───────────────────────────────────────────────────────────────

function listServers() {
    try {
        const { adminHosts, connections } = _loadConfig()
        return [
            ...adminHosts.flatMap(h => h.servers ?? []),
            ...connections.flatMap(c => c.servers ?? [c.name]),
        ]
    } catch { return [] }
}

// Read-only posture (IMPROVEMENTS 4.2): a server can be browse-only while DEV
// stays writable. Marked via config/servers.json:
//   "readOnlyServers": ["PROD_TM1", ...]      — explicit per-server list
//   a connection/adminHost with "readOnly": true makes every server it owns read-only
function isReadOnly(serverName) {
    if (!serverName) return false
    try {
        const cfg = _loadConfig()
        const explicit = cfg.readOnlyServers ?? []
        if (explicit.some(s => String(s).toLowerCase() === serverName.toLowerCase())) return true
        const inHost = _findAdminHost(serverName, cfg.adminHosts ?? [])
        if (inHost?.readOnly === true) return true
        const conn = _findConnection(serverName, cfg.connections ?? [])
        if (conn?.readOnly === true) return true
    } catch {}
    return false
}

// Server list enriched with the read-only flag for the UI indicator.
function listServersWithFlags() {
    return listServers().map(name => ({ name, readOnly: isReadOnly(name) }))
}

module.exports = { getAdapter, makeClient, makeClientWithCredentials, needsServerLogin, isDirectServer, isPawNativeServer, probeAuthMethod, NeedsServerLogin, TM1AuthRejected, listServers, listServersWithFlags, isReadOnly, getDefaultAdapterType, getLoginServer }
