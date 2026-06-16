'use strict'

const path = require('path')
const { PawNativeAdapter } = require('./adapters/paw_native')
const { DirectV11Adapter }  = require('./adapters/direct_v11')
const { PawOAuth2Adapter }  = require('./adapters/paw_oauth2')
const { getSessionCredentials } = require('./paw_connect')

const SERVERS_PATH = path.join(__dirname, '..', 'config', 'servers.json')

// Support both v1 (flat array) and v2 (object with connections)
function _loadConnections() {
    const cfg = require(SERVERS_PATH)
    if (Array.isArray(cfg)) {
        return [{
            name: 'default',
            adapter: 'paw-native',
            pawHost: process.env.PAW_HOST,
            servers: cfg.map(s => s.name),
        }]
    }
    return cfg.connections ?? []
}

function _findConnection(serverName, connections) {
    const lower = serverName.toLowerCase()
    for (const conn of connections) {
        const members = conn.servers ?? [conn.name]
        if (members.some(s => s.toLowerCase() === lower)) return conn
    }
    return null
}

// paw-oauth2 tokens are per-connection (machine credential, not per-user)
const _oauth2Cache = new Map()  // conn.name → PawOAuth2Adapter

function getAdapter(serverName, ideToken) {
    const connections = _loadConnections()
    const conn = _findConnection(serverName, connections)
    const type = conn?.adapter ?? 'paw-native'

    if (type === 'paw-native') {
        return new PawNativeAdapter({
            pawHost: conn?.pawHost ?? process.env.PAW_HOST,
            serverName,
            token: ideToken,
        })
    }

    if (type === 'direct-v11') {
        const creds = getSessionCredentials(ideToken)
        if (!creds) throw new Error('Session expired — please log in again')
        return new DirectV11Adapter({
            url: conn.url,
            serverName,
            username: creds.username,
            password: creds.password,
            camNamespace: conn.camNamespace ?? '',
        })
    }

    if (type === 'paw-oauth2') {
        const key = `${conn.name}:${serverName}`
        if (!_oauth2Cache.has(key)) {
            _oauth2Cache.set(key, new PawOAuth2Adapter({
                pawHost: conn.pawHost,
                serverName,
                clientId: conn.client_id,
                clientSecret: conn.client_secret,
            }))
        }
        return _oauth2Cache.get(key)
    }

    throw new Error(`Unknown adapter type: ${type}`)
}

function makeClient(serverName, ideToken) {
    const { TM1Client } = require('./tm1_client')
    const adapter = getAdapter(serverName, ideToken)
    return new TM1Client(serverName, adapter)
}

// Returns all server names across all connections (for /api/servers route)
function listServers() {
    try {
        const connections = _loadConnections()
        return connections.flatMap(c => c.servers ?? [c.name])
    } catch {
        return []
    }
}

module.exports = { getAdapter, makeClient, listServers }
