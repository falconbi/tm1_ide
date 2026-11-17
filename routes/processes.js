'use strict'

function register(app, deps) {
    const { ai, cl, fail, gateReadOnly, gateWrite, getProcessFacts, invalidateCubeSources, joinContinuations, listProcessSummaries, makeClient, obfuscate, odataKey, processCode, processSummaries, scanIdentity, summaryPrompt } = deps

app.get('/api/processes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
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
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteProcess(req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'PROCESS_DELETED', objectType: 'process', objectName: req.query.name, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/chores', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getChores())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/chore', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getChore(req.query.name))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/chore', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.updateChore(req.query.name, req.body)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/chore', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteChore(req.query.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/process', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getProcess(req.query.name))
    } catch (e) {
        console.error('[api/process] GET failed:', e.response?.status, e.message)
        fail(res, e)
    }
})

app.post('/api/process/debug', async (req, res) => {
    const { server, name, params, sections, watches, breakpoints, captureWhen } = req.body
    if (!gateReadOnly(res, server)) return
    const client   = makeClient(server, req.ideToken)
    const tempName = `_IDE_Debug_${Date.now()}`
    let log = '', runError = null

    // ── 1. Fetch source process metadata ─────────────────────────────────────
    let proc
    try {
        proc = await client.get(`Processes('${odataKey(name)}')`)
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
        // capped: a breakpoint in the Data section fires once per record, and the log is one growing
        // string — capturing every record made a debug run on a big view crawl past the 2-minute timeout
        const guard = String(captureWhen ?? '').replace(/[\r\n]/g, ' ').trim()
        const condition = guard
            ? `nDBGHit__IDE__ < ${MAX_HITS} & (${guard})`
            : `nDBGHit__IDE__ < ${MAX_HITS}`
        const lines = [`IF( ${condition} ); nDBGHit__IDE__ = nDBGHit__IDE__ + 1;`,
                       `sDBGLog__IDE__ = ATTRS('}Processes', '${AT}', '${ATTR}');`]
        lines.push(`sDBGLog__IDE__ = sDBGLog__IDE__ | '${label}' | CHAR(10);`)
        for (const w of (watches ?? [])) {
            const val = w.type === 'number' ? `NumberToString(${w.name})` : w.name
            lines.push(`sDBGLog__IDE__ = sDBGLog__IDE__ | '__DBG_VAR:${w.name}__${sectionLabel}__${lineNum}=' | ${val} | CHAR(10);`)
        }
        lines.push(`AttrPutS(sDBGLog__IDE__, '}Processes', '${AT}', '${ATTR}');`)
        lines.push('ENDIF;')
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
    const MAX_HITS   = 50
    // The hit counter starts on its own line before the Prolog. Prefixing it to
    // line 1 broke processes whose first line was a #Region/comment.
    const prologInst = (hasCapture ? 'nDBGHit__IDE__ = 0;\n' : '') + instrumentSection(sections.PrologProcedure, 'PrologProcedure', 'Prolog')
    // TM1's property is MetadataProcedure (lowercase d); an older client may still send MetaDataProcedure
    const metaSrc    = sections.MetadataProcedure ?? sections.MetaDataProcedure ?? ''
    if (breakpoints && breakpoints.MetadataProcedure == null && breakpoints.MetaDataProcedure) breakpoints.MetadataProcedure = breakpoints.MetaDataProcedure
    const metaInst   = metaSrc.trim()
        ? instrumentSection(metaSrc, 'MetadataProcedure', 'Metadata')
        : (jc(metaSrc))
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
            // the copy must keep the datasource + its variables, or the Data section never runs
            datasource: proc.DataSource ? stripMeta(proc.DataSource) : undefined,
            variables:  (proc.Variables ?? []).map(stripMeta),
        })
    } catch (e) {
        return res.status(500).json({ error: `Failed to create debug process: ${e.message}` })
    }

    // ── 5. Execute ─────────────────────────────────────────────────────────────
    try {
        const dbgRun = await client.executeProcess(tempName, params ?? [])
        const status = dbgRun?.ProcessExecuteStatusCode
        if (status && !['CompletedSuccessfully', 'HasMinorErrors', 0].includes(status)) {
            const errFile = dbgRun?.ErrorLogFile?.Filename
            runError = errFile
                ? ((await client.getErrorLogContent(errFile).catch(() => null))?.Content || `Debug run ${status}`)
                : `Debug run ${status}`
        }
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

app.post('/api/process/create', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.post('Processes', {
            Name: req.query.name,
            PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
            DataSource: { Type: 'None' },
            Parameters: [],
            Variables: [],
        })
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'PROCESS_CREATED', objectType: 'process', objectName: req.query.name, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/process', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client  = makeClient(req.query.server, req.ideToken)
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
        await client.patch(`Processes('${odataKey(req.query.name)}')`, body)
        invalidateCubeSources(req.query.server)
        const afterState = {
            prolog:   req.body.PrologProcedure                                       ?? beforeState?.prolog   ?? '',
            metadata: req.body.MetaDataProcedure ?? req.body.MetadataProcedure       ?? beforeState?.metadata ?? '',
            data:     req.body.DataProcedure                                         ?? beforeState?.data     ?? '',
            epilog:   req.body.EpilogProcedure                                       ?? beforeState?.epilog   ?? '',
        }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'PROCESS_SAVED', objectType: 'process', objectName: req.query.name, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        console.error('[api/process] SAVE failed:', e.response?.status, e.message)
        fail(res, e)
    }
})

