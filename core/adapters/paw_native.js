'use strict'

const { getCachedPawSession, getCSRF } = require('../paw_connect')

class PawNativeAdapter {
    constructor({ pawHost, serverName, token }) {
        this._pawHost = pawHost
        this._serverName = serverName
        this._token = token
    }

    _url(path) {
        return `${this._pawHost}/api/v0/tm1/${this._serverName}/api/v1/${path}`
    }

    async _sh() {
        const s = await getCachedPawSession(this._token)
        const csrf = await getCSRF(s)
        return { s, h: { 'ba-sso-authenticity': csrf } }
    }

    async get(path, params = {}) {
        const { s, h } = await this._sh()
        return (await s.get(this._url(path), { params, headers: h })).data
    }

    async post(path, body = {}) {
        const { s, h } = await this._sh()
        return (await s.post(this._url(path), body, { headers: h })).data
    }

    async patch(path, body = {}) {
        const { s, h } = await this._sh()
        return (await s.patch(this._url(path), body, { headers: h })).data ?? {}
    }

    async delete(path) {
        const { s, h } = await this._sh()
        await s.delete(this._url(path), { headers: h })
    }

    async put(path, data, contentType = 'application/octet-stream') {
        const { s, h } = await this._sh()
        return (await s.put(this._url(path), data, {
            headers: { ...h, 'Content-Type': contentType },
        })).data
    }
}

module.exports = { PawNativeAdapter }
