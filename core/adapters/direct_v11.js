'use strict'

const axios = require('axios')
const fs    = require('fs')
const https = require('https')

// ── TLS policy for the direct TM1 REST connection ─────────────────────────────
// mode:
//   "verify"      (default) full verification — CA chain + hostname/SAN match.
//                 Public-CA and internal-CA certs (the latter via the system
//                 store or NODE_EXTRA_CA_CERTS / tlsCaFile) work as-is.
//   "chain-only"  verify the CA chain but skip the hostname/SAN match. This is
//                 the correct mode for the stock IBM TM1 certificate, which is
//                 trusted-CA-signed but carries no server name — a MITM's cert
//                 still fails the chain check. Matches classic TM1 SSL behaviour.
//   "insecure"    no verification at all. Lab / throwaway self-signed box only.
// caFile: optional path to a PEM (CA bundle or the server's own cert) to ADD to
//   the trust store. Applies to "verify" and "chain-only".
const _httpClient  = axios.create({ timeout: 120_000 })
const _agentCache  = new Map()   // key -> { agent, client }
const _warned      = new Set()

const _MODES = new Set(['verify', 'chain-only', 'insecure'])

function httpsAgentFor({ mode = 'verify', caFile = null } = {}) {
    if (!_MODES.has(mode)) {
        if (!_warned.has(`badmode:${mode}`)) {
            console.warn(`⚠  direct-v11: unknown tls mode "${mode}" — falling back to "verify".`)
            _warned.add(`badmode:${mode}`)
        }
        mode = 'verify'
    }

    const key = `${mode}::${caFile ?? ''}`
    let hit = _agentCache.get(key)
    if (!hit) {
        const opts = { keepAlive: true }
        if (caFile) opts.ca = fs.readFileSync(caFile)

        if (mode === 'insecure') {
            opts.rejectUnauthorized = false
            if (!_warned.has(key)) {
                console.warn('⚠  direct-v11: TLS verification DISABLED (tls: "insecure"). Prefer "chain-only" or a tlsCaFile.')
                _warned.add(key)
            }
        } else if (mode === 'chain-only') {
            // keep the CA-chain check (rejectUnauthorized stays true), drop the name match
            opts.checkServerIdentity = () => undefined
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
        this._tls          = tls   // { mode?: 'verify'|'chain-only'|'insecure', caFile?: string }
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
