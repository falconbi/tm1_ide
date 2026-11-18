'use strict'

function register(app, deps) {
    const { cl, express, fail, gateReadOnly, gateWrite, lensBridge, lensStore, lensUsageCache, logLensNote, logLensRun, logLensWrite, makeClient, path, readLensActivity } = deps

app.get('/api/files/list', async (req, res) => {
    try {
        const { server, path: p } = req.query
        const pathParts = p ? JSON.parse(p) : ['Files']
        res.json(await makeClient(server, req.ideToken).listFiles(pathParts))
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
        const client = makeClient(server, req.ideToken)
        const content = await client.downloadFile(pathParts, name)
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
        res.setHeader('Content-Type', 'application/octet-stream')
        res.send(Buffer.isBuffer(content) ? content : Buffer.from(content))
    } catch (e) { fail(res, e) }
})

app.post('/api/files/upload', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    try {
        const { server, path: p, name } = req.query
        if (!gateReadOnly(res, server)) return
        const pathParts = p ? JSON.parse(p) : ['Files']
        const client = makeClient(server, req.ideToken)
        // Create the document entry (ignore 409 if already exists)
        try { await client.createFileDocument(pathParts, name) } catch (e) {
            if (!e.message?.includes('already exists') && !(e.response?.status === 409)) throw e
        }
        await client.putFileContent(pathParts, name, req.body)
        res.json({ ok: true })
    } catch (e) { fail(res, e) }
})

app.delete('/api/files', async (req, res) => {
    try {
        const { server, path: p, name } = req.query
        if (!gateReadOnly(res, server)) return
        const pathParts = p ? JSON.parse(p) : ['Files']
        await makeClient(server, req.ideToken).deleteFile(pathParts, name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/lens-patterns', (req, res) => {
    try { res.json(require('../core/lens_patterns').listPatterns()) } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/lens-patterns/:name', (req, res) => {
    try {
        const ex = require('../core/lens_patterns')
        const meta = ex.listPatterns().find(e => e.name === req.params.name)
        if (!meta) return res.status(404).json({ error: `Unknown Lens pattern "${req.params.name}"` })
        res.json({ meta, html: ex.readPattern(req.params.name) })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/lenses', async (req, res) => {
    try {
        const server = req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        res.json(await lensStore.listLenses(server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/lens/process-usage', async (req, res) => {
    try {
        const server = req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        const key = `${req.ideToken ?? ''}|${server}`
        const hit = lensUsageCache.get(key)
        if (hit && Date.now() - hit.at < 60_000) return res.json(hit.data)
        const usage = {}
        for (const l of await lensStore.listLensRuns(server, lensBridge.lensRuns, { ideToken: req.ideToken })) {
            for (const p of l.runs) (usage[p] ??= []).push(l.title || l.name)
        }
        lensUsageCache.set(key, { at: Date.now(), data: usage })
        res.json(usage)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/lenses/:name', async (req, res) => {
    try {
        const server = req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        const doc = await lensStore.readLens(server, req.params.name, { ideToken: req.ideToken })
        const { html: _own, ...meta } = doc
        res.json({ name: meta.name, html: doc.html ?? '', meta })
    } catch (e) { res.status(/not found/.test(e.message) ? 404 : 500).json({ error: e.message }) }
})

app.post('/api/lenses/:name', async (req, res) => {
    try {
        const server = req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        if (!gateReadOnly(res, server)) return
        const client = makeClient(server, req.ideToken)
        const { html, description, folder, title, icon, color, image, config, publish, force } = req.body
        if (typeof html !== 'string' || !html.trim()) return res.status(400).json({ error: 'html is required' })
        const errors = await lensBridge.validateLens(client, html)
        if (errors.length && !force) {
            return res.status(400).json({ error: `Lens validation failed (${errors.length}):`, validation: errors })
        }
        const saved = await lensStore.saveLens(server, req.params.name, html, req.user, { publish: typeof publish === 'boolean' ? publish : undefined, description, folder, title, icon, color, image, config, ideToken: req.ideToken })
        cl.writeLog({ server, action: saved.status === 'published' ? 'LENS_PUBLISHED' : 'LENS_SAVED', objectType: 'lens', objectName: saved.name,
            detail: `version ${saved.version}${description ? ` — ${description}` : ''}`, user: req.user })
        res.json({ ...saved, validation: errors })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/lenses/:name', async (req, res) => {
    try {
        const server = req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        if (!gateReadOnly(res, server)) return
        await lensStore.deleteLens(server, req.params.name, { ideToken: req.ideToken })
        cl.writeLog({ server, action: 'LENS_DELETED', objectType: 'lens', objectName: req.params.name, user: req.user })
        res.json({ ok: true })
    } catch (e) { res.status(/not found/.test(e.message) ? 404 : 500).json({ error: e.message }) }
})

app.post('/api/lens/exec-mdx', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await lensBridge.execMDX(client, req.body?.mdx))
    } catch (e) { fail(res, e) }
})

app.post('/api/lens/read-cell', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const { cube, coordinates } = req.body
        res.json({ value: await lensBridge.readCell(client, cube, coordinates) })
    } catch (e) { fail(res, e) }
})

app.post('/api/lens/write-cells', async (req, res) => {
    try {
        const server = req.query.server
        if (!gateReadOnly(res, server)) return
        const client = makeClient(server, req.ideToken)
        const name = req.body?.lens
        if (!name || typeof name !== 'string') throw new Error('lens is required')
        const doc = await lensStore.readLens(server, name, { ideToken: req.ideToken })
        const result = await lensBridge.writeCells(client, { cube: req.body?.cube, cells: req.body?.cells, allowedCubes: lensBridge.lensWrites(doc) })
        logLensWrite({ server, app: 'ide', user: req.user, lens: doc.name, cube: req.body.cube, changes: result.changes })
        res.json({ written: result.written })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.message
        res.status(e.conflicts ? 409 : 400).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail), conflicts: e.conflicts })
    }
})

