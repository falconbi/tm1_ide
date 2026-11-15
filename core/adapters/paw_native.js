'use strict'

const { getCachedPawSession, getCSRF } = require('../paw_connect')
const { paramsSerializer } = require('../odata-params')   // spaces as %20 — TM1 doesn't read '+'
const { normalizeError } = require('../tm1-error')

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

    async _call(fn) {
        try { return await fn() } catch (e) { throw normalizeError(e) }
    }

    async get(path, params = {}, opts = {}) {
        const { s, h } = await this._sh()
        return (await this._call(() => s.get(this._url(path), {
            params, paramsSerializer, headers: h,
            ...(opts.binary ? { responseType: 'arraybuffer' } : {}),
        }))).data
    }

    async post(path, body = {}, opts = {}) {
        const { s, h } = await this._sh()
        return (await this._call(() => s.post(this._url(path), body, { headers: h, ...(opts.timeout ? { timeout: opts.timeout } : {}) }))).data
    }

    async patch(path, body = {}) {
        const { s, h } = await this._sh()
        return (await this._call(() => s.patch(this._url(path), body, { headers: h }))).data ?? {}
    }

    async delete(path) {
        const { s, h } = await this._sh()
        await this._call(() => s.delete(this._url(path), { headers: h }))
    }

    async put(path, data, contentType = 'application/octet-stream') {
        const { s, h } = await this._sh()
        return (await this._call(() => s.put(this._url(path), data, {
            headers: { ...h, 'Content-Type': contentType },
        }))).data
    }
}

module.exports = { PawNativeAdapter }
