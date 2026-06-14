'use strict'

require('dotenv').config()

const express   = require('express')
const path      = require('path')
const fs        = require('fs')
const Anthropic = require('@anthropic-ai/sdk')
const { TM1Client } = require('./core/tm1_client')
const { loadConnections, saveConnections, getConnection, executeQuery, testConnection, getSchema, loadQueries, saveQueries } = require('./core/sql_client')
const { getCachedPawSession, getCSRF, PAW_HOST } = require('./core/paw_connect')
const cl = require('./core/change_log')
const { diff: deployDiff }      = require('./tools/tm1deploy/src/diff')
const { pack: deployPack }      = require('./tools/tm1deploy/src/packager')
const { analyzeRisk }           = require('./tools/tm1deploy/src/risk')
const { deploy: deployExecute } = require('./tools/tm1deploy/src/deployer')
const { seed: deploySeed }      = require('./tools/tm1deploy/src/snapshot')
const { BASELINE_PATH }         = require('./tools/tm1deploy/src/diff')

const FORGE_PATH = path.join(__dirname, 'config', 'forge.json')

const anthropic = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY })

const app  = express()
const PORT = process.env.PORT || 8083

app.use(express.json({ limit: '10mb' }))
app.use(express.static(path.join(__dirname, 'static'), {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store')
    }
}))

