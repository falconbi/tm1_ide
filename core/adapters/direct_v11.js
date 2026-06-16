'use strict'

const axios = require('axios')

class DirectV11Adapter {
    constructor({ url, serverName, username, password, camNamespace = '' }) {
        this._baseUrl = url.replace(/\/$/, '')
        this._serverName = serverName
        this._username = username
        this._password = password
        this._camNamespace = camNamespace
        this._client = axios.create({ timeout: 120_000 })
    }

    _url(path) {
        return `${this._baseUrl}/api/v1/${path}`
    }

    _headers() {
        const encoded = Buffer.from(`${this._username}:${this._password}`).toString('base64')
        const h = { Authorization: `Basic ${encoded}` }
        if (this._camNamespace) h.CAMNamespace = this._camNamespace
        return h
    }

    async get(path, params = {}) {
        const r = await this._client.get(this._url(path), { params, headers: this._headers() })
        return r.data
    }

    async post(path, body = {}) {
        const r = await this._client.post(this._url(path), body, { headers: this._headers() })
        return r.data
    }

    async patch(path, body = {}) {
        const r = await this._client.patch(this._url(path), body, { headers: this._headers() })
        return r.data ?? {}
    }

    async delete(path) {
        await this._client.delete(this._url(path), { headers: this._headers() })
    }

    async put(path, data, contentType = 'application/octet-stream') {
        const r = await this._client.put(this._url(path), data, {
            headers: { ...this._headers(), 'Content-Type': contentType },
        })
        return r.data
    }
}

module.exports = { DirectV11Adapter }