app.post('/api/process/run', async (req, res) => {
    if (!gateReadOnly(res, req.query.server)) return
    const procName = req.query.name
    if (!procName) return res.status(400).json({ error: 'name required' })
    try {
        const client   = makeClient(req.query.server, req.ideToken)
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
            } catch (e) {
            console.error('[process/run] __RUN_LOG MDX failed:', e.message)
        }

        // ── 4. Fallback: if no __RUN_LOG and process errored, use TM1 ErrorLog ────
        if (!runLog && runError) {
                try {
                const errLog = await client.get(`Processes('${odataKey(procName)}')/ErrorLog`)
                runLog = typeof errLog === 'string' ? errLog : (errLog?.value ?? '')
            } catch (e) {
                console.error('[process/run] ErrorLog fallback failed:', e.message)
            }
        }

        // ── 5. Detect __ERROR: validation marker (written before ProcessQuit) ────────
        if (!runError && runLog.startsWith('__ERROR:')) {
            const msg = runLog.replace(/^__ERROR:/, '').trim()
            return res.status(500).json({ error: msg, section: null, line: null, runLog: msg })
        }

        if (runError) {
            res.status(500).json({ error: runError, section: errorSection, line: errorLine, runLog, errorLogFilename })
        } else {
            res.json({ ok: true, duration, runLog, errorLogFilename })
        }
    } catch (e) { fail(res, e) }
})

app.get('/api/process/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanProcessUsage(req.query.process))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/chore', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.query.server)) return
        await makeClient(req.query.server, req.ideToken).createChore(req.body)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/process/errorlog/content', async (req, res) => {
    try {
        const content = await makeClient(req.query.server, req.ideToken).getErrorLogContent(req.query.filename)
        res.json({ content })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/process/check-references', async (req, res) => {
    try {
        const { server, sections } = req.body
        res.json(await makeClient(server, req.ideToken).checkTIReferences(sections))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/period-builder/run', async (req, res) => {
    const { server, processes } = req.body
    if (!server || !Array.isArray(processes)) {
        return res.status(400).json({ ok: false, error: 'server and processes required' })
    }
    if (!gateWrite(res, server)) return
    try {
        const client = makeClient(server, req.ideToken)
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

app.get('/api/process/summaries', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json({ processes: await listProcessSummaries(client, req.query.server, scanIdentity(req)), aiConfigured: ai.isConfigured() })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/process/summary', async (req, res) => {
    try {
        const { server, name } = req.body
        if (!ai.isConfigured()) return res.status(503).json({ error: 'AI not configured — set AI_PROVIDER and AI_API_KEY in .env (or write a summary by hand)' })
        const client = makeClient(server, req.ideToken)
        const p = await client.getProcess(name)
        if (!p?.Name) return res.status(404).json({ error: `Process "${name}" not found` })
        const hash = processSummaries.hashCode(processSummaries.processCode(p))
        if (!req.body.force) {
            const hit = processSummaries.get(server, name, hash)
            if (hit) return res.json({ ...hit, cached: true })
        }
        const facts = await getProcessFacts(client, server, name, scanIdentity(req))
        const obf = ai.shouldObfuscate()
        let { system, user } = processSummaries.summaryPrompt(p, facts, !obf)
        let map = null
        if (obf) {
            const names = [name, ...(facts.parameters ?? []), ...(facts.calledBy ?? []), ...(facts.reads ?? []),
                ...facts.writes.flatMap(w => [w.cube, ...(w.measures ?? [])])]
            map = obfuscate.makeMap(names)
            user = obfuscate.obfuscateText(user, map.realToCode)
        }
        let out = await ai.complete({ system, user, maxTokens: 400, label: 'process-summary', obfuscated: obf })
        if (map) out = obfuscate.restoreText(out, map.codeToReal)
        const summary = String(out ?? '').replace(/```[a-z]*\s*/gi, '').replace(/```/g, '').trim().slice(0, 1200)
        if (!summary) return res.status(502).json({ error: 'The model returned an empty summary' })
        if (!gateReadOnly(res, server)) return
        const entry = await processSummaries.put(server, name, { hash, summary, source: 'ai', model: process.env.AI_MODEL || '' })
        res.json({ ...entry, cached: false })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.put('/api/process/summary', async (req, res) => {
    try {
        const { server, name, summary } = req.body
        if (!String(summary ?? '').trim()) return res.status(400).json({ error: 'Summary is empty' })
        const client = makeClient(server, req.ideToken)
        const p = await client.getProcess(name)
        if (!p?.Name) return res.status(404).json({ error: `Process "${name}" not found` })
        if (!gateReadOnly(res, server)) return
        const entry = await processSummaries.put(server, name, {
            hash: processSummaries.hashCode(processSummaries.processCode(p)),
            summary: String(summary).trim().slice(0, 1200),
            source: 'manual',
        })
        res.json(entry)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})
}

module.exports = { register }
