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

    async getElements(dim, hierarchy = dim) {
        const TYPE = { Numeric: 'N', Consolidated: 'C', String: 'S', N: 'N', C: 'C', S: 'S' }
        const d = await this.get(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements`,
            { '$select': 'Name,Type,Level' }
        )
        return (d.value ?? []).map(e => ({ ...e, Type: TYPE[e.Type] ?? e.Type }))
    }

    async getElementsWithAttributes(dim, hierarchy = dim) {
        // PAW does not support $expand=Attributes on the collection (returns 400).
        // Return elements with empty attributes — callers that need values use getElementAttributeValues per element.
        const TYPE = { Numeric: 'N', Consolidated: 'C', String: 'S', N: 'N', C: 'C', S: 'S' }
        const d = await this.get(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements`,
            { '$select': 'Name,Type,Level' }
        )
        return (d.value ?? []).map(e => ({
            Name: e.Name,
            Type: TYPE[e.Type] ?? e.Type,
            Level: e.Level,
            Attributes: {},
        }))
    }

    async getElementAttributeValues(dim, element, hierarchy = dim) {
        // Returns flat object: { Caption: "...", signswitch: 0, ... }
        // Filters out @odata.* metadata keys.
        const raw = await this.get(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements('${element}')/Attributes`
        )
        return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('@')))
    }

    async getEdges(dim, hierarchy = dim) {
        const d = await this.get(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Edges`,
            { '$select': 'ParentName,ComponentName,Weight' }
        )
        return d.value ?? []
    }

    async addElement(dim, name, type, hierarchy = dim) {
        const TYPE_MAP = { N: 'Numeric', C: 'Consolidated', S: 'String' }
        return this.post(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements`,
            { Name: name, Type: TYPE_MAP[type] ?? type }
        )
    }

    async deleteElement(dim, name, hierarchy = dim) {
        return this.delete(`Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements('${name}')`)
    }

    async renameElement(dim, name, newName, hierarchy = dim) {
        return this.patch(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements('${name}')`,
            { Name: newName }
        )
    }

    async addEdge(dim, parent, child, weight = 1, hierarchy = dim) {
        return this.post(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Edges`,
            { ParentName: parent, ComponentName: child, Weight: weight }
        )
    }

    async deleteEdge(dim, parent, child, hierarchy = dim) {
        return this.delete(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Edges(ParentName='${parent}',ComponentName='${child}')`
        )
    }

    async updateEdgeWeight(dim, parent, child, weight, hierarchy = dim) {
        return this.patch(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Edges(ParentName='${parent}',ComponentName='${child}')`,
            { Weight: weight }
        )
    }

    async getHierarchies(dim) {
        const d = await this.get(`Dimensions('${dim}')/Hierarchies`, { '$select': 'Name' })
        return (d.value ?? []).map(h => h.Name)
    }

    // ── Attribute value write probe ───────────────────────────────────────────
    // Tests PATCH on Elements('name')/Attributes — the sub-resource we confirmed
    // works for reads. Writes back the SAME value already there (safe no-op).
    // Tries two body formats: flat object and array.
    async probeAttributeValueWrite(dim, element, attribute, value, hierarchy = dim) {
        const results = {}
        const base = `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements('${element}')/Attributes`

        // Format A: flat object { attrName: value } — mirrors what GET returns
        try {
            await this.patch(base, { [attribute]: value })
            results.flatObject = { ok: true }
        } catch (e) {
            results.flatObject = { ok: false, status: e.response?.status, error: e.message }
        }

        // Format B: array [ { Name, Value } ]
        try {
            await this.patch(base, [{ Name: attribute, Value: value }])
            results.arrayFormat = { ok: true }
        } catch (e) {
            results.arrayFormat = { ok: false, status: e.response?.status, error: e.message }
        }

        // Format C: POST (create/upsert) with flat object
        try {
            await this.post(base, { [attribute]: value })
            results.postFlat = { ok: true }
        } catch (e) {
            results.postFlat = { ok: false, status: e.response?.status, error: e.message }
        }

        return results
    }

    async _put(path, body = {}) {
        const s = await this._session()
        const r = await s.put(this._url(path), body, { headers: await this._headers() })
        return r.data ?? {}
    }

    // ── Attribute write probe (TM1py-derived approaches) ─────────────────────
    async probeAttributeWrite(dim, element, attribute, value) {
        const results = {}
        const enc = s => String(s).replace(/'/g, "''").replace(/%/g, '%25').replace(/#/g, '%23')
        const attrDim = `}ElementAttributes_${dim}`
        const elemDim = `}Elements_${dim}`

        // Method A: tm1.Update on the }ElementAttributes cube (TM1py write_value pattern)
        try {
            await this.post(`Cubes('${enc(attrDim)}')/tm1.Update`, {
                Cells: [{
                    'Tuple@odata.bind': [
                        `Dimensions('${enc(attrDim)}')/Hierarchies('${enc(attrDim)}')/Elements('${enc(attribute)}')`,
                        `Dimensions('${enc(elemDim)}')/Hierarchies('${enc(elemDim)}')/Elements('${enc(element)}')`,
                    ]
                }],
                Value: String(value),
            })
            results.tmUpdate = { ok: true }
        } catch (e) {
            console.error('[probe-tmUpdate] status:', e.response?.status, 'data:', JSON.stringify(e.response?.data ?? ''))
            results.tmUpdate = { ok: false, status: e.response?.status, error: e.message }
        }

        // Method B: ExecuteProcessWithReturn — inline TI, no create/delete needed (TM1py pattern)
        const isNumeric = typeof value === 'number'
        const safeVal = isNumeric ? value : `'${String(value).replace(/'/g, "''")}'`
        const safeElem = String(element).replace(/'/g, "''")
        const safeAttr = String(attribute).replace(/'/g, "''")
        const tiCode = isNumeric
            ? `ElementAttrPutN(${safeVal}, '${enc(dim)}', '${safeElem}', '${safeAttr}');`
            : `ElementAttrPutS(${safeVal}, '${enc(dim)}', '${safeElem}', '${safeAttr}');`
        try {
            await this.post('ExecuteProcessWithReturn?$expand=*', {
                Process: {
                    Name: `}TM1IDE_probe_${Date.now()}`,
                    PrologProcedure: tiCode,
                    MetadataProcedure: '',
                    DataProcedure: '',
                    EpilogProcedure: '',
                    HasSecurityAccess: false,
                    DataSource: { Type: 'None' },
                    Parameters: [],
                    Variables: [],
                }
            })
            results.tiInline = { ok: true }
        } catch (e) {
            console.error('[probe-tiInline] status:', e.response?.status, 'data:', JSON.stringify(e.response?.data ?? ''))
            results.tiInline = { ok: false, status: e.response?.status, error: e.message }
        }

        return results
    }

    async createElementAttribute(dim, name, type, hierarchy = dim) {
        // type: 'String' | 'Numeric' | 'Alias'
        return this.post(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/ElementAttributes`,
            { Name: name, Type: type }
        )
    }

    async deleteElementAttribute(dim, name, hierarchy = dim) {
        return this.delete(`Dimensions('${dim}')/Hierarchies('${hierarchy}')/ElementAttributes('${name}')`)
    }

    async writeElementAttribute(dim, element, attribute, value, attrType = 'S', hierarchy = dim) {
        const safe = s => String(s).replace(/'/g, "''")
        const tiCode = attrType === 'N'
            ? `ElementAttrPutN(${Number(value)}, '${safe(dim)}', '${safe(hierarchy)}', '${safe(element)}', '${safe(attribute)}');`
            : `ElementAttrPutS('${safe(String(value))}', '${safe(dim)}', '${safe(hierarchy)}', '${safe(element)}', '${safe(attribute)}');`
        return this.post('ExecuteProcessWithReturn?$expand=*', {
            Process: {
                Name: `}TM1IDE_write`,
                PrologProcedure: tiCode,
                MetadataProcedure: '',
                DataProcedure: '',
                EpilogProcedure: '',
                HasSecurityAccess: false,
                DataSource: { Type: 'None' },
                Parameters: [],
                Variables: [],
            }
        })
    }

    async getElementAttributes(dim, hierarchy = dim) {
        const d = await this.get(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/ElementAttributes`,
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

    async getCubesForDimension(dim) {
        const names = await this.getCubes()
        const cubes = await Promise.all(names.map(n => this.getCube(n)))
        return cubes
            .filter(c => c && (c.Dimensions ?? []).some(d => d.Name === dim))
            .map(c => c.Name)
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

    // ── Subsets ───────────────────────────────────────────────────────────────

    async getSubsets(dim, hierarchy = dim) {
        const d = await this.get(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Subsets`,
            { '$select': 'Name,Expression' }
        )
        return (d.value ?? []).filter(s => !s.Name.startsWith('}'))
    }

    async getSubset(dim, name, hierarchy = dim) {
        return this.get(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Subsets('${name}')`,
            { '$select': 'Name,Expression' }
        )
    }

    async saveSubset(dim, name, mdx, hierarchy = dim) {
        const body = { '@odata.type': '#ibm.tm1.api.v1.MDXSubset', Name: name, Expression: mdx, Hierarchy: { Name: hierarchy, Dimension: { Name: dim } } }
        try {
            await this.patch(
                `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Subsets('${name}')`,
                body
            )
        } catch (e) {
            if (e.response?.status === 404) {
                await this.post(`Dimensions('${dim}')/Hierarchies('${hierarchy}')/Subsets`, body)
            } else throw e
        }
    }

    async previewMDX(dim, mdx, limit = 100, hierarchy = dim) {
        const tmpName = `}TM1IDE_preview_${Date.now()}`
        try {
            await this.post(
                `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Subsets`,
                { '@odata.type': '#ibm.tm1.api.v1.MDXSubset', Name: tmpName, Expression: mdx, Hierarchy: { Name: hierarchy, Dimension: { Name: dim } } }
            )
            const d = await this.get(
                `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Subsets('${tmpName}')/Elements`,
                { '$select': 'Name,Type', '$top': limit }
            )
            return (d.value ?? []).map(e => ({ name: e.Name, type: e.Type }))
        } finally {
            try { await this.delete(`Dimensions('${dim}')/Hierarchies('${hierarchy}')/Subsets('${tmpName}')`) } catch {}
        }
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    async getViews(cube) {
        const d = await this.get(`Cubes('${cube}')/Views`, { '$select': 'Name' })
        return (d.value ?? []).map(r => r.Name).filter(n => !n.startsWith('}'))
    }

    async getView(cube, name) {
        try {
            return await this.get(`Cubes('${cube}')/Views('${name}')`)
        } catch (e) {
            if (e.response?.status === 404) return null
            throw e
        }
    }

    async getSubsetElements(dim, name, hierarchy = dim) {
        const TYPE = { Numeric: 'N', Consolidated: 'C', String: 'S', N: 'N', C: 'C', S: 'S', 1: 'N', 2: 'S', 3: 'C' }
        const d = await this.get(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Subsets('${name}')/Elements`,
            { '$select': 'Name,Type,Level' }
        )
        return (d.value ?? []).map(e => ({ name: e.Name, type: TYPE[e.Type] ?? e.Type, level: e.Level }))
    }

    async saveStaticSubset(dim, name, elements, hierarchy = dim) {
        const bind = elements.map(el => `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements('${el.replace(/'/g, "''")}')`        )
        const body = {
            '@odata.type': '#ibm.tm1.api.v1.StaticSubset',
            Name: name,
            Hierarchy: { Name: hierarchy, Dimension: { Name: dim } },
            'Elements@odata.bind': bind,
        }
        try {
            await this.patch(`Dimensions('${dim}')/Hierarchies('${dim}')/Subsets('${name}')`, body)
        } catch (e) {
            if (e.response?.status === 404) {
                await this.post(`Dimensions('${dim}')/Hierarchies('${dim}')/Subsets`, body)
            } else throw e
        }
    }

    async saveView(cube, name, mdx) {
        const esc = s => s.replace(/'/g, "''")
        const body = { '@odata.type': '#ibm.tm1.api.v1.MDXView', Name: name, MDX: mdx }
        try {
            await this.patch(`Cubes('${esc(cube)}')/Views('${esc(name)}')`, body)
        } catch (e) {
            if (e.response?.status === 404) {
                await this.post(`Cubes('${esc(cube)}')/Views`, body)
            } else throw e
        }
    }

    async executeMDX(mdx) {
        const { ID } = await this.post('ExecuteMDX', { MDX: mdx })
        const s = await this._session()
        const h = await this._headers()
        const [axisRes, cellRes] = await Promise.all([
            s.get(this._url(`Cellsets('${ID}')/Axes`), {
                params: { '$expand': 'Tuples($expand=Members($select=Name,UniqueName))' },
                headers: h,
            }),
            s.get(this._url(`Cellsets('${ID}')/Cells`), {
                params: { '$select': 'Ordinal,Value,FormattedValue' },
                headers: h,
            }),
        ])
        try { await this.delete(`Cellsets('${ID}')`) } catch {}
        return { Axes: axisRes.data.value, Cells: cellRes.data.value }
    }

    async executeView(cube, view) {
        const viewDef  = await this.get(`Cubes('${cube}')/Views('${view}')`)
        const { ID }   = await this.post(`Cubes('${cube}')/Views('${view}')/tm1.Execute`, {})
        const s = await this._session()
        const h = await this._headers()
        const [axisRes, cellRes] = await Promise.all([
            s.get(this._url(`Cellsets('${ID}')/Axes`), {
                params: { '$expand': 'Tuples($expand=Members($select=Name,UniqueName))' },
                headers: h,
            }),
            s.get(this._url(`Cellsets('${ID}')/Cells`), {
                params: { '$select': 'Ordinal,Value,FormattedValue' },
                headers: h,
            }),
        ])
        try { await this.delete(`Cellsets('${ID}')`) } catch {}
        return {
            Axes: axisRes.data.value,
            Cells: cellRes.data.value,
            ViewType: viewDef?.['@odata.type'] ?? null,
        }
    }
}

module.exports = { TM1Client }
