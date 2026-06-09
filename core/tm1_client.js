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

    async put(path, data, contentType = 'application/octet-stream') {
        const s = await this._session()
        const r = await s.put(this._url(path), data, {
            headers: { ...await this._headers(), 'Content-Type': contentType },
        })
        return r.data
    }

    // ── Dimensions ────────────────────────────────────────────────────────────

    async deleteDimension(name) {
        return this.delete(`Dimensions('${encodeURIComponent(name)}')`)
    }

    async deleteCube(name) {
        return this.delete(`Cubes('${encodeURIComponent(name)}')`)
    }

    async deleteProcess(name) {
        return this.delete(`Processes('${encodeURIComponent(name)}')`)
    }

    async deleteChore(name) {
        return this.delete(`Chores('${encodeURIComponent(name)}')`)
    }

    async deleteSubset(dim, name, hierarchy = dim) {
        return this.delete(`Dimensions('${encodeURIComponent(dim)}')/Hierarchies('${encodeURIComponent(hierarchy)}')/Subsets('${encodeURIComponent(name)}')`)
    }

    async getDimension(name) {
        try {
            return await this.get(`Dimensions('${name}')`, { '$select': 'Name' })
        } catch (e) {
            if (e.response?.status === 404) return null
            throw e
        }
    }

    async getElements(dim, hierarchy = dim, includeIndex = false) {
        const TYPE = { Numeric: 'N', Consolidated: 'C', String: 'S', N: 'N', C: 'C', S: 'S', 1: 'N', 2: 'S', 3: 'C' }
        const d = await this.get(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements`,
            { '$select': includeIndex ? 'Name,Type,Level,Index' : 'Name,Type,Level' }
        )
        return (d.value ?? []).map(e => ({ ...e, Type: TYPE[e.Type] ?? e.Type }))
    }

    async getElementsWithTree(dim, hierarchy = dim) {
        const TYPE = { Numeric: 'N', Consolidated: 'C', String: 'S', N: 'N', C: 'C', S: 'S', 1: 'N', 2: 'S', 3: 'C' }
        try {
            const d = await this.get(
                `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements`,
                { '$select': 'Name,Type,Level', '$expand': 'Components($select=Name)' }
            )
            return (d.value ?? []).map(e => ({
                Name:       e.Name,
                Type:       TYPE[e.Type] ?? e.Type,
                Level:      e.Level ?? 0,
                Components: (e.Components ?? []).map(c => c.Name),
            }))
        } catch {
            // $expand=Components not supported — return flat list
            return this.getElements(dim, hierarchy)
        }
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

    async createDimension(name) {
        await this.post('Dimensions', { Name: name })
        // TM1 auto-creates a default hierarchy with the same name
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

    // Bulk-create elements in one POST — far faster than addElement() in a loop
    async bulkSetElements(dim, elements, hierarchy = dim) {
        const TYPE_MAP = { N: 'Numeric', C: 'Consolidated', S: 'String' }
        const body = elements.map(({ name, type }) => ({
            Element: { Name: name, Type: TYPE_MAP[type] ?? type ?? 'Numeric' },
        }))
        return this.post(
            `Dimensions('${encodeURIComponent(dim)}')/Hierarchies('${encodeURIComponent(hierarchy)}')/tm1.SetElement`,
            body
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

    async createHierarchy(dim, name) {
        return this.post(`Dimensions('${dim}')/Hierarchies`, { Name: name })
    }

    async deleteHierarchy(dim, name) {
        return this.delete(`Dimensions('${dim}')/Hierarchies('${name}')`)
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
        const attrCube = `}ElementAttributes_${dim}`
        return this.post(`Cubes('${safe(attrCube)}')/tm1.Update`, {
            Cells: [{
                'Tuple@odata.bind': [
                    `Dimensions('${safe(attrCube)}')/Hierarchies('${safe(attrCube)}')/Elements('${safe(attribute)}')`,
                    `Dimensions('${safe(dim)}')/Hierarchies('${safe(dim)}')/Elements('${safe(element)}')`,
                ]
            }],
            Value: attrType === 'N' ? Number(value) : String(value),
        })
    }

    async getElementAttributes(dim, hierarchy = dim) {
        const d = await this.get(
            `Dimensions('${dim}')/Hierarchies('${hierarchy}')/ElementAttributes`,
            { '$select': 'Name,Type' }
        )
        return d.value ?? []
    }

    async getAliasValues(dim, aliasAttr, hierarchy = dim) {
        const attrDim = `}ElementAttributes_${dim}`
        const mdx = `SELECT {[${attrDim}].[${attrDim}].[${aliasAttr}]} ON COLUMNS, {TM1SUBSETALL([${dim}].[${hierarchy}])} ON ROWS FROM [${attrDim}]`
        try {
            const result = await this.executeMDX(mdx, 200000)
            const rowTuples = result.Axes?.find(a => a.Ordinal === 1)?.Tuples ?? []
            const map = {}
            rowTuples.forEach((tuple, i) => {
                const el  = tuple.Members?.[0]?.Name
                const val = result.Cells?.[i]?.Value
                if (el && val !== null && val !== undefined && val !== '') map[el] = String(val)
            })
            return map
        } catch { return {} }
    }

    async getDimensions() {
        const d = await this.get('Dimensions', { '$select': 'Name' })
        return (d.value ?? []).map(r => r.Name).filter(n => !n.startsWith('}'))
    }

    async getControlObjects() {
        const [cubesRaw, dimsRaw, procsRaw] = await Promise.all([
            this.get('Cubes',      { '$select': 'Name' }),
            this.get('Dimensions', { '$select': 'Name' }),
            this.get('Processes',  { '$select': 'Name' }),
        ])
        return {
            cubes:      (cubesRaw.value  ?? []).map(r => r.Name).filter(n => n.startsWith('}')).sort(),
            dimensions: (dimsRaw.value   ?? []).map(r => r.Name).filter(n => n.startsWith('}')).sort(),
            processes:  (procsRaw.value  ?? []).map(r => r.Name).filter(n => n.startsWith('}')).sort(),
        }
    }

    // ── Current user ─────────────────────────────────────────────────────────

    async getCurrentUser() {
        const d = await this.get('ActiveUser')
        return d?.Name ?? null
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

    async getModelCubes() {
        const d = await this.get('ModelCubes()', { '$select': 'Name' })
        return (d.value ?? []).map(r => r.Name)
    }

    async getModelDimensions() {
        const d = await this.get('ModelDimensions()', { '$select': 'Name' })
        return (d.value ?? []).map(r => r.Name)
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
        const paramArray = Array.isArray(params)
            ? params
            : Object.entries(params).map(([Name, Value]) => ({ Name, Value: String(Value) }))
        // ExecuteWithReturn returns status + ErrorLogFile reference inline — better than tm1.Execute
        return this.post(
            `Processes('${encodeURIComponent(name)}')/tm1.ExecuteWithReturn?$expand=ErrorLogFile`,
            { Parameters: paramArray }
        )
    }

    async createOrReplaceProcess(proc) {
        // proc: { name, prolog, metadata, data, epilog, parameters }
        const body = {
            Name:               proc.name,
            PrologProcedure:    proc.prolog   ?? '',
            MetadataProcedure:  proc.metadata ?? '',
            DataProcedure:      proc.data     ?? '',
            EpilogProcedure:    proc.epilog   ?? '',
            HasSecurityAccess:  false,
            DataSource:         { Type: 'None' },
            Parameters:         (proc.parameters ?? []).map(p => ({
                Name:   p.Name,
                Type:   p.Type ?? 'String',
                Value:  String(p.Value ?? ''),
                Prompt: p.Prompt ?? '',
            })),
            Variables: [],
        }
        try {
            await this.post('Processes', body)
        } catch (e) {
            if (e.response?.status === 409 || e.response?.status === 400) {
                // PATCH is atomic — no delete+recreate risk
                await this.patch(`Processes('${encodeURIComponent(proc.name)}')`, body)
            } else {
                throw e
            }
        }
    }

    // ── Chores ────────────────────────────────────────────────────────────────

    async getChores() {
        const d = await this.get('Chores', { '$select': 'Name' })
        return (d.value ?? []).map(r => r.Name).filter(n => !n.startsWith('}'))
    }

    async getChore(name) {
        return this.get(`Chores('${encodeURIComponent(name)}')`, {
            '$expand': 'Steps($expand=Process,Parameters)'
        })
    }

    async updateChore(name, data) {
        return this.patch(`Chores('${encodeURIComponent(name)}')`, data)
    }

    async createChore(data) {
        return this.post('Chores', data)
    }

    async executeChore(name) {
        return this.post(`Chores('${encodeURIComponent(name)}')/tm1.Execute`, {})
    }

    async activateChore(name) {
        return this.patch(`Chores('${encodeURIComponent(name)}')`, { Active: true })
    }

    async deactivateChore(name) {
        return this.patch(`Chores('${encodeURIComponent(name)}')`, { Active: false })
    }

    // ── Subset usage scan ─────────────────────────────────────────────────────

    async scanSubsetUsage(dim, subsetName) {
        const cubeUsage = []
        const tiUsage   = []

        // 1. Scan cube views
        const cubes = await this.getCubes()
        for (const cube of cubes) {
            const views = await this.getViews(cube)
            for (const view of views) {
                try {
                    const v = await this.getView(cube, view)
                    if (!v || v['@odata.type']?.includes('MDXView')) continue
                    // Native view - check axes for subset references
                    const axes = ['Rows', 'Columns', 'Titles']
                    for (const axis of axes) {
                        const placements = v[axis] ?? []
                        for (const p of placements) {
                            if (p.Subset?.Name === subsetName && p.Dimension?.Name === dim) {
                                cubeUsage.push({ cube, view, axis })
                            }
                        }
                    }
                } catch { /* skip inaccessible views */ }
            }
        }

        // 2. Scan TI processes
        const processes = await this.getProcesses()
        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const safeSubset = esc(subsetName)
        const safeDim    = esc(dim)
        for (const proc of processes) {
            try {
                const p = await this.getProcess(proc)
                const code = [
                    p.PrologProcedure   ?? '',
                    p.MetaDataProcedure ?? '',
                    p.DataProcedure     ?? '',
                    p.EpilogProcedure   ?? '',
                ].join('\n')
                // Quick string test first
                if (!code.includes(subsetName)) continue
                // Check multiple usage patterns
                const patterns = [
                    // Direct subset functions: SubsetCreate, SubsetDelete, SubsetGet, etc.
                    new RegExp(`Subset[^\\s(]*\\s*\\([^)]*['"]?${safeSubset}['"]?`, 'i'),
                    // View functions referencing subset
                    new RegExp(`View[^\\s(]*\\s*\\([^)]*['"]?${safeSubset}['"]?`, 'i'),
                    // Dimension + subset as separate args
                    new RegExp(`['"]?${safeDim}['"]?,\\s*['"]?${safeSubset}['"]?`, 'i'),
                    // MDX subset reference: [Dim].[Subset] or [Dim].[Dim].[Subset]
                    new RegExp(`\\[${safeDim}\\]\\s*\.\\s*\\[${safeSubset}\\]`, 'i'),
                    // TM1SubsetToSet
                    new RegExp(`TM1SubsetToSet\\s*\\([^)]*['"]?${safeSubset}['"]?`, 'i'),
                    // ViewCreateByMDX containing subset name anywhere in MDX
                    new RegExp(`ViewCreateByMDX[^;]*${safeSubset}`, 'is'),
                    // CellClearView or similar using subset
                    new RegExp(`CellClear[^;]*${safeSubset}`, 'is'),
                ]
                const matched = patterns.some(rx => rx.test(code))
                if (matched) {
                    tiUsage.push({ process: proc })
                }
            } catch { /* skip inaccessible processes */ }
        }

        return { cubes: cubeUsage, processes: tiUsage }
    }

    async scanViewUsage(cube, viewName) {
        const tiUsage   = []
        const viewUsage = []
        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const safeView = esc(viewName)
        const safeCube = esc(cube)

        // 1. Scan TI processes
        const processes = await this.getProcesses()
        for (const proc of processes) {
            try {
                const p = await this.getProcess(proc)
                const code = [
                    p.PrologProcedure   ?? '',
                    p.MetaDataProcedure ?? '',
                    p.DataProcedure     ?? '',
                    p.EpilogProcedure   ?? '',
                ].join('\n')
                if (!code.includes(viewName)) continue
                const patterns = [
                    new RegExp(`View(?:Create|Delete|Exists|ZeroOut|Apply|Construct|Export|Import)[^;\\n]*['"]${safeView}['"]`, 'i'),
                    new RegExp(`ViewCreateByMDX[^;\\n]*['"]${safeView}['"]`, 'i'),
                    new RegExp(`ViewAdd(?:Row|Col|Sup)|ViewDimensionSet|ViewSubsetAssign[^;\\n]*['"]${safeView}['"]`, 'i'),
                    new RegExp(`Cell(?:Get|Put|Clear|Zero)View[^;\\n]*['"]${safeView}['"]`, 'i'),
                    new RegExp(`['"]${safeCube}['"][^;\\n]*['"]${safeView}['"]`, 'i'),
                    new RegExp(`['"]${safeView}['"][^;\\n]*['"]${safeCube}['"]`, 'i'),
                ]
                if (patterns.some(rx => rx.test(code))) {
                    tiUsage.push({ process: proc })
                }
            } catch { /* skip inaccessible */ }
        }

        // 2. Scan MDX views across all cubes for text references
        const cubes = await this.getCubes()
        for (const c of cubes) {
            const views = await this.getViews(c)
            for (const vMeta of views) {
                if (c === cube && vMeta.name === viewName) continue
                if (vMeta.type !== 'mdx') continue
                try {
                    const vDef = await this.getView(c, vMeta.name)
                    if (vDef?.MDX?.includes(viewName)) {
                        viewUsage.push({ cube: c, view: vMeta.name })
                    }
                } catch { /* skip */ }
            }
        }

        return { processes: tiUsage, views: viewUsage }
    }

    async scanDimensionUsage(dim) {
        const cubes = await this.getCubesForDimension(dim)
        const tiUsage = []
        const processes = await this.getProcesses()
        for (const proc of processes) {
            try {
                const p = await this.getProcess(proc)
                const code = [p.PrologProcedure ?? '', p.MetaDataProcedure ?? '', p.DataProcedure ?? '', p.EpilogProcedure ?? ''].join('\n')
                if (code.includes(dim)) tiUsage.push({ process: proc })
            } catch { /* skip */ }
        }
        return { cubes, processes: tiUsage }
    }

    async scanCubeUsage(cube) {
        const tiUsage = []
        const processes = await this.getProcesses()
        for (const proc of processes) {
            try {
                const p = await this.getProcess(proc)
                const code = [p.PrologProcedure ?? '', p.MetaDataProcedure ?? '', p.DataProcedure ?? '', p.EpilogProcedure ?? ''].join('\n')
                if (code.includes(cube)) tiUsage.push({ process: proc })
            } catch { /* skip */ }
        }
        return { processes: tiUsage }
    }

    async scanProcessUsage(processName) {
        const choreUsage = []
        const chores = await this.getChores()
        for (const choreName of chores) {
            try {
                const chore = await this.getChore(choreName)
                if ((chore.Steps ?? []).some(s => s.Process?.Name === processName)) {
                    choreUsage.push({ chore: choreName })
                }
            } catch { /* skip */ }
        }
        return { chores: choreUsage }
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
        const enc = encodeURIComponent
        // Primary: ExecuteMDXSetExpression — single call, no subset created
        try {
            const expand = `Tuples($expand=Members($select=Name,Type);$top=${limit})`
            const d = await this.post(`ExecuteMDXSetExpression?$expand=${expand}`, { MDX: mdx })
            const tuples = d.Tuples ?? d.value ?? []
            return tuples.map(t => {
                const m = t.Members?.[0] ?? {}
                return { name: m.Name, type: m.Type ?? 'Numeric' }
            }).filter(e => e.name)
        } catch {
            // Fallback: session subset (auto-expires, no cleanup risk)
            const created = await this.post(
                `Dimensions('${enc(dim)}')/Hierarchies('${enc(hierarchy)}')/tm1.CreateSessionSubset`,
                { Subset: { Expression: mdx } }
            )
            const id = created?.Name ?? created?.ID
            if (!id) throw new Error('Session subset creation returned no ID')
            const d = await this.get(
                `Dimensions('${enc(dim)}')/Hierarchies('${enc(hierarchy)}')/SessionSubsets('${enc(id)}')/Elements`,
                { '$select': 'Name,Type', '$top': limit }
            )
            return (d.value ?? []).map(e => ({ name: e.Name, type: e.Type }))
        }
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    async getViews(cube) {
        const d = await this.get(`Cubes('${cube}')/Views`)
return (d.value ?? [])
            .filter(r => !r.Name.startsWith('}'))
            .map(r => ({
                name: r.Name,
                type: r['@odata.type']?.includes('MDXView') ? 'mdx' : 'native',
            }))
    }

    async getView(cube, name) {
        try {
            return await this.get(`Cubes('${cube}')/Views('${name}')`)
        } catch (e) {
            if (e.response?.status === 404) return null
            throw e
        }
    }

    async getViewWithSubsets(cube, name) {
        // Try collection endpoint with $expand first (some TM1 versions support it)
        try {
            const d = await this.get(
                `Cubes('${cube}')/Views`,
                { '$expand': 'Rows,Columns,Titles' }
            )
            const view = (d.value ?? []).find(v => v.Name === name)
            if (view) {
                const getSubset = (placements) => {
                    if (!placements) return []
                    return placements.map(p => ({
                        dimension: p.DimensionName ?? p.Name,
                        subset:    p.SubsetName ?? p.Subset?.Name ?? null,
                    }))
                }
                return {
                    ...view,
                    _rows:    getSubset(view.Rows),
                    _columns: getSubset(view.Columns),
                    _titles:  getSubset(view.Titles),
                }
            }
        } catch (e) {
            // $expand not supported — fall through to basic getView
        }
        // Fallback: basic view definition (no axis config for native views)
        return this.getView(cube, name)
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

    async saveNativeView(cube, name, { rows, columns, titles }) {
        const esc = s => s.replace(/'/g, "''")
        const subsetRef = (dim, subset) => ({
            '@odata.type': '#ibm.tm1.api.v1.Subset',
            Name:          subset ?? '',
            Hierarchy:     { Name: dim, Dimension: { Name: dim } },
        })
        const body = {
            '@odata.type': '#ibm.tm1.api.v1.NativeView',
            Name: name,
            Rows:    rows.map(({ dimension: d, subset: s }) => ({ Subset: subsetRef(d, s) })),
            Columns: columns.map(({ dimension: d, subset: s }) => ({ Subset: subsetRef(d, s) })),
            Titles:  titles.map(({ dimension: d, subset: s, member: m }) => ({
                Subset: subsetRef(d, s),
                ...(m ? { Selected: {
                    '@odata.type': '#ibm.tm1.api.v1.Member',
                    Name:         m,
                    UniqueName:   `[${d}].[${d}].[${m}]`,
                }} : {}),
            })),
        }
        try {
            await this.patch(`Cubes('${esc(cube)}')/Views('${esc(name)}')`, body)
        } catch (e) {
            if (e.response?.status === 404) {
                await this.post(`Cubes('${esc(cube)}')/Views`, body)
            } else throw e
        }
    }

    async executeMDX(mdx, maxCells = 50_000) {
        const { ID } = await this.post('ExecuteMDX', { MDX: mdx })
        const s = await this._session()
        const h = await this._headers()
        const [axisRes, cellRes] = await Promise.all([
            s.get(this._url(`Cellsets('${ID}')/Axes`), {
                params: { '$expand': 'Tuples($expand=Members($select=Name,UniqueName,Type))' },
                headers: h,
            }),
            s.get(this._url(`Cellsets('${ID}')/Cells`), {
                params: { '$select': 'Ordinal,Value,FormattedValue,Updateable', '$top': maxCells },
                headers: h,
            }),
        ])
        try { await this.delete(`Cellsets('${ID}')`) } catch {}
        const cells = cellRes.data.value
        return { Axes: axisRes.data.value, Cells: cells, truncated: cells.length >= maxCells }
    }

    async executeView(cube, view, maxCells = 50_000) {
        const viewDef  = await this.get(`Cubes('${cube}')/Views('${view}')`)
        const { ID }   = await this.post(`Cubes('${cube}')/Views('${view}')/tm1.Execute`, {})
        const s = await this._session()
        const h = await this._headers()
        const [axisRes, cellRes] = await Promise.all([
            s.get(this._url(`Cellsets('${ID}')/Axes`), {
                params: { '$expand': 'Tuples($expand=Members($select=Name,UniqueName,Type))' },
                headers: h,
            }),
            s.get(this._url(`Cellsets('${ID}')/Cells`), {
                params: { '$select': 'Ordinal,Value,FormattedValue,Updateable', '$top': maxCells },
                headers: h,
            }),
        ])
        try { await this.delete(`Cellsets('${ID}')`) } catch {}
        const cells = cellRes.data.value
        return {
            Axes: axisRes.data.value,
            Cells: cells,
            ViewType: viewDef?.['@odata.type'] ?? null,
            truncated: cells.length >= maxCells,
        }
    }

    // ── Cell write ────────────────────────────────────────────────────────────

    // dimElemPairs: [{ dim, element }, ...] — one entry per cube dimension, in order
    async writeCellValue(cube, dimElemPairs, value) {
        const enc = encodeURIComponent
        const esc = s => s.replace(/'/g, "''")
        const body = {
            Cells: [{
                'Tuple@odata.bind': dimElemPairs.map(({ dim, element }) =>
                    `Dimensions('${esc(dim)}')/Hierarchies('${esc(dim)}')/Elements('${esc(element)}')`
                ),
            }],
            Value: value,
        }
        return this.post(`Cubes('${enc(cube)}')/tm1.Update`, body)
    }

    async createCube(name, dims) {
        const esc = s => s.replace(/'/g, "''")
        return this.post('Cubes', {
            Name: name,
            'Dimensions@odata.bind': dims.map(d => `Dimensions('${esc(d)}')`),
        })
    }

    // ── Jobs ──────────────────────────────────────────────────────────────────

    async getJobs() {
        const d = await this.get('Jobs', { '$expand': '*' })
        return d.value ?? []
    }

    async cancelJob(id) {
        return this.post(`Jobs('${encodeURIComponent(id)}')/tm1.Cancel`, {})
    }

    // ── Bulk cell write ───────────────────────────────────────────────────────

    // updates: [{ dimElemPairs: [{dim, element}, ...], value }, ...]
    async updateCells(cube, updates) {
        const esc = s => s.replace(/'/g, "''")
        const enc = encodeURIComponent
        const body = {
            Updates: updates.map(u => ({
                'Tuple@odata.bind': u.dimElemPairs.map(({ dim, element }) =>
                    `Dimensions('${esc(dim)}')/Hierarchies('${esc(dim)}')/Elements('${esc(element)}')`
                ),
                Value: u.value,
            })),
        }
        return this.post(`Cubes('${enc(cube)}')/tm1.UpdateCells`, body)
    }

    // ── Cell calculation trace ────────────────────────────────────────────────

    // dimElemPairs: [{ dim, element }, ...] — one per cube dimension in order
    async traceCellCalculation(cube, dimElemPairs) {
        const esc = s => s.replace(/'/g, "''")
        const enc = encodeURIComponent
        const select = 'Type,Value,Statements,Components/Type,Components/Value,Components/Statements,Components/Components/Value'
        const expand = [
            'Components/Cube($select=Name)',
            'Components/Tuple($select=Name,Type,UniqueName;$expand=Hierarchy($expand=Dimension))',
            'Tuple($select=Name,Type,UniqueName;$expand=Hierarchy($expand=Dimension))',
        ].join(',')
        return this.post(
            `Cubes('${enc(cube)}')/tm1.TraceCellCalculation?$select=${select}&$expand=${expand}`,
            {
                'Tuple@odata.bind': dimElemPairs.map(({ dim, element }) =>
                    `Dimensions('${esc(dim)}')/Hierarchies('${esc(dim)}')/Elements('${esc(element)}')`
                ),
            }
        )
    }

    // ── Transaction log ───────────────────────────────────────────────────────

    // elements: array of element names in cube dimension order (nulls = unfiltered)
    async getTransactionLog(cube, { top = 200, elements = null } = {}) {
        const esc = s => String(s).replace(/'/g, "''")
        let filter = `Cube eq '${esc(cube)}'`
        if (Array.isArray(elements)) {
            elements.forEach((el, i) => {
                if (el != null && el !== '') filter += ` and Element${i + 1} eq '${esc(el)}'`
            })
        }
        const d = await this.get('TransactionLogEntries', {
            '$filter':  filter,
            '$top':     top,
            '$orderby': 'TimeStamp desc',
        })
        return d.value ?? []
    }

    // ── Process error logs ────────────────────────────────────────────────────

    async getErrorLogFiles() {
        const d = await this.get('ErrorLogFiles', { '$select': 'Filename,LastUpdated' })
        return d.value ?? []
    }

    async getErrorLogContent(filename) {
        const d = await this.get(`ErrorLogFiles('${encodeURIComponent(filename)}')/Content`)
        return typeof d === 'string' ? d : (d?.value ?? '')
    }

    // ── File management ───────────────────────────────────────────────────────

    // pathParts: ['Files'] for root, ['Files','data'] for a subfolder
    _contentsPath(pathParts) {
        return pathParts.map(p => `Contents('${encodeURIComponent(p)}')`).join('/')
    }

    async listFiles(pathParts = ['Files']) {
        const d = await this.get(`${this._contentsPath(pathParts)}/Contents`)
        return (d.value ?? []).map(item => ({
            name:     item.Name,
            isFolder: item['@odata.type']?.includes('Folder') ?? false,
            size:     item.Size ?? null,
        }))
    }

    async getFileContent(pathParts, name) {
        return this.get(`${this._contentsPath(pathParts)}/Contents('${encodeURIComponent(name)}')/Content`)
    }

    async createFileDocument(pathParts, name) {
        return this.post(`${this._contentsPath(pathParts)}/Contents`, {
            '@odata.type': '#ibm.tm1.api.v1.Document',
            Name: name,
        })
    }

    async putFileContent(pathParts, name, buffer) {
        return this.put(
            `${this._contentsPath(pathParts)}/Contents('${encodeURIComponent(name)}')/Content`,
            buffer,
            'application/octet-stream'
        )
    }

    async deleteFile(pathParts, name) {
        return this.delete(`${this._contentsPath(pathParts)}/Contents('${encodeURIComponent(name)}')`)
    }

    // ── Sessions ──────────────────────────────────────────────────────────────

    async getSessions() {
        const d = await this.get('Sessions', { '$expand': '*' })
        return d.value ?? []
    }

    async disconnectSession(id) {
        return this.delete(`Sessions('${encodeURIComponent(id)}')`)
    }

    // ── Server admin ──────────────────────────────────────────────────────────

    async getMetrics(cube = null) {
        const params = cube ? { '$filter': `CubeName eq '${cube}'` } : { '$filter': '(CubeName eq null)' }
        return this.get('Metrics()', params)
    }

    async getActiveConfiguration() {
        return this.get('ActiveConfiguration')
    }

    async patchStaticConfiguration(section, values) {
        return this.patch(`StaticConfiguration/${section}`, values)
    }

    async enableMaintenanceMode() {
        return this.post('tm1s.EnableMaintenanceMode', {})
    }

    async disableMaintenanceMode() {
        return this.post('tm1s.DisableMaintenanceMode', {})
    }
}

module.exports = { TM1Client }
