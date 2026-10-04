'use strict'

const axios   = require('axios')
const { wrapper }   = require('axios-cookiejar-support')
const { CookieJar } = require('tough-cookie')
const { randomUUID } = require('crypto')

const PAW_HOST   = process.env.PAW_HOST
const SESSION_TTL = 600_000  // 10 minutes — PAW session-cookie refresh interval (paw-native only)

// Idle lifetime of an IDE token. Every authenticated /api request bumps lastSeen;
// a token unused for this long is dropped and the user must log in again. This is
// the only expiry that applies in direct-v11 mode (where SESSION_TTL/getCachedPawSession
// never run). 12h keeps a normal working day seamless while killing a stale token overnight.
const IDLE_TTL = 12 * 3_600_000

// Map<token, { username, password, session, expiry, lastSeen, servers }>
// `servers` holds per-server logins (direct connections): Map<serverLower, { username, password, status, state }>
//   status: 'ok' | 'rejected' — a rejected login's password is dropped and never retried.
//   state:  adapter state for that server (e.g. the TM1SessionId cookie) — one TM1 session per server.
const _sessions = new Map()

async function _login(username, password) {
    const jar = new CookieJar()
    const s   = wrapper(axios.create({ jar, withCredentials: true, timeout: 120_000 }))

    await s.post(`${PAW_HOST}/login/form/`,
        new URLSearchParams({ username, password, mode: 'basic' }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )

    const csrf = (await jar.getCookies(PAW_HOST))
        .find(c => c.key === 'ba-sso-csrf')?.value ?? ''

    if (!csrf) throw new Error('PAW login failed — ba-sso-csrf cookie not set')

    s._jar = jar
    return s
}

async function createSession(username, password) {
    const session = await _login(username, password)
    const token   = randomUUID()
    _sessions.set(token, { username, password, session, expiry: Date.now() + SESSION_TTL, lastSeen: Date.now() })
    return token
}

async function createDirectSession(username, password) {
    const token = randomUUID()
    _sessions.set(token, { username, password, session: null, expiry: Date.now() + SESSION_TTL, lastSeen: Date.now(), servers: new Map() })
    return token
}

// A session with no IDE login (Architect model, local-only IDE). It holds only
// per-server logins; there is no "current login" to reuse.
async function createLocalSession() {
    const token = randomUUID()
    _sessions.set(token, { username: 'local', password: null, local: true, session: null, expiry: Date.now() + SESSION_TTL, lastSeen: Date.now(), servers: new Map() })
    return token
}

// Sign this IDE session in to PAW (paw-native servers): one PAW sign-in covers all its servers.
async function attachPawSession(token, username, password) {
    const entry = _sessions.get(token)
    if (!entry) throw new Error('Invalid or expired session — please log in again')
    entry.session  = await _login(username, password)
    entry.pawUser  = username
    entry.pawPass  = password
    entry.expiry   = Date.now() + SESSION_TTL
}

function hasPawSession(token) {
    return !!_sessions.get(token)?.session
}

// ── Per-server logins ─────────────────────────────────────────────────────────
// Every TM1 server has its own login. Credentials for one server are never used
// for another — a server with no login here needs the user to sign in to it.

function _serverEntry(token, server) {
    const entry = _sessions.get(token)
    if (!entry || !server) return null
    entry.servers ??= new Map()
    return entry.servers.get(String(server).toLowerCase()) ?? null
}

function setServerCredentials(token, server, { username, password, namespace = null }, state = null) {
    const entry = _sessions.get(token)
    if (!entry) throw new Error('Invalid or expired session — please log in again')
    entry.servers ??= new Map()
    const key = String(server).toLowerCase()
    const prev = entry.servers.get(key)
    // Keep the TM1 session (cookie) only when the identity is unchanged.
    const keep = state ?? (prev && prev.username === username ? prev.state : {})
    entry.servers.set(key, { username, password, namespace, status: 'ok', state: keep })
}

// Credentials for a server, or null when the user hasn't signed in to it (or it rejected them).
function getServerCredentials(token, server) {
    const s = _serverEntry(token, server)
    return s && s.status === 'ok' ? { username: s.username, password: s.password, namespace: s.namespace ?? null, state: s.state } : null
}

// TM1 rejected the stored credentials: drop the password so it is never retried.
function markServerRejected(token, server) {
    const s = _serverEntry(token, server)
    if (!s) return
    s.status = 'rejected'
    s.password = null
    s.state = {}
}

function clearServerCredentials(token, server) {
    const entry = _sessions.get(token)
    if (!entry?.servers) return null
    const key = String(server).toLowerCase()
    const prev = entry.servers.get(key) ?? null
    entry.servers.delete(key)
    return prev
}

// 'ok' | 'rejected' | null (never signed in)
function getServerStatus(token, server) {
    return _serverEntry(token, server)?.status ?? null
}

// All per-server entries for a session (used to end TM1 sessions on logout).
function listServerEntries(token) {
    const entry = _sessions.get(token)
    return entry?.servers ? [...entry.servers.entries()] : []
}

async function getCachedPawSession(token) {
    const entry = _sessions.get(token)
    if (!entry) throw new Error('Invalid or expired session — please log in again')
    if (!entry.session) throw new Error('Sign in to PAW to use this server')
    if (Date.now() >= entry.expiry) {
        entry.session = await _login(entry.pawUser ?? entry.username, entry.pawPass ?? entry.password)
        entry.expiry  = Date.now() + SESSION_TTL
    }
    return entry.session
}

function getSessionUser(token) {
    const entry = _sessions.get(token)
    if (!entry) return null
    if (Date.now() - entry.lastSeen > IDLE_TTL) {
        _sessions.delete(token)
        return null
    }
    return entry.username
}

// Called on every authenticated request to keep an in-use session alive.
function touchSession(token) {
    const entry = _sessions.get(token)
    if (entry) entry.lastSeen = Date.now()
}

function getSessionCredentials(token) {
    const entry = _sessions.get(token)
    if (!entry || entry.local) return null
    return { username: entry.username, password: entry.password }
}

function invalidateSession(token) {
    _sessions.delete(token)
}

async function getCSRF(session) {
    const cookies = await session._jar.getCookies(PAW_HOST)
    return cookies.find(c => c.key === 'ba-sso-csrf')?.value ?? ''
}

module.exports = { createSession, createDirectSession, createLocalSession, attachPawSession, hasPawSession, setServerCredentials, getServerCredentials, markServerRejected, clearServerCredentials, getServerStatus, listServerEntries, getCachedPawSession, getSessionUser, touchSession, getSessionCredentials, invalidateSession, getCSRF, PAW_HOST }
