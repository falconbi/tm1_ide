'use strict'

const path  = require('path')
const axios = require('axios')
const { PawNativeAdapter }  = require('./adapters/paw_native')
const { DirectV11Adapter }  = require('./adapters/direct_v11')
const { PawOAuth2Adapter }  = require('./adapters/paw_oauth2')
const { getSessionCredentials } = require('./paw_connect')

const SERVERS_PATH = path.join(__dirname, '..', 'config', 'servers.json')

// ── Config ────────────────────────────────────────────────────────────────────

function _loadConfig() {
    const cfg = require(SERVERS_PATH)
    if (Array.isArray(cfg)) {
        return {
            adminHosts:  [],
            connections: [{ name: 'default', adapter: 'paw-native', pawHost: process.env.PAW_HOST, servers: cfg.map(s => s.name) }],
        }
    }
    return { adminHosts: cfg.adminHosts ?? [], connections: cfg.connections ?? [] }
}

// ── Admin host URL resolution ─────────────────────────────────────────────────

const _urlCache = new Map()  // `${adminHostUrl}::${serverNameLower}` → resolved base URL

async function _resolveServerUrl(adminHost, serverName) {
    const key = `${adminHost.url}::${serverName.toLowerCase()}`
    if (_urlCache.has(key)) return _urlCache.get(key)

    const resp    = await axios.get(`${adminHost.url}/api/v1/Servers`, { timeout: 10_000 })
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

// ── Adapter factory ───────────────────────────────────────────────────────────

function getAdapter(serverName, ideToken) {
    const { adminHosts, connections } = _loadConfig()

    const adminHost = _findAdminHost(serverName, adminHosts)
    if (adminHost && (adminHost.adapter ?? 'direct-v11') === 'direct-v11') {
        const creds = getSessionCredentials(ideToken) ?? { username: adminHost.username, password: adminHost.password }
        return new DirectV11Adapter({
            urlResolver:  () => _resolveServerUrl(adminHost, serverName),
            serverName,
            username:     creds.username,
            password:     creds.password,
            camNamespace: adminHost.camNamespace ?? '',
        })
    }

    const conn = _findConnection(serverName, connections)
    const type = conn?.adapter ?? 'paw-native'

    if (type === 'paw-native') {
        return new PawNativeAdapter({ pawHost: conn?.pawHost ?? process.env.PAW_HOST, serverName, token: ideToken })
    }

    if (type === 'direct-v11') {
        const creds = getSessionCredentials(ideToken) ?? { username: conn.username, password: conn.password }
        return new DirectV11Adapter({
            urlResolver:  () => _resolveServerUrl(conn, serverName),
            serverName,
            username:     creds.username,
            password:     creds.password,
            camNamespace: conn.camNamespace ?? '',
        })
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

module.exports = { getAdapter, makeClient, listServers, getDefaultAdapterType, getLoginServer }
