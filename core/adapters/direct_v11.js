'use strict'

const axios = require('axios')
const fs    = require('fs')
const https = require('https')
const http  = require('http')

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

// Raised when TM1 rejects the credentials (401 on a fresh sign-in). The caller
// must ask the user to sign in again — the password is never retried.
class TM1AuthRejected extends Error {
    constructor(serverName, wwwAuthenticate = '') {
        super(`TM1 rejected the login for server "${serverName}" — sign in to it again`)
        this.code = 'TM1_AUTH_REJECTED'
        this.server = serverName
        this.wwwAuthenticate = wwwAuthenticate
    }
}

// Pull TM1SessionId out of a response's Set-Cookie headers.
function _sessionCookie(r) {
    const raw = r.headers?.['set-cookie']
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    for (const c of list) {
        const m = /^\s*(TM1SessionId=[^;]+)/i.exec(c)
        if (m) return m[1]
    }
    return null
}

// Non-2xx → throw an axios-shaped error (callers read e.response.status / .data).
function _settle(r) {
    if (r.status >= 200 && r.status < 300) return r
    const e = new Error(`Request failed with status code ${r.status}`)
    e.response = r
    throw e
}

class DirectV11Adapter {
    // state: a per-(user, server) object the adapter keeps the TM1 session in
    //   ({ cookie, pending }). Pass the same object on every request for one
    //   TM1 session per server instead of one per request.
    // onRejected: called once when TM1 rejects the credentials.
    constructor({ urlResolver, url, serverName, username, password, camNamespace = '', tls = {}, state = null, onRejected = null }) {
        this._urlResolver  = urlResolver ?? null
        this._resolvedUrl  = url ? url.replace(/\/$/, '') : null
        this._serverName   = serverName
        this._username     = username
        this._password     = password
        this._camNamespace = camNamespace
        this._tls          = tls   // { mode?: 'verify'|'chain-only'|'insecure', caFile?: string }
        this._state        = state ?? {}
        this._onRejected   = onRejected
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

    // Credentials header for a fresh sign-in.
    //   native / LDAP:  Basic base64(user:password)
    //   CAM (mode 4/5): CAMNamespace base64(user:password:namespace)
    _authHeaders() {
        if (this._camNamespace) {
            const enc = Buffer.from(`${this._username}:${this._password}:${this._camNamespace}`).toString('base64')
            return { Authorization: `CAMNamespace ${enc}` }
        }
        const enc = Buffer.from(`${this._username}:${this._password}`).toString('base64')
        return { Authorization: `Basic ${enc}` }
    }

    // One request. Reuses the TM1 session cookie when there is one; signs in
    // with the credentials only when there isn't (or it expired). A 401 on a
    // fresh sign-in is a rejection — reported once, never retried.
    async _request(method, path, { params, data, headers = {} } = {}) {
        const base = await this._base()
        const http = this._client(base)
        const url  = this._url(base, path)
        const st   = this._state
        // A reused keep-alive socket the server already closed fails with
        // ECONNRESET before the request is processed — retry reads once.
        const send = async (auth) => {
            const go = () => http.request({ method, url, params, data, headers: { ...headers, ...auth }, validateStatus: () => true })
            try { return await go() } catch (e) {
                if (method === 'get' && (e.code === 'ECONNRESET' || e.code === 'EPIPE')) return go()
                throw e
            }
        }

        // Another request is already signing in — wait for it and reuse its session.
        if (!st.cookie && st.pending) { try { await st.pending } catch { /* handled by that request */ } }

        if (st.cookie) {
            const r = await send({ Cookie: st.cookie })
            if (r.status !== 401) return _settle(r)
            st.cookie = null   // session expired — sign in once below
        }

        const signIn = send(this._authHeaders())
        st.pending = signIn
        let r
        try { r = await signIn } finally { if (st.pending === signIn) st.pending = null }
        if (r.status === 401) {
            this._onRejected?.()
            throw new TM1AuthRejected(this._serverName, r.headers?.['www-authenticate'] ?? '')
        }
        const cookie = _sessionCookie(r)
        if (cookie) st.cookie = cookie
        return _settle(r)
    }

    async get(path, params = {}) {
        return (await this._request('get', path, { params })).data
    }

    async post(path, body = {}) {
        return (await this._request('post', path, { data: body })).data
    }

    async patch(path, body = {}) {
        return (await this._request('patch', path, { data: body })).data ?? {}
    }

    async delete(path) {
        await this._request('delete', path)
    }

    async put(path, data, contentType = 'application/octet-stream') {
        return (await this._request('put', path, { data, headers: { 'Content-Type': contentType } })).data
    }

    // End this TM1 session (best effort) — on sign-out, so sessions don't linger.
    async closeSession() {
        const cookie = this._state.cookie
        if (!cookie) return
        this._state.cookie = null
        try {
            const base = await this._base()
            // Own connection (Connection: close): TM1 drops the socket after closing the
            // session — on a shared keep-alive socket the next request would fail.
            await axios.post(this._url(base, 'ActiveSession/tm1.Close'), {}, {
                headers: { Cookie: cookie, Connection: 'close' },
                timeout: 10_000,
                httpsAgent: base.startsWith('https') ? new https.Agent({ ...httpsAgentFor(this._tls).agent.options, keepAlive: false }) : undefined,
                httpAgent:  base.startsWith('https') ? undefined : new http.Agent({ keepAlive: false }),
                validateStatus: () => true,
            })
        } catch { /* best effort */ }
    }
}

module.exports = { DirectV11Adapter, httpsAgentFor, TM1AuthRejected }
