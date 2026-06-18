'use strict'

const axios = require('axios')
const https = require('https')

const _httpsAgent  = new https.Agent({ rejectUnauthorized: false, keepAlive: true })
const _httpClient  = axios.create({ timeout: 120_000 })
const _httpsClient = axios.create({ timeout: 120_000, httpsAgent: _httpsAgent })

class DirectV11Adapter {
    constructor({ urlResolver, url, serverName, username, password, camNamespace = '' }) {
        this._urlResolver  = urlResolver ?? null
        this._resolvedUrl  = url ? url.replace(/\/$/, '') : null
        this._serverName   = serverName
        this._username     = username
        this._password     = password
        this._camNamespace = camNamespace
    }

    async _base() {
        if (!this._resolvedUrl) {
            this._resolvedUrl = await this._urlResolver()
        }
        return this._resolvedUrl
    }

    _client(base) {
        return base.startsWith('https') ? _httpsClient : _httpClient
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

module.exports = { DirectV11Adapter }
