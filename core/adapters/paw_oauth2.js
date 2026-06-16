'use strict'

const axios = require('axios')

const TOKEN_REFRESH_MARGIN = 60_000  // refresh 60s before expiry

class PawOAuth2Adapter {
    constructor({ pawHost, serverName, clientId, clientSecret }) {
        this._pawHost = pawHost.replace(/\/$/, '')
        this._serverName = serverName
        this._clientId = clientId
        this._clientSecret = clientSecret
        this._token = null
        this._tokenExpiry = 0
        this._client = axios.create({ timeout: 120_000 })
    }

    _url(path) {
        return `${this._pawHost}/api/v1/tm1/${this._serverName}/api/v1/${path}`
    }

    async _ensureToken() {
        if (this._token && Date.now() < this._tokenExpiry) return
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this._clientId,
            client_secret: this._clientSecret,
        })
        const r = await this._client.post(`${this._pawHost}/oauth2/token`, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        this._token = r.data.access_token
        this._tokenExpiry = Date.now() + (r.data.expires_in * 1000) - TOKEN_REFRESH_MARGIN
    }

    _headers() {
        return { Authorization: `Bearer ${this._token}` }
    }

    async get(path, params = {}) {
        await this._ensureToken()
        const r = await this._client.get(this._url(path), { params, headers: this._headers() })
        return r.data
    }

    async post(path, body = {}) {
        await this._ensureToken()
        const r = await this._client.post(this._url(path), body, { headers: this._headers() })
        return r.data
    }

    async patch(path, body = {}) {
        await this._ensureToken()
        const r = await this._client.patch(this._url(path), body, { headers: this._headers() })
        return r.data ?? {}
    }

    async delete(path) {
        await this._ensureToken()
        await this._client.delete(this._url(path), { headers: this._headers() })
    }

    async put(path, data, contentType = 'application/octet-stream') {
        await this._ensureToken()
        const r = await this._client.put(this._url(path), data, {
            headers: { ...this._headers(), 'Content-Type': contentType },
        })
        return r.data
    }
}

module.exports = { PawOAuth2Adapter }
