'use strict'

const { getCachedPawSession, getCSRF, PAW_HOST } = require('./paw_connect')

class TM1Client {
    constructor(server) {
        this.server = server
    }

    _url(path) {
        return `${PAW_HOST}/api/v0/tm1/${this.server}/api/v1/${path}`
    }

    async _headers() {
        const session = await getCachedPawSession()
        return { 'ba-sso-authenticity': await getCSRF(session) }
    }

    async _session() {
        return getCachedPawSession()
    }

    async get(path, params = {}) {
        const s = await this._session()
        const r = await s.get(this._url(path), { params, headers: await this._headers() })
        return r.data
    }

    async post(path, body = {}) {
        const s = await this._session()
        const r = await s.post(this._url(path), body, { headers: await this._headers() })
        return r.data
    }

    async patch(path, body = {}) {
        const s = await this._session()
        const r = await s.patch(this._url(path), body, { headers: await this._headers() })
        return r.data ?? {}
    }

    async delete(path) {
        const s = await this._session()
        await s.delete(this._url(path), { headers: await this._headers() })
    }

    // ── Dimensions ────────────────────────────────────────────────────────────

    async getDimension(name) {
        try {
            return await this.get(`Dimensions('${name}')`, { '$select': 'Name' })
        } catch (e) {
            if (e.response?.status === 404) return null
            throw e
        }
    }

    async getElements(dim) {
        const d = await this.get(
            `Dimensions('${dim}')/Hierarchies('${dim}')/Elements`,
            { '$select': 'Name,Type,Level' }
        )
        return d.value ?? []
    }

    async getEdges(dim) {
        const d = await this.get(
            `Dimensions('${dim}')/Hierarchies('${dim}')/Edges`,
            { '$select': 'ParentName,ComponentName,Weight' }
        )
        return d.value ?? []
    }

    async getElementAttributes(dim) {
        const d = await this.get(
            `Dimensions('${dim}')/Hierarchies('${dim}')/ElementAttributes`,
            { '$select': 'Name,Type' }
        )
        return d.value ?? []
    }

    async getDimensions() {
        const d = await this.get('Dimensions', { '$select': 'Name' })
        return (d.value ?? []).map(r => r.Name).filter(n => !n.startsWith('}'))
    }

    // ── Cubes ─────────────────────────────────────────────────────────────────

    async getCube(name) {
        try {
            return await this.get(`Cubes('${name}')`, {
                '$select': 'Name,Rules',
                '$expand': 'Dimensions($select=Name)'
            })
        } catch (e) {
            if (e.response?.status === 404) return null
            throw e
        }
    }

    async getCubes() {
        const d = await this.get('Cubes', { '$select': 'Name' })
        return (d.value ?? []).map(r => r.Name).filter(n => !n.startsWith('}'))
    }

    // ── Processes ─────────────────────────────────────────────────────────────

    async getProcesses() {
        const d = await this.get('Processes', { '$select': 'Name' })
        return (d.value ?? []).map(r => r.Name).filter(n => !n.startsWith('}'))
    }

    async getProcess(name) {
        return this.get(`Processes('${name}')`)
    }

    async executeProcess(name, params = {}) {
        return this.post(`Processes('${name}')/tm1.Execute`, { Parameters: params })
    }

    // ── Chores ────────────────────────────────────────────────────────────────

    async getChores() {
        const d = await this.get('Chores', { '$select': 'Name' })
        return (d.value ?? []).map(r => r.Name).filter(n => !n.startsWith('}'))
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    async getViews(cube) {
        const d = await this.get(`Cubes('${cube}')/Views`, { '$select': 'Name' })
        return (d.value ?? []).map(r => r.Name).filter(n => !n.startsWith('}'))
    }

    async executeView(cube, view) {
        return this.post(
            `Cubes('${cube}')/Views('${view}')/tm1.Execute`,
            {},
        )
    }
}

module.exports = { TM1Client }
