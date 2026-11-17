'use strict'

const { debugProcess } = require('../core/process-debug')
const { runProcess } = require('../core/process-run')

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
    const client = makeClient(server, req.ideToken)
    const result = await debugProcess(client, { name, params, sections, watches, breakpoints, captureWhen, joinContinuations })
    if (result.failure) return res.status(500).json({ error: result.failure })
    res.json(result)
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
        const client = makeClient(req.query.server, req.ideToken)
        const result = await runProcess(client, { name: procName, params: req.body.params })
        if (!result.ok) return res.status(result.status).json(result.body)
        res.json(result)
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
