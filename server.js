'use strict'

require('dotenv').config()

const express   = require('express')
const path      = require('path')
const fs        = require('fs')
const Anthropic = require('@anthropic-ai/sdk')
const { TM1Client } = require('./core/tm1_client')
const { getCachedPawSession, getCSRF, PAW_HOST } = require('./core/paw_connect')

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

// ── Servers ───────────────────────────────────────────────────────────────────
app.get('/api/servers', (req, res) => {
    try {
        const servers = require('./config/servers.json')
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
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/cube', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteCube(req.query.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/subset', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteSubset(req.query.dimension, req.query.name, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Processes ─────────────────────────────────────────────────────────────────
app.get('/api/processes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getProcesses())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/process', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteProcess(req.query.name)
        res.json({ ok: true })
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
        await client.patch(`Cubes('${req.query.cube}')`, { Rules: req.body.rules })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
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
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/process', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const body = { ...req.body }
        if ('MetaDataProcedure' in body) {
            body.MetadataProcedure = body.MetaDataProcedure
            delete body.MetaDataProcedure
        }
        await client.patch(`Processes('${req.query.name}')`, body)
        res.json({ ok: true })
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
    let duration = null, runError = null, errorSection = null, errorLine = null
    try {
        const result = await client.executeProcess(procName, req.body.params ?? [])
        duration = result?.Times?.ExecutionTimeInMilliseconds ?? null
    } catch (e) {
        const inner = e.response?.data?.error?.innererror ?? {}
        console.error('[process/run]', JSON.stringify(inner) || e.message)
        runError     = inner.Message || e.message
        errorSection = inner.ProcedureSection ?? null
        errorLine    = inner.LineNumber ?? null
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
        res.status(500).json({ error: runError, section: errorSection, line: errorLine, runLog })
    } else {
        res.json({ ok: true, duration, runLog })
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

app.get('/api/dimension/cubes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getCubesForDimension(req.query.dimension))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Attribute grid (all elements × all attrs in one response) ─────────────────
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
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/dimension/attribute-def', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        await new TM1Client(server).deleteElementAttribute(dimension, name, hierarchy)
        res.json({ ok: true })
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
        const client = new TM1Client(req.query.server)
        await client.saveView(req.query.cube, req.query.name, req.body.mdx)
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── Elements ──────────────────────────────────────────────────────────────────
app.get('/api/elements', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getElements(req.query.dimension, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
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
        const client = new TM1Client(req.query.server)
        await client.addElement(req.query.dimension, req.body.name, req.body.type, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/element', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteElement(req.query.dimension, req.query.name, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/dimension/element', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.renameElement(req.query.dimension, req.query.name, req.body.newName, req.query.hierarchy)
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
        const client = new TM1Client(req.query.server)
        await client.deleteEdge(req.query.dimension, req.query.parent, req.query.child, req.query.hierarchy)
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

app.post('/api/dimension/hierarchy', async (req, res) => {
    try {
        const { server, dimension, name } = req.body
        await new TM1Client(server).createHierarchy(dimension, name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/hierarchy', async (req, res) => {
    try {
        const { server, dimension, name } = req.query
        await new TM1Client(server).deleteHierarchy(dimension, name)
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
    console.log('[subset/save] dim=%s name=%s mdx=%s', req.query.dimension, req.query.name, (req.body.mdx ?? '').slice(0, 80))
    try {
        const client = new TM1Client(req.query.server)
        await client.saveSubset(req.query.dimension, req.query.name, req.body.mdx)
        console.log('[subset/save] OK')
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        console.error('[subset/save] ERROR:', detail)
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
    console.log('[subset/static] dim=%s name=%s count=%d', req.query.dimension, req.query.name, (req.body.elements ?? []).length)
    try {
        const client = new TM1Client(req.query.server)
        await client.saveStaticSubset(req.query.dimension, req.query.name, req.body.elements)
        console.log('[subset/static] OK')
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        console.error('[subset/static] ERROR:', detail)
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
app.get('/api/view/axes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const [data, viewDef] = await Promise.all([
            client.executeView(req.query.cube, req.query.view),
            client.getViewWithSubsets(req.query.cube, req.query.view),
        ])
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
        // Also return native view axis config with subsets
        const nativeConfig = viewDef ? {
            rows:    viewDef._rows    ?? (viewDef.Rows ?? []).map(r => ({ dimension: r.DimensionName ?? r.Name, subset: r.SubsetName ?? r.Subset?.Name ?? null })),
            columns: viewDef._columns ?? (viewDef.Columns ?? []).map(c => ({ dimension: c.DimensionName ?? c.Name, subset: c.SubsetName ?? c.Subset?.Name ?? null })),
            titles:  viewDef._titles  ?? (viewDef.Titles ?? []).map(t => ({ dimension: t.DimensionName ?? t.Name, member: t.Selection?.Name ?? null })),
        } : null
        // For MDX views, return the MDX text so the client can parse it back to axes
        const mdxText = (viewDef && viewDef['@odata.type']?.includes('MDXView')) ? (viewDef.MDX || null) : null
        res.json({ axisConfig, cellset: data, viewType: data.ViewType, nativeConfig, mdx: mdxText })
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

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'ide.html'))
})

app.listen(PORT, () => {
    console.log(`TM1 IDE running at http://localhost:${PORT}`)
})