app.get('/api/lens/history', async (req, res) => {
    try {
        const server = req.query.server, name = req.query.lens
        if (!name || typeof name !== 'string') throw new Error('lens is required')
        const doc = await lensStore.readLens(server, name, { ideToken: req.ideToken })
        let match = {}
        try { match = JSON.parse(String(req.query.match ?? '{}')) } catch { throw new Error('match must be JSON') }
        if (!match || typeof match !== 'object' || Array.isArray(match)) throw new Error('match must be { dimension: element }')
        if (Object.keys(match).length) {
            const cube = lensBridge.lensWrites(doc)[0]
            if (!cube) throw new Error('a history slice needs a Lens that changes data (lens-writes)')
            const client = makeClient(server, req.ideToken)
            const q = s => String(s).replace(/]/g, ']]')
            for (const [dim, el] of Object.entries(match)) {
                await client.executeMDX(`SELECT {} ON 0, {[${q(dim)}].[${q(dim)}].[${q(el)}]} ON 1 FROM [${q(cube)}]`)
                    .catch(() => { throw new Error(`you can't see ${dim} "${el}"`) })
            }
        }
        const skip = String(req.query.skip ?? '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 20)
        res.json(readLensActivity({ server, lens: doc.name, match, skip, limit: Math.min(Number(req.query.limit) || 30, 100) }))
    } catch (e) { res.status(400).json({ error: e.message }) }
})

app.get('/api/lens/whoami', async (req, res) => {
    try {
        const d = await makeClient(req.query.server, req.ideToken).get('ActiveUser', { '$expand': 'Groups($select=Name)' })
        res.json({ user: d?.Name ?? req.user, groups: (d?.Groups ?? []).map(g => g.Name) })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/lens/run-process', async (req, res) => {
    const server = req.query.server, name = req.body?.lens, process = req.body?.process, params = req.body?.params ?? {}
    try {
        if (!gateReadOnly(res, server)) return
        if (!name || typeof name !== 'string') throw new Error('lens is required')
        const doc = await lensStore.readLens(server, name, { ideToken: req.ideToken })
        const result = await lensBridge.runProcess(makeClient(server, req.ideToken), { process, params, allowedProcesses: lensBridge.lensRuns(doc), user: req.user })
        logLensRun({ server, app: 'ide', user: req.user, lens: doc.name, process, params, status: result.status, message: result.message, detail: result.detail })
        res.json(result)
    } catch (e) {
        if (e.status) logLensRun({ server, app: 'ide', user: req.user, lens: name, process, params, status: e.status, message: e.message, detail: e.detail })
        const detail = e.response?.data?.error?.message ?? e.message
        res.status(e.status ? 422 : 400).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail), status: e.status })
    }
})

app.post('/api/lens/add-note', async (req, res) => {
    try {
        const server = req.query.server
        if (!gateReadOnly(res, server)) return
        const name = req.body?.lens
        if (!name || typeof name !== 'string') throw new Error('lens is required')
        const doc = await lensStore.readLens(server, name, { ideToken: req.ideToken })
        const note = await lensBridge.addCellNote(makeClient(server, req.ideToken), { cube: req.body?.cube, coordinates: req.body?.coordinates, text: req.body?.text, allowedCubes: lensBridge.lensNotes(doc) })
        logLensNote({ server, app: 'ide', user: req.user, lens: doc.name, ...note })
        res.json({ ok: true })
    } catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
})

app.get('/api/lens/hierarchies', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await lensBridge.hierarchies(client, req.query.dimension))
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.message
        res.status(400).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.get('/api/lens/element-tree', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await lensBridge.elementTree(client, req.query.dimension, req.query.hierarchy))
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.message
        res.status(400).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.get('/api/lens/meta', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await lensBridge.getMeta(client, req.query.cube))
    } catch (e) { fail(res, e) }
})
for (const [route, fn] of [['cell-trace', (c, b) => lensBridge.cellTrace(c, b.cube, b.coordinates)],
                           ['cell-log',   (c, b) => lensBridge.cellLog(c, b.cube, b.coordinates, b.top)],
                           ['cell-notes', (c, b) => lensBridge.cellNotes(c, b.cube, b.coordinates)]]) {
    app.post(`/api/lens/${route}`, async (req, res) => {
        try { res.json(await fn(makeClient(req.query.server, req.ideToken), req.body ?? {})) }
        catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
    })
}

}

module.exports = { register }
