'use strict'

const axios = require('axios')
const fs    = require('fs')
const https = require('https')

// ── TLS policy for the direct TM1 REST connection ─────────────────────────────
// Default: verify the server certificate against the system trust store, which
//   also includes anything in NODE_EXTRA_CA_CERTS. Public-CA and internal-CA
//   (via the env var) certs work with no config.
// tlsCaFile: additionally trust a specific CA bundle / self-signed cert file —
//   still fully verified, just against that CA too. The per-server alternative
//   to NODE_EXTRA_CA_CERTS.
// tlsInsecure: skip verification entirely. Only for a throwaway self-signed lab
//   box; must be set explicitly per server in servers.json ("tlsInsecure": true).
const _httpClient  = axios.create({ timeout: 120_000 })
const _agentCache  = new Map()   // key -> { agent, client }
const _warned      = new Set()

function httpsAgentFor({ insecure = false, caFile = null } = {}) {
    const key = `${insecure ? 'insecure' : 'verify'}::${caFile ?? ''}`
    let hit = _agentCache.get(key)
    if (!hit) {
        const opts = { keepAlive: true }
        if (insecure) {
            opts.rejectUnauthorized = false
            if (!_warned.has(key)) {
                console.warn('⚠  direct-v11: TLS certificate verification is DISABLED (tlsInsecure). Prefer tlsCaFile to trust a specific CA.')
                _warned.add(key)
            }
        } else if (caFile) {
            opts.ca = fs.readFileSync(caFile)
        }
        const agent = new https.Agent(opts)
        hit = { agent, client: axios.create({ timeout: 120_000, httpsAgent: agent }) }
        _agentCache.set(key, hit)
    }
    return hit
}

class DirectV11Adapter {
    constructor({ urlResolver, url, serverName, username, password, camNamespace = '', tls = {} }) {
        this._urlResolver  = urlResolver ?? null
        this._resolvedUrl  = url ? url.replace(/\/$/, '') : null
        this._serverName   = serverName
        this._username     = username
        this._password     = password
        this._camNamespace = camNamespace
        this._tls          = tls   // { insecure?: boolean, caFile?: string }
    }

    async _base() {
        if (!this._resolvedUrl) {
            this._resolvedUrl = await this._urlResolver()
        }
        return this._resolvedUrl
    }

    _client(base) {
        return base.startsWith('https') ? httpsAgentFor(this._tls).client : _httpClient
    }

    _url(base, path) {
        return `${base}/api/v1/${path}`
    }

    _headers() {
        const encoded = Buffer.from(`${this._username}:${this._password}`).toString('base64')
        const h = { Authorization: `Basic ${encoded}` }
        if (this._camNamespace) h.CAMNamespace = this._camNamespace
        return h
    }

    async get(path, params = {}) {
        const base = await this._base()
        const r = await this._client(base).get(this._url(base, path), { params, headers: this._headers() })
        return r.data
    }

    async post(path, body = {}) {
        const base = await this._base()
        const r = await this._client(base).post(this._url(base, path), body, { headers: this._headers() })
        return r.data
    }

    async patch(path, body = {}) {
        const base = await this._base()
        const r = await this._client(base).patch(this._url(base, path), body, { headers: this._headers() })
        return r.data ?? {}
    }

    async delete(path) {
        const base = await this._base()
        await this._client(base).delete(this._url(base, path), { headers: this._headers() })
    }

    async put(path, data, contentType = 'application/octet-stream') {
        const base = await this._base()
        const r = await this._client(base).put(this._url(base, path), data, {
            headers: { ...this._headers(), 'Content-Type': contentType },
        })
        return r.data
    }
}

module.exports = { DirectV11Adapter, httpsAgentFor }