// ── Change log / Sessions ─────────────────────────────────────────────────────
app.post('/api/sessions/start', (req, res) => {
    try {
        const { name, server, user } = req.body
        if (!name?.trim() || !server) return res.status(400).json({ error: 'name and server required' })
        const session = cl.startSession(name.trim(), server, user)
        res.json(session)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sessions/close', (req, res) => {
    try {
        const { id } = req.body
        if (!id) return res.status(400).json({ error: 'id required' })
        res.json(cl.closeSession(id))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sessions/resume', (req, res) => {
    try {
        const { id } = req.body
        if (!id) return res.status(400).json({ error: 'id required' })
        res.json(cl.resumeSession(id))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions/active', (req, res) => {
    try { res.json(cl.getActiveSession(req.query.server) ?? null) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions', (req, res) => {
    try { res.json(cl.getSessions(req.query.server)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions/:id/log', (req, res) => {
    try { res.json(cl.getSessionLog(req.params.id)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/log/recent', (req, res) => {
    try { res.json(cl.getRecentLog(req.query.server)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/log/object', (req, res) => {
    try { res.json(cl.getObjectHistory(req.query.server, req.query.type, req.query.name)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/log/rollback', async (req, res) => {
    try {
        const { entryId, server } = req.body
        const entry = cl.getEntryById(entryId)
        if (!entry)              return res.status(404).json({ error: 'Entry not found' })
        if (!entry.before_state) return res.status(400).json({ error: 'No before state captured for this entry' })

        const before = entry.before_state
        const client = new TM1Client(server)
        const enc    = encodeURIComponent

        if (entry.object_type === 'rules') {
            await client.patch(`Cubes('${enc(entry.object_name)}')`, { Rules: before.text ?? '' })
        } else if (entry.object_type === 'process') {
            await client.patch(`Processes('${enc(entry.object_name)}')`, {
                PrologProcedure:   before.prolog   ?? '',
                MetadataProcedure: before.metadata ?? '',
                DataProcedure:     before.data     ?? '',
                EpilogProcedure:   before.epilog   ?? '',
            })
        } else if (entry.object_type === 'subset') {
            if (before.expression != null) {
                await client.saveSubset(entry.detail, entry.object_name, before.expression)
            } else if (before.elements) {
                await client.saveStaticSubset(entry.detail, entry.object_name, before.elements)
            }
        } else if (entry.object_type === 'view' && before.type === 'mdx') {
            await client.saveView(entry.detail, entry.object_name, before.mdx)
        }

        cl.writeLog({ server, action: 'ROLLED_BACK', objectType: entry.object_type, objectName: entry.object_name, detail: entry.detail })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Servers ───────────────────────────────────────────────────────────────────
app.get('/api/servers', (req, res) => {
    try {
        const servers = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'servers.json'), 'utf-8'))
        res.json(servers.map(s => s.name))
    } catch {
        res.json([])
    }
})

// ── Cubes ─────────────────────────────────────────────────────────────────────
app.get('/api/cubes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getCubes())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Dimensions ────────────────────────────────────────────────────────────────
app.post('/api/dimension/create', async (req, res) => {
    try {
        const { server, name } = req.body
        await new TM1Client(server).createDimension(name)
        const { hasSession } = cl.writeLog({ server, action: 'DIMENSION_CREATED', objectType: 'dimension', objectName: name })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// Bulk import: rows = [{ name, type, parent, weight }]
app.post('/api/dimension/bulk-import', async (req, res) => {
    try {
        const { server, dimension, hierarchy = dimension, rows } = req.body
        const client = new TM1Client(server)
        const errors = []

        // Pass 1: create all elements in one bulk call
        const validRows = rows.filter(r => r.name?.trim())
        if (validRows.length) {
            try {
                await client.bulkSetElements(dimension, validRows.map(r => ({ name: r.name.trim(), type: r.type || 'N' })), hierarchy)
            } catch (e) {
                errors.push(`Bulk element create: ${e.message}`)
            }
        }

        // Pass 2: create edges (no bulk API — sequential)
        for (const row of rows) {
            if (!row.name?.trim() || !row.parent?.trim()) continue
            try { await client.addEdge(dimension, row.parent.trim(), row.name.trim(), row.weight ?? 1, hierarchy) } catch (e) {
                if (!e.message?.includes('already exists')) errors.push(`${row.parent}→${row.name}: ${e.message}`)
            }
        }
        res.json({ ok: true, errors })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// Bulk attribute import: rows = [{ element, attrName, value }]
app.post('/api/dimension/bulk-attr-import', async (req, res) => {
    try {
        const { server, dimension, hierarchy = dimension, rows } = req.body
        const client = new TM1Client(server)
        const errors = []
        for (const row of rows) {
            if (!row.element?.trim() || !row.attrName?.trim()) continue
            try { await client.writeElementAttribute(dimension, row.element.trim(), row.attrName.trim(), row.value ?? '', row.type || 'S', hierarchy) }
            catch (e) { errors.push(`${row.element}[${row.attrName}]: ${e.message}`) }
        }
        res.json({ ok: true, errors })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimensions', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getDimensions())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/dimension', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteDimension(req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'DIMENSION_DELETED', objectType: 'dimension', objectName: req.query.name })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/cube', async (req, res) => {
    try {
        const { server, name, dims } = req.body
        if (!server || !name?.trim() || !Array.isArray(dims) || dims.length < 2)
            return res.status(400).json({ error: 'Name and at least 2 dimensions are required' })
        const client = new TM1Client(server)
        await client.createCube(name.trim(), dims)
        const { hasSession } = cl.writeLog({ server, action: 'CUBE_CREATED', objectType: 'cube', objectName: name.trim() })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        console.error('[view/save] error:', e.message, 'data:', JSON.stringify(e.response?.data).slice(0, 300))
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.delete('/api/cube', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteCube(req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'CUBE_DELETED', objectType: 'cube', objectName: req.query.name })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/subset', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteSubset(req.query.dimension, req.query.name, req.query.hierarchy)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'SUBSET_DELETED', objectType: 'subset', objectName: req.query.name, detail: req.query.dimension })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Processes ─────────────────────────────────────────────────────────────────
app.get('/api/processes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        if (req.query.datasource === 'odbc') {
            const d = await client.get('Processes', { '$select': 'Name,DataSource' })
            const names = (d.value ?? [])
                .filter(p => !p.Name.startsWith('}') && p.DataSource?.Type === 'ODBC')
                .map(p => p.Name)
            return res.json(names)
        }
        res.json(await client.getProcesses())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/process', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteProcess(req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'PROCESS_DELETED', objectType: 'process', objectName: req.query.name })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Chores ────────────────────────────────────────────────────────────────────
app.get('/api/chores', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getChores())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/chore', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getChore(req.query.name))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/chore', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.updateChore(req.query.name, req.body)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/chore', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteChore(req.query.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Rules ─────────────────────────────────────────────────────────────────────
app.get('/api/rules', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const cube   = await client.getCube(req.query.cube)
        res.json({ rules: cube?.Rules ?? '' })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/rules', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const current     = await client.getCube(req.query.cube).catch(() => null)
        const beforeState = { text: current?.Rules ?? '' }
        await client.patch(`Cubes('${req.query.cube}')`, { Rules: req.body.rules })
        const afterState  = { text: req.body.rules }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'RULES_SAVED', objectType: 'rules', objectName: req.query.cube, beforeState, afterState })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/rules/check', async (req, res) => {
    try {
        const { server, cube, rules } = req.body
        const client = new TM1Client(server)
        const enc = encodeURIComponent
        const result = await client.post(`Cubes('${enc(cube)}')/tm1.CheckRules`, { Rules: rules })
        res.json({ errors: result.value ?? [] })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── Process detail + execute ──────────────────────────────────────────────────
app.get('/api/process', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getProcess(req.query.name))
    } catch (e) {
        console.error('[api/process] GET failed:', e.response?.status, e.response?.data?.error?.message || e.message)
        res.status(500).json({ error: e.message })
    }
})

// TM1 REST API rejects newlines inside open parentheses (multi-line TI expressions).
// Merge any continuation line into the preceding line so the code round-trips safely.
const HANGING_KW = /\b(IF|WHILE|ELSEIF)\s*$/i
function joinContinuations(code) {
    let out = '', depth = 0, inStr = false, lineBuffer = ''
    for (let i = 0; i < code.length; i++) {
        const ch = code[i]
        if (inStr) {
            if (ch === "'") {
                if (code[i + 1] === "'") { out += "''"; lineBuffer += "''"; i++ }
                else { inStr = false; out += ch; lineBuffer += ch }
            } else { out += ch; lineBuffer += ch }
        } else {
            if (ch === '#') {
                out += '#'
                while (i + 1 < code.length && code[i + 1] !== '\n') { out += code[++i] }
            }
            else if (ch === "'") { inStr = true; out += ch; lineBuffer += ch }
            else if (ch === '(') { depth++; out += ch; lineBuffer += ch }
            else if (ch === ')') { depth--; out += ch; lineBuffer += ch }
            else if (ch === '\n') {
                // Join if inside open paren OR previous line ends with IF/WHILE/ELSEIF
                out += (depth > 0 || HANGING_KW.test(lineBuffer)) ? ' ' : '\n'
                lineBuffer = ''
            }
            else { out += ch; lineBuffer += ch }
        }
    }
    return out
}

app.post('/api/process/debug', async (req, res) => {
    const { server, name, params, sections, watches, breakpoints } = req.body
    const client   = new TM1Client(server)
    const tempName = `_IDE_Debug_${Date.now()}`
    let log = '', runError = null

    // ── 1. Fetch source process metadata ─────────────────────────────────────
    let proc
    try {
        proc = await client.get(`Processes('${encodeURIComponent(name)}')`)
    } catch (e) {
        return res.status(500).json({ error: `Failed to create debug process: ${e.message}` })
    }

    const stripMeta   = obj => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('@')))
    const nl          = s   => (s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const jc          = s   => joinContinuations(nl(s))
    const cleanParams = (proc.Parameters ?? []).map(p => ({
        Name: p.Name, Type: p.Type ?? 2, Value: String(p.Value ?? ''), Prompt: p.Prompt ?? '',
    }))

    // ── 2. Ensure __DBG_LOG attribute exists ──────────────────────────────────
    const ATTR         = '__DBG_LOG'
    const safeProcName = name.replace(/'/g, "''")
    const hasCapture   = (watches?.length > 0) || Object.values(breakpoints ?? {}).some(a => a.length > 0)

    if (hasCapture) {
        try {
            await client.post(
                `Dimensions('%7DProcesses')/Hierarchies('%7DProcesses')/ElementAttributes`,
                { Name: ATTR, Type: 'String' }
            )
        } catch (e) { /* 409 = already exists — fine */ }
        try {
            await client.post('ExecuteProcessWithReturn?$expand=*', {
                Process: {
                    Name: '_IDE_ClearDbg',
                    PrologProcedure: `AttrPutS('', '}Processes', '${safeProcName}', '${ATTR}');`,
                    MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
                    HasSecurityAccess: false, DataSource: { Type: 'None' },
                    Parameters: [], Variables: [],
                }
            })
        } catch (e) {
            console.warn('[debug] could not clear __DBG_LOG:', e.message)
        }
    }

    // ── 3. Instrument sections ────────────────────────────────────────────────
    function appendLines(label, lineNum, sectionLabel) {
        const AT = safeProcName
        const lines = [`sDBGLog__IDE__ = ATTRS('}Processes', '${AT}', '${ATTR}');`]
        lines.push(`sDBGLog__IDE__ = sDBGLog__IDE__ | '${label}' | CHAR(10);`)
        for (const w of (watches ?? [])) {
            const val = w.type === 'number' ? `NumberToString(${w.name})` : w.name
            lines.push(`sDBGLog__IDE__ = sDBGLog__IDE__ | '__DBG_VAR:${w.name}__${sectionLabel}__${lineNum}=' | ${val} | CHAR(10);`)
        }
        lines.push(`AttrPutS(sDBGLog__IDE__, '}Processes', '${AT}', '${ATTR}');`)
        return lines
    }

    function instrumentSection(rawCode, sectionKey, sectionLabel) {
        const code  = jc(rawCode ?? '')
        const bpSet = new Set(breakpoints?.[sectionKey] ?? [])
        if (!watches?.length && !bpSet.size) return code

        const lines  = code.split('\n')
        const result = []
        let parenDepth = 0, inStr = false

        const trackDepth = (line) => {
            for (let j = 0; j < line.length; j++) {
                const ch = line[j]
                if (inStr) {
                    if (ch === "'") { if (line[j + 1] === "'") j++; else inStr = false }
                } else {
                    if      (ch === '#')  break
                    else if (ch === "'")  inStr = true
                    else if (ch === '(')  parenDepth++
                    else if (ch === ')')  parenDepth--
                }
            }
        }

        let prevDepth = 0
        for (let i = 0; i < lines.length; i++) {
            const lineNum   = i + 1
            const prevLine  = i > 0 ? lines[i - 1] : ''
            const canInject = prevDepth === 0 && !/^\s*(IF|WHILE|ELSEIF)\s*$/i.test(prevLine)
            if (bpSet.has(lineNum) && canInject) {
                result.push(...appendLines(`__DBG_BP:${lineNum}:${sectionLabel}`, lineNum, sectionLabel))
            }
            result.push(lines[i])
            trackDepth(lines[i])
            prevDepth = parenDepth
        }

        return result.join('\n')
    }

    // ── 4. Create temp process with instrumented code ────────────────────────
    const prologInst = instrumentSection(sections.PrologProcedure,   'PrologProcedure',   'Prolog')
    const metaInst   = (sections.MetaDataProcedure ?? '').trim()
        ? instrumentSection(sections.MetaDataProcedure, 'MetaDataProcedure', 'Metadata')
        : (jc(sections.MetaDataProcedure ?? ''))
    const dataInst   = (sections.DataProcedure ?? '').trim()
        ? instrumentSection(sections.DataProcedure,     'DataProcedure',     'Data')
        : (jc(sections.DataProcedure ?? ''))
    const epilInst   = (sections.EpilogProcedure ?? '').trim()
        ? instrumentSection(sections.EpilogProcedure,   'EpilogProcedure',   'Epilog')
        : (jc(sections.EpilogProcedure ?? ''))

    // ── 4. Create temp process with instrumented code ────────────────────────
    try {
        await client.createOrReplaceProcess({
            name:       tempName,
            prolog:     prologInst,
            metadata:   metaInst,
            data:       dataInst,
            epilog:     epilInst,
            parameters: cleanParams,
        })
    } catch (e) {
        return res.status(500).json({ error: `Failed to create debug process: ${e.message}` })
    }

    // ── 5. Execute ─────────────────────────────────────────────────────────────
    try {
        await client.executeProcess(tempName, params ?? [])
    } catch (e) {
        const data  = e.response?.data
        const inner = data?.error?.innererror ?? {}
        const procErr = data?.error?.details?.ProcessError ?? ''
        console.error('[debug] execute error:', e.response?.status, JSON.stringify(data ?? e.message).slice(0, 400))
        runError = procErr || inner.Message || data?.error?.message || e.message
    }

    // ── 6. Read captured log via MDX ──────────────────────────────────────────
    if (hasCapture) {
        try {
            const mdxMember = name.replace(/\]/g, ']]')
            const mdx = [
                `SELECT {[}ElementAttributes_}Processes].[}ElementAttributes_}Processes].[${ATTR}]} ON COLUMNS,`,
                `{[}Processes].[}Processes].[${mdxMember}]} ON ROWS`,
                `FROM [}ElementAttributes_}Processes]`,
            ].join(' ')
            const result  = await client.executeMDX(mdx)
            const attrLog = (result?.Cells?.[0]?.Value ?? '').replace(/\r/g, '')
            console.log('[debug] MDX raw:', JSON.stringify(attrLog).slice(0, 300))
            if (attrLog.includes('__DBG_BP:')) {
                log      = attrLog + '\n__DBG_DONE:ok'
                runError = null
            }
        } catch (e) {
            console.error('[debug] MDX read failed:', e.message)
        }
    } else if (!runError) {
        log = '__DBG_DONE:ok'
    }

    try { await client.deleteProcess(tempName) }
    catch (e) { console.error('[debug] cleanup failed:', e.message) }

    res.json({ log, error: runError, noCapture: !hasCapture && !runError })
})

app.get('/api/processes/search', async (req, res) => {
    try {
        const { server, q } = req.query
        if (!q || q.length < 2) return res.json({ results: [] })
        const client = new TM1Client(server)
        const data = await client.get('Processes', {
            '$select': 'Name,PrologProcedure,MetaDataProcedure,DataProcedure,EpilogProcedure',
        })
        const lower = q.toLowerCase()
        const sections = [
            { key: 'PrologProcedure',   label: 'Prolog'   },
            { key: 'MetaDataProcedure', label: 'Metadata' },
            { key: 'DataProcedure',     label: 'Data'     },
            { key: 'EpilogProcedure',   label: 'Epilog'   },
        ]
        const results = []
        for (const proc of (data.value ?? [])) {
            if (proc.Name.startsWith('}')) continue
            for (const { key, label } of sections) {
                const lines = (proc[key] ?? '').split('\n')
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(lower)) {
                        results.push({ process: proc.Name, section: label, line: i + 1, preview: lines[i].trim().slice(0, 150) })
                    }
                }
            }
        }
        res.json({ results })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/process/log', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const result = await client.get(`Processes('${encodeURIComponent(req.query.name)}')/ErrorLog`)
        const log = typeof result === 'string' ? result : (result?.value ?? '')
        res.json({ log })
    } catch (e) {
        res.json({ log: '' })
    }
})

app.post('/api/process/create', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.post('Processes', {
            Name: req.query.name,
            PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
            DataSource: { Type: 'None' },
            Parameters: [],
            Variables: [],
        })
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'PROCESS_CREATED', objectType: 'process', objectName: req.query.name })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/process', async (req, res) => {
    try {
        const client  = new TM1Client(req.query.server)
        const current = await client.getProcess(req.query.name).catch(() => null)
        const beforeState = current ? {
            prolog:   current.PrologProcedure                             ?? '',
            metadata: current.MetaDataProcedure ?? current.MetadataProcedure ?? '',
            data:     current.DataProcedure                               ?? '',
            epilog:   current.EpilogProcedure                             ?? '',
        } : null
        const body = { ...req.body }
        if ('MetaDataProcedure' in body) {
            body.MetadataProcedure = body.MetaDataProcedure
            delete body.MetaDataProcedure
        }
        await client.patch(`Processes('${req.query.name}')`, body)
        const afterState = {
            prolog:   req.body.PrologProcedure                                       ?? beforeState?.prolog   ?? '',
            metadata: req.body.MetaDataProcedure ?? req.body.MetadataProcedure       ?? beforeState?.metadata ?? '',
            data:     req.body.DataProcedure                                         ?? beforeState?.data     ?? '',
            epilog:   req.body.EpilogProcedure                                       ?? beforeState?.epilog   ?? '',
        }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'PROCESS_SAVED', objectType: 'process', objectName: req.query.name, beforeState, afterState })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        console.error('[api/process] SAVE failed:', e.response?.status, e.response?.data?.error?.message || e.message)
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/process/run', async (req, res) => {
    const client   = new TM1Client(req.query.server)
    const procName = req.query.name
    const RUN_ATTR = '__RUN_LOG'
    const safeName = procName.replace(/'/g, "''")

    // ── 1. Ensure __RUN_LOG attribute exists and is cleared ──────────────────
    try {
        await client.post(
            `Dimensions('%7DProcesses')/Hierarchies('%7DProcesses')/ElementAttributes`,
            { Name: RUN_ATTR, Type: 'String' }
        )
    } catch (_) { /* 409 = already exists — fine */ }
    try {
        await client.post('ExecuteProcessWithReturn?$expand=*', {
            Process: {
                Name: '_IDE_ClearRunLog',
                PrologProcedure: `AttrPutS('', '}Processes', '${safeName}', '${RUN_ATTR}');`,
                MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
                HasSecurityAccess: false, DataSource: { Type: 'None' },
                Parameters: [], Variables: [],
            }
        })
    } catch (_) { /* non-critical */ }

    // ── 2. Execute the process ────────────────────────────────────────────────
    let duration = null, runError = null, errorSection = null, errorLine = null, errorLogFilename = null
    try {
        const result = await client.executeProcess(procName, req.body.params ?? [])
        duration         = result?.Times?.ExecutionTimeInMilliseconds ?? null
        errorLogFilename = result?.ErrorLogFile?.Filename ?? null
    } catch (e) {
        const inner = e.response?.data?.error?.innererror ?? {}
        console.error('[process/run]', JSON.stringify(inner) || e.message)
        runError         = inner.Message || e.message
        errorSection     = inner.ProcedureSection ?? null
        errorLine        = inner.LineNumber ?? null
        // ErrorLogFile may be in the error response body
        errorLogFilename = e.response?.data?.error?.innererror?.ErrorLogFile?.Filename
                        ?? e.response?.data?.ErrorLogFile?.Filename
                        ?? null
    }

    // ── 3. Read __RUN_LOG back via MDX ────────────────────────────────────────
    let runLog = ''
    try {
        const mdxMember = procName.replace(/\]/g, ']]')
        const mdx = [
            `SELECT {[}ElementAttributes_}Processes].[}ElementAttributes_}Processes].[${RUN_ATTR}]} ON COLUMNS,`,
            `{[}Processes].[}Processes].[${mdxMember}]} ON ROWS`,
            `FROM [}ElementAttributes_}Processes]`,
        ].join(' ')
        const mdxResult = await client.executeMDX(mdx)
        runLog = (mdxResult?.Cells?.[0]?.Value ?? '').replace(/\r/g, '')
        console.log(`[process/run] __RUN_LOG MDX result: "${runLog.slice(0, 200)}"`)
    } catch (e) {
        console.error('[process/run] __RUN_LOG MDX failed:', e.message)
    }

    // ── 4. Fallback: if no __RUN_LOG and process errored, use TM1 ErrorLog ────
    if (!runLog && runError) {
        console.log('[process/run] __RUN_LOG empty, trying ErrorLog fallback')
        try {
            const errLog = await client.get(`Processes('${encodeURIComponent(procName)}')/ErrorLog`)
            runLog = typeof errLog === 'string' ? errLog : (errLog?.value ?? '')
            console.log(`[process/run] ErrorLog result: "${String(runLog).slice(0, 200)}"`)
        } catch (e) {
            console.error('[process/run] ErrorLog fallback failed:', e.message)
        }
    }

    // ── 5. Detect __ERROR: validation marker (written before ProcessQuit) ────────
    if (!runError && runLog.startsWith('__ERROR:')) {
        const msg = runLog.replace(/^__ERROR:/, '').trim()
        console.log(`[process/run] validation quit detected: "${msg}"`)
        return res.status(500).json({ error: msg, section: null, line: null, runLog: msg })
    }

    console.log(`[process/run] final runLog length: ${runLog.length}, runError: ${!!runError}`)
    if (runError) {
        res.status(500).json({ error: runError, section: errorSection, line: errorLine, runLog, errorLogFilename })
    } else {
        res.json({ ok: true, duration, runLog, errorLogFilename })
    }
})

// ── Cube dimensions ───────────────────────────────────────────────────────────
app.get('/api/cube/dimensions', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const cube   = await client.getCube(req.query.cube)
        const dims   = (cube?.Dimensions ?? []).map(d => d.Name)
        res.json(dims)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Dimension attributes ──────────────────────────────────────────────────────
app.get('/api/dimension/attributes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const attrs  = await client.getElementAttributes(req.query.dimension)
        res.json(attrs.map(a => ({ name: a.Name, type: a.Type })))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimension/alias-values', async (req, res) => {
    try {
        const { server, dimension, alias } = req.query
        const client = new TM1Client(server)
        res.json(await client.getAliasValues(dimension, alias))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimension/cubes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getCubesForDimension(req.query.dimension))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Attribute grid (all elements × all attrs in one response) ─────────────────
app.get('/api/dimensions/format-attrs', async (req, res) => {
    try {
        const { server, dims } = req.query
        const dimensions = dims ? dims.split(',').filter(Boolean) : []
        if (!dimensions.length) return res.json({})
        const client = new TM1Client(server)
        const maps = await Promise.all(dimensions.map(async dim => {
            const mdxResult = await client.getAliasValues(dim, 'Format', dim).catch(() => null)
            if (mdxResult && Object.keys(mdxResult).length > 0) {
                return mdxResult
            }
            const restResult = await client.getFormatAttrs(dim, dim).catch(() => ({}))
            return restResult
        }))
        res.json(Object.assign({}, ...maps))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimension/attr-grid', async (req, res) => {
    try {
        const { server, dimension, hierarchy } = req.query
        const client = new TM1Client(server)
        const [attrs, elements, edges] = await Promise.all([
            client.getElementAttributes(dimension, hierarchy),
            client.getElements(dimension, hierarchy),
            client.getEdges(dimension, hierarchy),
        ])
        const valueEntries = await Promise.all(
            elements.map(async el => {
                try { return [el.Name, await client.getElementAttributeValues(dimension, el.Name, hierarchy)] }
                catch  { return [el.Name, {}] }
            })
        )
        res.json({ attrs, elements, edges, values: Object.fromEntries(valueEntries) })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/dimension/attribute-def', async (req, res) => {
    try {
        const { server, dimension, name, type, hierarchy } = req.body
        await new TM1Client(server).createElementAttribute(dimension, name, type, hierarchy)
        const { hasSession } = cl.writeLog({ server, action: 'ATTRIBUTE_CREATED', objectType: 'attribute', objectName: name, detail: dimension })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/dimension/attribute-def', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        await new TM1Client(server).deleteElementAttribute(dimension, name, hierarchy)
        const { hasSession } = cl.writeLog({ server, action: 'ATTRIBUTE_DELETED', objectType: 'attribute', objectName: name, detail: dimension })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/element/attribute', async (req, res) => {
    try {
        const { server, dimension, element, attribute, value, type, hierarchy } = req.body
        await new TM1Client(server).writeElementAttribute(dimension, element, attribute, value, type, hierarchy)
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Views ─────────────────────────────────────────────────────────────────────
app.get('/api/views', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getViews(req.query.cube))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/view', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getView(req.query.cube, req.query.name))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/view/execute', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.executeView(req.query.cube, req.query.view))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/view/save', async (req, res) => {
    try {
        const { server, cube, name } = req.query
        const { mdx, nativeAxes } = req.body
        const client  = new TM1Client(server)
        const current = await client.getView(cube, name).catch(() => null)
        const beforeState = current
            ? current['@odata.type']?.includes('MDXView')
                ? { type: 'mdx', mdx: current.MDX ?? '' }
                : { type: 'native', definition: current }
            : null
        if (nativeAxes) {
            console.log('[view/save] cube=%s name=%s nativeAxes=%s', cube, name, JSON.stringify(nativeAxes).slice(0, 500))
            await client.saveNativeView(cube, name, nativeAxes)
        } else {
            console.log('[view/save] cube=%s name=%s mdx=%s', cube, name, (mdx ?? '').slice(0, 300))
            await client.saveView(cube, name, mdx)
        }
        const afterState = nativeAxes ? { type: 'native', definition: nativeAxes } : { type: 'mdx', mdx: mdx ?? '' }
        const { hasSession } = cl.writeLog({ server, action: 'VIEW_SAVED', objectType: 'view', objectName: name, detail: cube, beforeState, afterState })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.post('/api/view/set-default', async (req, res) => {
    try {
        const { server, cube, name } = req.query
        const client = new TM1Client(server)
        await client.setDefaultView(cube, name)
        res.json({ ok: true, noSession: false })
    } catch (e) {
        console.error('[set-default]', e.message, e.response?.status, e.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : '')
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/view', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteView(req.query.cube, req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'VIEW_DELETED', objectType: 'view', objectName: req.query.name, detail: req.query.cube })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Elements ──────────────────────────────────────────────────────────────────
app.get('/api/elements', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getElements(req.query.dimension, req.query.hierarchy, req.query.index === '1'))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/elements/tree', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const result = await client.getElementsWithTree(req.query.dimension, req.query.hierarchy)
        const sample = result.slice(0, 3)
        console.log('[elements/tree] count:', result.length, 'sample:', JSON.stringify(sample))
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/elements/attributes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getElementsWithAttributes(req.query.dimension, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/element/attributes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getElementAttributeValues(req.query.dimension, req.query.element, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/edges', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getEdges(req.query.dimension, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Attribute debug — try multiple approaches to see what PAW returns ─────────
app.get('/api/debug/element-attrs', async (req, res) => {
    const { server, dimension } = req.query
    const client = new TM1Client(server)
    const results = {}

    // Approach A: $expand=Attributes on elements collection
    try {
        results.expandOnCollection = await client.get(
            `Dimensions('${dimension}')/Hierarchies('${dimension}')/Elements`,
            { '$expand': 'Attributes', '$top': '2' }
        )
    } catch (e) { results.expandOnCollection = { error: e.message, status: e.response?.status } }

    // Approach B: fetch first element's /Attributes sub-resource directly
    try {
        const els = await client.get(
            `Dimensions('${dimension}')/Hierarchies('${dimension}')/Elements`,
            { '$select': 'Name', '$top': '1' }
        )
        const firstName = els.value?.[0]?.Name
        if (firstName) {
            results.firstElementName = firstName
            results.directSubResource = await client.get(
                `Dimensions('${dimension}')/Hierarchies('${dimension}')/Elements('${firstName}')/Attributes`
            )
        }
    } catch (e) { results.directSubResource = { error: e.message, status: e.response?.status } }

    // Approach C: ElementAttributes (attribute definitions)
    try {
        results.attrDefinitions = await client.get(
            `Dimensions('${dimension}')/Hierarchies('${dimension}')/ElementAttributes`,
            { '$select': 'Name,Type', '$top': '10' }
        )
    } catch (e) { results.attrDefinitions = { error: e.message, status: e.response?.status } }

    res.json(results)
})

// ── Attribute write probe ─────────────────────────────────────────────────────
app.post('/api/test/attr-write', async (req, res) => {
    try {
        const { server, dimension } = req.body
        const client = new TM1Client(server)

        // Get first element that has at least one attribute value set
        const els = await client.get(
            `Dimensions('${dimension}')/Hierarchies('${dimension}')/Elements`,
            { '$select': 'Name', '$top': '20' }
        )
        let candidate = null
        let attrName = null
        let attrValue = null
        for (const el of (els.value ?? [])) {
            const attrs = await client.getElementAttributeValues(dimension, el.Name)
            const entry = Object.entries(attrs).find(([, v]) => v !== null && v !== '' && v !== 0)
            if (entry) {
                candidate = el.Name
                ;[attrName, attrValue] = entry
                break
            }
        }
        if (!candidate) {
            return res.json({ skipped: true, reason: 'No element with a non-empty attribute value found. Set at least one attribute value first.' })
        }

        console.log(`[attr-write-probe] dim=${dimension} element=${candidate} attr=${attrName} value=${JSON.stringify(attrValue)}`)
        const [r1, r2] = await Promise.all([
            client.probeAttributeValueWrite(dimension, candidate, attrName, attrValue),
            client.probeAttributeWrite(dimension, candidate, attrName, attrValue),
        ])
        res.json({ element: candidate, attribute: attrName, value: attrValue, ...r1, ...r2 })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Dimension element + edge write ───────────────────────────────────────────
app.post('/api/dimension/element', async (req, res) => {
    try {
        const { server, dimension, hierarchy } = req.query
        const client = new TM1Client(server)
        await client.addElement(dimension, req.body.name, req.body.type, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_ADDED', objectType: 'dimension', objectName: req.body.name, detail: dimension })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/element', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        const client = new TM1Client(server)
        await client.deleteElement(dimension, name, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_DELETED', objectType: 'dimension', objectName: name, detail: dimension })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/dimension/element', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        const client = new TM1Client(server)
        await client.renameElement(dimension, name, req.body.newName, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_RENAMED', objectType: 'dimension', objectName: req.body.newName, detail: `${dimension} · was: ${name}` })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/dimension/edge', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.addEdge(req.query.dimension, req.body.parent, req.body.child, req.body.weight ?? 1, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/dimension/edge', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.updateEdgeWeight(req.query.dimension, req.query.parent, req.query.child, req.body.weight, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/edge', async (req, res) => {
    try {
        const { server, dimension, parent, child, hierarchy } = req.query
        const client = new TM1Client(server)
        await client.deleteEdge(dimension, parent, child, hierarchy)
        cl.writeLog({ server, action: 'EDGE_REMOVED', objectType: 'dimension', objectName: child, detail: `${dimension} · removed from ${parent}` })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/hierarchies', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getHierarchies(req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/subset/usage', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.scanSubsetUsage(req.query.dimension, req.query.subset))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/view/usage', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.scanViewUsage(req.query.cube, req.query.view))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/dimension/usage', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.scanDimensionUsage(req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/cube/usage', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.scanCubeUsage(req.query.cube))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/process/usage', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.scanProcessUsage(req.query.process))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/dimension/hierarchy', async (req, res) => {
    try {
        const { server, dimension, name } = req.body
        await new TM1Client(server).createHierarchy(dimension, name)
        cl.writeLog({ server, action: 'HIERARCHY_CREATED', objectType: 'dimension', objectName: name, detail: dimension })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/hierarchy', async (req, res) => {
    try {
        const { server, dimension, name } = req.query
        await new TM1Client(server).deleteHierarchy(dimension, name)
        cl.writeLog({ server, action: 'HIERARCHY_DELETED', objectType: 'dimension', objectName: name, detail: dimension })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Search index — all rules + all process code in one call ──────────────────
app.get('/api/search/index', async (req, res) => {
    console.log('[api/process] request:', req.query.server, req.query.name)
    try {
        const client = new TM1Client(req.query.server)
        const [cubes, processes] = await Promise.all([
            client.getCubes(),
            client.getProcesses(),
        ])

        const [rulesResults, processResults] = await Promise.all([
            Promise.all(cubes.map(async name => {
                const cube = await client.getCube(name)
                return { name, rules: cube?.Rules ?? '' }
            })),
            Promise.all(processes.map(async name => {
                const p = await client.getProcess(name)
                return {
                    name,
                    Prolog:   p.PrologProcedure   ?? '',
                    Metadata: p.MetaDataProcedure ?? '',
                    Data:     p.DataProcedure     ?? '',
                    Epilog:   p.EpilogProcedure   ?? '',
                }
            })),
        ])

        res.json({ rules: rulesResults, processes: processResults })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Subsets ───────────────────────────────────────────────────────────────────
app.get('/api/subsets', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getSubsets(req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/subset', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getSubset(req.query.dimension, req.query.name))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/subset', async (req, res) => {
    try {
        const client      = new TM1Client(req.query.server)
        const current     = await client.getSubset(req.query.dimension, req.query.name).catch(() => null)
        const beforeState = current ? { expression: current.Expression ?? '' } : null
        await client.saveSubset(req.query.dimension, req.query.name, req.body.mdx)
        const afterState  = { expression: req.body.mdx }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'SUBSET_SAVED', objectType: 'subset', objectName: req.query.name, detail: req.query.dimension, beforeState, afterState })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.get('/api/subset/elements', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getSubsetElements(req.query.dimension, req.query.name))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/subset/static', async (req, res) => {
    try {
        const client      = new TM1Client(req.query.server)
        const currentEls  = await client.getSubsetElements(req.query.dimension, req.query.name).catch(() => null)
        const beforeState = currentEls ? { elements: currentEls.map(e => e.name) } : null
        await client.saveStaticSubset(req.query.dimension, req.query.name, req.body.elements)
        const afterState  = { elements: req.body.elements ?? [] }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'SUBSET_SAVED', objectType: 'subset', objectName: req.query.name, detail: req.query.dimension, beforeState, afterState })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// Get distinct attribute values for a dimension (samples up to 500 elements)
app.get('/api/dimension/attribute-values', async (req, res) => {
    const { server, dimension, attribute } = req.query
    if (!server || !dimension || !attribute) return res.status(400).json({ error: 'server, dimension and attribute required' })
    try {
        const client = new TM1Client(server)
        const elements = await client.getElements(dimension, dimension, { $top: 500 })
        const valueSet = new Set()
        const list = Array.isArray(elements?.value) ? elements.value : Array.isArray(elements) ? elements : []
        for (const el of list) {
            try {
                const vals = await client.getElementAttributeValues(dimension, el.Name, dimension)
                const v = (vals?.value ?? vals)?.[attribute]
                if (v !== undefined && v !== null && v !== '') valueSet.add(String(v))
            } catch {}
        }
        res.json({ values: [...valueSet].sort() })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/subset/preview', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const dim = req.query.dimension
        const members = await client.previewMDX(dim, req.body.mdx, req.body.limit ?? 100)
        // Batch-fetch attributes for up to 100 members
        const toFetch = members.slice(0, 100)
        if (toFetch.length > 0) {
            const attrResults = await Promise.all(
                toFetch.map(m =>
                    client.getElementAttributeValues(dim, m.name, dim)
                        .then(r => r?.value ?? r ?? {})
                        .catch(() => ({}))
                )
            )
            toFetch.forEach((m, i) => { m.attributes = attrResults[i] ?? {} })
        }
        res.json({ members })
    } catch (e) {
        console.error('[subset/preview]', e.message)
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/subset/generate', async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set in .env' })
    }
    try {
        const { server, dimension, prompt } = req.body
        const client   = new TM1Client(server)
        const elements = await client.getElements(dimension)
        const sample   = elements.slice(0, 200).map(e => `${e.Name} (${e.Type === 'N' ? 'leaf' : e.Type === 'C' ? 'consolidated' : 'string'}, level ${e.Level})`).join('\n')

        const message = await anthropic.messages.create({
            model:      'claude-opus-4-7',
            max_tokens: 1024,
            system: `You are a TM1 MDX expert. Generate a valid TM1 MDX set expression for the given dimension.
Rules:
- Return ONLY the raw MDX expression — no markdown, no explanation, no code fences.
- The expression MUST be wrapped in outer curly braces {} to form a valid set literal.
- Use the dimension name exactly as provided.
- Reference members as [{dim}].[{dim}].[MemberName] or use set functions directly.
- Common functions: TM1FilterByLevel, TM1FilterByPattern, TM1Sort, TopCount, BottomCount, Filter, CrossJoin, Descendants, Children, Ancestors, Members.
- Leaf members are Type=N (level 0). Consolidated members are Type=C (level > 0).
- Example: {TM1FilterByLevel({[{dim}].[{dim}].Members}, 0)}`.replaceAll('{dim}', dimension),
            messages: [{
                role: 'user',
                content: `Dimension: ${dimension}\n\nSample elements (up to 200):\n${sample}\n\nRequest: ${prompt}`,
            }],
        })

        const mdx = message.content[0].text.trim()
        res.json({ mdx })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── View → axis config (execute view, return cellset + axis dim names) ───────
// Extract member names from an inline Subset Expression like {[Dim].[Hier].[M1], [Dim].[Hier].[M2]}
function extractMembersFromExpression(expr) {
    if (!expr) return null
    const trimmed = expr.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
    const matches = [...trimmed.matchAll(/\[[^\]]+\]\.\[[^\]]+\]\.\[([^\]]+)\]/g)]
    return matches.length > 0 ? matches.map(m => m[1]) : null
}

app.get('/api/view/axes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const [data, viewDef] = await Promise.all([
            client.executeView(req.query.cube, req.query.view),
            client.getViewWithSubsets(req.query.cube, req.query.view),
        ])
        console.log('[view/axes] viewDef keys:', viewDef ? Object.keys(viewDef) : 'null', 'has _rows:', !!viewDef?._rows, 'has Rows:', !!(viewDef?.Rows?.length), 'Rows[0] keys:', viewDef?.Rows?.[0] ? Object.keys(viewDef.Rows[0]) : 'none', '_rows sample:', viewDef?._rows ? JSON.stringify(viewDef._rows).slice(0, 500) : 'none')
        // Parse dimension names from UniqueName: [Dim].[Hier].[Member] → Dim
        const parseDim = (uniqueName) => uniqueName?.match(/^\[([^\]]+)\]/)?.[1] ?? null
        const axisConfig = data.Axes.map(ax => ({
            ordinal: ax.Ordinal,
            dimensions: [...new Set(
                (ax.Tuples?.[0]?.Members ?? []).map(m => parseDim(m.UniqueName)).filter(Boolean)
            )],
            selectedMembers: ax.Ordinal === 2
                ? (ax.Tuples?.[0]?.Members ?? []).map(m => ({ dimension: parseDim(m.UniqueName), member: m.Name }))
                : [],
        }))
        // Build raw native config from view definition
        const extractAxis = (placement) => {
            const expr = (placement.Subset?.Expression ?? '').trim()
            const hasNamedSubset = !!(placement.SubsetName ?? (placement.Subset?.Name || null))
            return {
                dimension: placement.DimensionName ?? placement.Name,
                subset:    placement.SubsetName ?? (placement.Subset?.Name || null),
                memberSet: !hasNamedSubset && /^TM1SubsetAll\(/i.test(expr) ? 'all'
                         : !hasNamedSubset && /^TM1FILTERBYLEVEL\s*\(/i.test(expr) ? 'leaf'
                         : null,
                members:   !hasNamedSubset ? extractMembersFromExpression(expr) : null,
            }
        }
        const extractTitle = (t) => ({
            dimension: t.DimensionName ?? t.Name,
            member:    t.Selection?.Name ?? null,
        })
        const rawNative = viewDef ? {
            rows:    (viewDef.Rows ?? []).length > 0 ? (viewDef.Rows ?? []).map(extractAxis) : (viewDef._rows ?? []),
            columns: (viewDef.Columns ?? []).length > 0 ? (viewDef.Columns ?? []).map(extractAxis) : (viewDef._columns ?? []),
            titles:  (viewDef.Titles ?? []).length > 0 ? (viewDef.Titles ?? []).map(extractTitle) : (viewDef._titles ?? []),
        } : null

        // Rebuild nativeConfig using axisConfig (cellset) for correct axis placement
        // and rawNative for subset/member info
        let nativeConfig = rawNative
        if (rawNative && axisConfig.length) {
            const dimInfo = {}
            for (const d of [...rawNative.rows, ...rawNative.columns, ...rawNative.titles])
                if (d.dimension) dimInfo[d.dimension] = { subset: d.subset ?? null, memberSet: d.memberSet ?? null, members: d.members ?? null }

            const colAxis    = axisConfig.find(a => a.ordinal === 0)
            const rowAxis    = axisConfig.find(a => a.ordinal === 1)
            const filterAxis = axisConfig.find(a => a.ordinal === 2)

            nativeConfig = {
                columns: (colAxis?.dimensions ?? []).map(d => ({ dimension: d, subset: dimInfo[d]?.subset ?? null, memberSet: dimInfo[d]?.memberSet ?? null, members: dimInfo[d]?.members ?? null })),
                rows:    (rowAxis?.dimensions ?? []).map(d => ({ dimension: d, subset: dimInfo[d]?.subset ?? null, memberSet: dimInfo[d]?.memberSet ?? null, members: dimInfo[d]?.members ?? null })),
                titles:  (filterAxis?.selectedMembers ?? rawNative.titles ?? []).map(t => ({
                    dimension: t.dimension,
                    member:    t.member ?? rawNative.titles?.find(n => n.dimension === t.dimension)?.member ?? null,
                })),
            }
        }

        // For MDX views, return the MDX text so the client can parse it back to axes
        const mdxText = (viewDef && viewDef['@odata.type']?.includes('MDXView')) ? (viewDef.MDX || null) : null
        res.json({ axisConfig, cellset: data, viewType: data.ViewType, nativeConfig, mdx: mdxText })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── Native View Execute (with suppression toggle) ────────────────────────────
app.post('/api/view/execute-suppressed', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const { suppressZeros } = req.body
        res.json(await client.executeViewWithSuppression(req.query.cube, req.query.view, suppressZeros))
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── MDX Execute ──────────────────────────────────────────────────────────────
app.post('/api/mdx/execute', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.executeMDX(req.body.mdx))
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── Rules lineage ─────────────────────────────────────────────────────────────
function parseDbRefs(rules) {
    const refs = new Set()
    const re = /\bDB[S]?\s*\(\s*'([^']+)'/gi
    let m
    while ((m = re.exec(rules)) !== null) refs.add(m[1])
    return [...refs]
}

app.get('/api/lineage', async (req, res) => {
    try {
        const client   = new TM1Client(req.query.server)
        const root     = req.query.cube
        const maxDepth = Math.min(parseInt(req.query.depth ?? '4'), 6)
        const visited  = new Set()
        const tree     = {}

        async function traverse(cube, depth) {
            if (depth === 0 || visited.has(cube)) return
            visited.add(cube)
            try {
                const data   = await client.getCube(cube)
                const rules  = data?.Rules ?? ''
                const sources = parseDbRefs(rules)
                tree[cube]   = { sources, hasRules: rules.trim().length > 0 }
                await Promise.all(sources.map(s => traverse(s, depth - 1)))
            } catch {
                tree[cube] = { sources: [], hasRules: false, error: true }
            }
        }

        await traverse(root, maxDepth)
        res.json({ root, tree })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/lineage/consumers', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const target = req.query.cube
        const cubes  = await client.getCubes()
        const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re      = new RegExp(`\\bDB[S]?\\s*\\(\\s*'${escaped}'`, 'i')

        const consumers = (await Promise.all(
            cubes
                .filter(name => name !== target)
                .map(async name => {
                    try {
                        const data = await client.getCube(name)
                        return re.test(data?.Rules ?? '') ? name : null
                    } catch { return null }
                })
        )).filter(Boolean)

        res.json({ cube: target, consumers })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── PAW Book Usage — which books reference a TM1 view ─────────────────────────
app.get('/api/paw/book-usage', async (req, res) => {
    try {
        const { server, cube, view } = req.query
        if (!server || !cube) return res.json({ books: [] })

        const pawSession = await getCachedPawSession()
        const csrf = await getCSRF(pawSession)
        const base = `${PAW_HOST}/pacontent/v1`

        // Recursively collect TM1 view references from PAW book content
        function collectViews(items) {
            const views = []
            for (const item of items) {
                const feats = item.features || {}
                const candidates = [
                    feats.PAProperties?.tm1,
                    feats.Models_internal?.data?.parentStore,
                ]
                for (const tm1 of candidates) {
                    if (tm1?.cube) {
                        const v = {
                            server: tm1.server || '',
                            cube:   tm1.cube || '',
                            view:   tm1.view || '',
                        }
                        if (!views.some(x => x.server === v.server && x.cube === v.cube && x.view === v.view)) {
                            views.push(v)
                        }
                    }
                }
                if (item.items) {
                    for (const v of collectViews(item.items)) {
                        if (!views.some(x => x.server === v.server && x.cube === v.cube && x.view === v.view)) {
                            views.push(v)
                        }
                    }
                }
            }
            return views
        }

        function extractTabs(content) {
            if (!content || !content.layout) return []
            const tabs = []
            for (const item of content.layout.items || []) {
                if (item.type === 'container') {
                    const name = item.title?.translationTable?.Default || 'Tab'
                    tabs.push({ name, views: collectViews(item.items || []) })
                }
            }
            return tabs
        }

        // Walk PAW content tree looking for books
        // PAW 2.1.8 uses 'folder' (lowercase) and book types 'dashboard'/'workbench'
        const encodePath = (p) => encodeURIComponent(encodeURIComponent(p))
        const books = []
        const walk = async (path) => {
            const url = `${base}/Assets(path='${encodePath(path)}')/Assets`
            try {
                const r = await pawSession.get(url, {
                    headers: { 'ba-sso-authenticity': csrf },
                    params: { '$select': 'name,id,path,type' }
                })
                for (const item of (r.data?.value ?? [])) {
                    if (item.type === 'folder') {
                        await walk(item.path)
                    } else if (item.type === 'dashboard' || item.type === 'workbench') {
                        // Book — fetch with expanded content
    console.log('[api/process] request:', req.query.server, req.query.name)
    try {
                            const book = await pawSession.get(
                                `${base}/Assets(path='${encodePath(item.path)}')?$expand=content`,
                                { headers: { 'ba-sso-authenticity': csrf } }
                            )
                            const content = book.data?.content
                            const tabs = extractTabs(content)
                            const found = tabs.some(tab =>
                                tab.views.some(v =>
                                    v.cube === cube && (!view || v.view === view) && v.server === server
                                )
                            )
                            if (found) {
                                books.push({
                                    name: item.name,
                                    path: item.path,
                                    id: item.id,
                                })
                            }
                        } catch { /* ignore unreadable books */ }
                    }
                }
            } catch { /* ignore inaccessible folders */ }
        }

        await walk('/shared')
        await walk('/users')

        res.json({ books, pawHost: PAW_HOST })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Model objects (non-control) ───────────────────────────────────────────────
app.get('/api/model/cubes', async (req, res) => {
    try {
        res.json(await new TM1Client(req.query.server).getModelCubes())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/model/dimensions', async (req, res) => {
    try {
        res.json(await new TM1Client(req.query.server).getModelDimensions())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Chore execute / activate / deactivate / create ────────────────────────────
app.post('/api/chore/execute', async (req, res) => {
    try {
        await new TM1Client(req.query.server).executeChore(req.query.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/chore/activate', async (req, res) => {
    try {
        await new TM1Client(req.query.server).activateChore(req.query.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/chore/deactivate', async (req, res) => {
    try {
        await new TM1Client(req.query.server).deactivateChore(req.query.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/chore', async (req, res) => {
    try {
        await new TM1Client(req.query.server).createChore(req.body)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Jobs ──────────────────────────────────────────────────────────────────────
app.get('/api/jobs', async (req, res) => {
    try {
        res.json(await new TM1Client(req.query.server).getJobs())
    } catch (e) {
        // Jobs endpoint is V12+ only — return empty list with flag for V11 servers
        const is404 = e.message?.includes('404') || e.response?.status === 404
        if (is404) return res.json({ items: [], v12only: true })
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/job/cancel', async (req, res) => {
    try {
        await new TM1Client(req.query.server).cancelJob(req.query.id)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Process error logs ────────────────────────────────────────────────────────
app.get('/api/process/errorlogs', async (req, res) => {
    try {
        res.json(await new TM1Client(req.query.server).getErrorLogFiles())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/process/errorlog/content', async (req, res) => {
    try {
        const content = await new TM1Client(req.query.server).getErrorLogContent(req.query.filename)
        res.json({ content })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Cell calculation trace ────────────────────────────────────────────────────
app.post('/api/cube/trace', async (req, res) => {
    try {
        const { server, cube, dimElemPairs } = req.body
        res.json(await new TM1Client(server).traceCellCalculation(cube, dimElemPairs))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Transaction log ───────────────────────────────────────────────────────────
app.get('/api/transactions', async (req, res) => {
    try {
        const { server, cube, top, elements } = req.query
        const parsed = elements ? JSON.parse(elements) : null
        res.json(await new TM1Client(server).getTransactionLog(cube, {
            top:      top ? parseInt(top) : 200,
            elements: parsed,
        }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── File management ───────────────────────────────────────────────────────────
app.get('/api/files/list', async (req, res) => {
    try {
        const { server, path: p } = req.query
        const pathParts = p ? JSON.parse(p) : ['Files']
        res.json(await new TM1Client(server).listFiles(pathParts))
    } catch (e) {
        const is404 = e.response?.status === 404 || e.message?.includes('404')
        if (is404) return res.status(404).json({ error: 'File browsing is not available on this server. The Contents API requires Planning Analytics v12 or later.' })
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/files/content', async (req, res) => {
    try {
        const { server, path: p, name } = req.query
        const pathParts = p ? JSON.parse(p) : ['Files']
        const client = new TM1Client(server)
        // Get raw content — stream back as download
        const session = await require('./core/paw_connect').getCachedPawSession()
        const csrf    = await require('./core/paw_connect').getCSRF(session)
        const url     = client._url(`${client._contentsPath(pathParts)}/Contents('${encodeURIComponent(name)}')/Content`)
        const r = await session.get(url, { headers: { 'ba-sso-authenticity': csrf }, responseType: 'arraybuffer' })
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
        res.setHeader('Content-Type', 'application/octet-stream')
        res.send(Buffer.from(r.data))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/files/upload', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    try {
        const { server, path: p, name } = req.query
        const pathParts = p ? JSON.parse(p) : ['Files']
        const client = new TM1Client(server)
        // Create the document entry (ignore 409 if already exists)
        try { await client.createFileDocument(pathParts, name) } catch (e) {
            if (!e.message?.includes('already exists') && !(e.response?.status === 409)) throw e
        }
        await client.putFileContent(pathParts, name, req.body)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/files', async (req, res) => {
    try {
        const { server, path: p, name } = req.query
        const pathParts = p ? JSON.parse(p) : ['Files']
        await new TM1Client(server).deleteFile(pathParts, name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Sessions ──────────────────────────────────────────────────────────────────
app.get('/api/sessions', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const sessions = await client.getSessions()
        res.json(sessions)
    } catch (e) {
        console.error('[sessions] error:', e.response?.status, e.response?.data ?? e.message)
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/session', async (req, res) => {
    try {
        await new TM1Client(req.query.server).disconnectSession(req.query.id)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/threads', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const threads = await client.getThreads()
        res.json(threads)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/thread/cancel', async (req, res) => {
    try {
        await new TM1Client(req.query.server).cancelThread(req.query.id)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Server admin ─────────────────────────────────────────────────────────────
app.get('/api/admin/metrics', async (req, res) => {
    try {
        const { server, cube } = req.query
        res.json(await new TM1Client(server).getMetrics(cube || null))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/admin/configuration', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        console.log('[config] GET', client._url('ActiveConfiguration'))
        res.json(await client.getActiveConfiguration())
    } catch (e) {
        console.error('[config] error:', e.response?.status, e.response?.data ?? e.message)
        res.status(500).json({ error: e.message })
    }
})

app.patch('/api/admin/configuration', async (req, res) => {
    try {
        const { server, section = 'Administration', values } = req.body
        res.json(await new TM1Client(server).patchStaticConfiguration(section, values))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/admin/maintenance/enable', async (req, res) => {
    try {
        res.json(await new TM1Client(req.body.server).enableMaintenanceMode())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/admin/maintenance/disable', async (req, res) => {
    try {
        res.json(await new TM1Client(req.body.server).disableMaintenanceMode())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Forge (workspace persistence) ────────────────────────────────────────────
// ── Control Objects ───────────────────────────────────────────────────────────
app.get('/api/control/objects', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getControlObjects())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Period Builder ────────────────────────────────────────────────────────────
// Saves 3 TI processes to the target TM1 server.
// Request body: { server, processes: [{name, prolog, metadata, data, epilog, parameters}] }
app.post('/api/period-builder/run', async (req, res) => {
    const { server, processes } = req.body
    if (!server || !Array.isArray(processes)) {
        return res.status(400).json({ ok: false, error: 'server and processes required' })
    }
    try {
        const client = new TM1Client(server)
        for (const proc of processes) {
            await client.createOrReplaceProcess(proc)
        }
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message
        console.error('[period-builder]', detail)
        res.status(500).json({ ok: false, error: detail })
    }
})

app.get('/api/forge', (req, res) => {
    try {
        const data = fs.existsSync(FORGE_PATH)
            ? JSON.parse(fs.readFileSync(FORGE_PATH, 'utf8'))
            : {}
        res.json(data)
    } catch { res.json({}) }
})

app.post('/api/forge', (req, res) => {
    try {
        fs.mkdirSync(path.dirname(FORGE_PATH), { recursive: true })
        fs.writeFileSync(FORGE_PATH, JSON.stringify(req.body, null, 2))
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── SQL Editor ───────────────────────────────────────────────────────────────

app.get('/api/sql/connections', (req, res) => {
    res.json(loadConnections().map(c => ({ ...c, password: c.password ? '••••••••' : '' })))
})

app.post('/api/sql/connections', (req, res) => {
    try {
        const conns = loadConnections()
        const conn  = { ...req.body, id: req.body.id || `sql-${Date.now()}` }
        const idx   = conns.findIndex(c => c.id === conn.id)
        if (idx >= 0) conns[idx] = conn; else conns.push(conn)
        saveConnections(conns)
        res.json({ ok: true, id: conn.id })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/sql/connections/:id', (req, res) => {
    try {
        saveConnections(loadConnections().filter(c => c.id !== req.params.id))
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sql/test', async (req, res) => {
    try {
        const conn = req.body.id ? getConnection(req.body.id) : req.body
        if (!conn) return res.status(404).json({ error: 'Connection not found' })
        await testConnection(conn)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sql/execute', async (req, res) => {
    try {
        const conn = req.body.connectionId ? getConnection(req.body.connectionId) : req.body.connection
        if (!conn) return res.status(404).json({ error: 'Connection not found' })
        const start  = Date.now()
        const result = await executeQuery(conn, req.body.sql, req.body.params)
        res.json({ ...result, duration: Date.now() - start })
    } catch (e) {
        console.error('[sql/execute]', e.message)
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/sql/schema/:id', async (req, res) => {
    try {
        const conn = getConnection(req.params.id)
        if (!conn) return res.status(404).json({ error: 'Connection not found' })
        res.json(await getSchema(conn))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sql/post-to-ti', async (req, res) => {
    try {
        const { connectionId, sql, server, processName, createNew = false } = req.body
        if (!connectionId || !sql || !server || !processName)
            return res.status(400).json({ error: 'connectionId, sql, server and processName are required' })

        const conn = getConnection(connectionId)
        if (!conn) return res.status(404).json({ error: 'Connection not found' })
        if (!conn.dsn) return res.status(400).json({ error: 'Connection has no TM1 DSN configured' })

        const client = new TM1Client(server)

        // Parse ?pParam? tokens from SQL
        const tokens = [...new Set([...sql.matchAll(/\?(\w+)\?/g)].map(m => m[1]))]

        // Prep TM1 comment header
        const paramList = tokens.length ? `-- Parameters: ${tokens.map(t => '?' + t + '?').join(', ')}\n` : ''
        const header    = `-- TM1 Process Datasource (via IDE)\n-- DSN: ${conn.dsn}\n${paramList}--\n\n`
        const sqlWithHeader = header + sql

        // TM1 REST API: all ODBC fields are camelCase inside the DataSource object
        const odbcProps = {
            DataSource: {
                Type:                   'ODBC',
                dataSourceNameForServer: conn.dsn,
                dataSourceNameForClient: '',
                query:                   sqlWithHeader,
                userName:                '',
                password:                '',
                usesUnicode:             true,
            },
        }

        if (createNew) {
            await client.post('Processes', {
                Name:               processName,
                PrologProcedure:    '',
                MetadataProcedure:  '',
                DataProcedure:      '',
                EpilogProcedure:    '',
                HasSecurityAccess:  false,
                ...odbcProps,
                Parameters:         tokens.map(t => ({ Name: t, Type: 'String', Value: '', Prompt: '' })),
                Variables:          [],
            })
            return res.json({ ok: true, created: true, dsn: conn.dsn, paramsAdded: tokens })
        }

        // Existing process — fetch, merge parameters, patch
        const proc      = await client.getProcess(processName)
        const existing  = (proc.Parameters ?? []).map(p => p.Name)
        const newParams = tokens.filter(t => !existing.includes(t))
            .map(t => ({ Name: t, Type: 'String', Value: '', Prompt: '' }))
        const parameters = [...(proc.Parameters ?? []), ...newParams]

        await client.patch(`Processes('${processName}')`, {
            ...odbcProps,
            Parameters: parameters,
        })

        res.json({ ok: true, created: createNew, dsn: conn.dsn, paramsAdded: newParams.map(p => p.Name) })
    } catch (e) {
        const tm1Msg = e.response?.data?.error?.message
        console.error('[sql/post-to-ti]', tm1Msg || e.message)
        res.status(500).json({ error: tm1Msg || e.message })
    }
})

app.post('/api/sql/preview-datasource', async (req, res) => {
    try {
        const { dsn, query } = req.body
        if (!dsn || !query) return res.status(400).json({ error: 'dsn and query are required' })
        const conn = loadConnections().find(c => c.dsn === dsn)
        if (!conn) return res.status(404).json({ error: `No SQL connection configured for DSN "${dsn}"` })
        const start  = Date.now()
        const result = await executeQuery(conn, query)
        res.json({ ...result, duration: Date.now() - start })
    } catch (e) {
        const tm1Msg = e.response?.data?.error?.message
        console.error('[sql/preview-datasource]', tm1Msg || e.message)
        res.status(500).json({ error: tm1Msg || e.message })
    }
})

app.get('/api/sql/queries', (req, res) => {
    const all = loadQueries()
    res.json(req.query.connectionId ? all.filter(q => q.connectionId === req.query.connectionId) : all)
})

app.post('/api/sql/queries', (req, res) => {
    try {
        const queries = loadQueries()
        const query   = { ...req.body, id: req.body.id || `sqlq-${Date.now()}` }
        const idx     = queries.findIndex(q => q.id === query.id)
        if (idx >= 0) queries[idx] = query; else queries.push(query)
        saveQueries(queries)
        res.json({ ok: true, id: query.id })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/sql/queries/:id', (req, res) => {
    try {
        saveQueries(loadQueries().filter(q => q.id !== req.params.id))
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Current user ──────────────────────────────────────────────────────────────
app.get('/api/whoami', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const name = await client.getCurrentUser()
        res.json({ name })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Cell write ────────────────────────────────────────────────────────────────
// Body: { server, cube, dims: [{ dim, element }, ...], value }
app.post('/api/cells/write', async (req, res) => {
    try {
        const { server, cube, dims, value } = req.body
        console.log('[cells/write] REQUEST BODY:', JSON.stringify({ server, cube, dims, value }))
        if (!server || !cube || !Array.isArray(dims) || dims.length === 0)
            return res.status(400).json({ error: 'server, cube, and dims are required' })
        const client = new TM1Client(server)
        const result = await client.writeCellValue(cube, dims, value)
        console.log('[cells/write] TM1 RESPONSE:', JSON.stringify(result))
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        console.error('[cells/write] ERROR:', detail)
        const msg = typeof detail === 'string' ? detail : JSON.stringify(detail)
        res.status(500).json({ error: msg })
    }
})

// ── Deploy pipeline ───────────────────────────────────────────────────────────

app.get('/api/deploy/object-diff', async (req, res) => {
    try {
        const { server, type, name, detail } = req.query
        if (!fs.existsSync(BASELINE_PATH)) return res.status(404).json({ error: 'No baseline seeded' })
        const snapshot = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
        const client = new TM1Client(server)
        let before = null, after = null

        if (type === 'rules') {
            before = { text: snapshot.cubes?.[name]?.rules ?? '' }
            const cube = await client.getCube(name)
            after = { text: cube?.Rules ?? '' }
        } else if (type === 'process') {
            const bp = snapshot.processes?.[name]
            before = bp ? { prolog: bp.PrologProcedure ?? '', metadata: bp.MetadataProcedure ?? bp.MetaDataProcedure ?? '', data: bp.DataProcedure ?? '', epilog: bp.EpilogProcedure ?? '' } : null
            const p = await client.getProcess(name)
            after = { prolog: p.PrologProcedure ?? '', metadata: p.MetaDataProcedure ?? p.MetadataProcedure ?? '', data: p.DataProcedure ?? '', epilog: p.EpilogProcedure ?? '' }
        } else if (type === 'subset') {
            const bs = snapshot.subsets?.[detail]?.[detail]?.[name]
            before = bs ?? null
            const sub = await client.getSubset(detail, name, detail)
            after = sub?.Expression ? { expression: sub.Expression } : { elements: [] }
        } else if (type === 'view') {
            const bv = snapshot.views?.[detail]?.[name]
            before = bv ? (bv.type === 'mdx' ? { type: 'mdx', mdx: bv.MDX ?? bv.mdx ?? '' } : { type: 'native', definition: bv.definition }) : null
            const view = await client.getView(detail, name)
            after = view?.MDX ? { type: 'mdx', mdx: view.MDX } : { type: 'native', definition: view }
        } else {
            return res.status(400).json({ error: `Unsupported type: ${type}` })
        }

        res.json({ before, after })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/baseline', (req, res) => {
    try {
        const fs = require('fs')
        if (!fs.existsSync(BASELINE_PATH)) return res.json({ exists: false })
        const snapshot = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
        res.json({ exists: true, ...snapshot._meta })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/seed', async (req, res) => {
    try {
        const { server } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        const snapshot = await deploySeed(server, BASELINE_PATH)
        res.json({ ok: true, server, seeded_at: snapshot._meta.seeded_at, counts: snapshot._meta.counts })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/diff', async (req, res) => {
    try {
        const { server, sessionId } = req.body
        const entries = cl.getSessionLog(sessionId)
        const result  = await deployDiff(server, entries)
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/package', async (req, res) => {
    try {
        const { server, sessionId, sessionName, forceInclude = [] } = req.body
        const entries = cl.getSessionLog(sessionId)
        const result  = await deployPack(server, entries, sessionName, { force: true, forceInclude })
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/packages', (req, res) => {
    try {
        const dir = path.join(__dirname, 'packages')
        if (!fs.existsSync(dir)) return res.json([])
        const items = fs.readdirSync(dir)
            .filter(n => fs.statSync(path.join(dir, n)).isDirectory())
            .map(n => {
                const mp = path.join(dir, n, 'manifest.json')
                if (!fs.existsSync(mp)) return null
                const m = JSON.parse(fs.readFileSync(mp, 'utf8'))
                return { dir: path.join(dir, n), name: n, meta: m._meta, objectCount: m.objects?.length ?? 0 }
            })
            .filter(Boolean)
            .sort((a, b) => (b.meta?.packaged_at ?? '').localeCompare(a.meta?.packaged_at ?? ''))
        res.json(items)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/risk', async (req, res) => {
    try {
        const { packageDir, target } = req.body
        const result = await analyzeRisk(packageDir, target)
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/execute', async (req, res) => {
    try {
        const { packageDir, target, dryRun } = req.body
        const result = await deployExecute(packageDir, target, { dryRun, skipRiskCheck: true })
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'))
})

app.listen(PORT, () => {
    console.log(`TM1 IDE running at http://localhost:${PORT}`)
})
