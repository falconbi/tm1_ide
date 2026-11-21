'use strict'

function register(app, deps) {
    const { cl, fail, gateWrite, getViewSourceUsage, makeClient, scanIdentity } = deps

app.get('/api/views', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getViews(req.query.cube))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/view', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getView(req.query.cube, req.query.name))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/view/preview-records', async (req, res) => {
    try {
        const { server, cube, view } = req.query
        res.json(await makeClient(server, req.ideToken).previewViewRecords(cube, view, 20))
    } catch (e) { fail(res, e) }
})

app.post('/api/view/save', async (req, res) => {
    try {
        const { server, cube, name } = req.query
        const { mdx, nativeAxes } = req.body
        if (!gateWrite(res, server)) return
        const client  = makeClient(server, req.ideToken)
        const current = await client.getView(cube, name).catch(() => null)
        const beforeState = current
            ? current['@odata.type']?.includes('MDXView')
                ? { type: 'mdx', mdx: current.MDX ?? '' }
                : { type: 'native', definition: current }
            : null
        const axes = nativeAxes && nativeAxes.formatString === undefined && typeof current?.FormatString === 'string'
            ? { ...nativeAxes, formatString: current.FormatString }
            : nativeAxes
        if (axes) {
            await client.saveNativeView(cube, name, axes)
        } else {
            await client.saveView(cube, name, mdx)
        }
        const afterState = axes ? { type: 'native', definition: axes } : { type: 'mdx', mdx: mdx ?? '' }
        const { hasSession } = cl.writeLog({ server, action: 'VIEW_SAVED', objectType: 'view', objectName: name, detail: cube, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { fail(res, e) }
})

app.post('/api/view/set-default', async (req, res) => {
    try {
        const { server, cube, name } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.setDefaultView(cube, name)
        res.json({ ok: true, noSession: false })
    } catch (e) {
        console.error('[set-default]', e.message, e.response?.status)
        fail(res, e)
    }
})

app.delete('/api/view', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteView(req.query.cube, req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'VIEW_DELETED', objectType: 'view', objectName: req.query.name, detail: req.query.cube, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/view/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanViewUsage(req.query.cube, req.query.view))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/view/source-usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await getViewSourceUsage(client, req.query.server, req.query.cube, req.query.view, scanIdentity(req)))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/view/axes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const [data, viewDef] = await Promise.all([
            client.executeView(req.query.cube, req.query.view),
            client.getViewWithSubsets(req.query.cube, req.query.view),
        ])
        const { buildViewAxes } = require('../core/view-axes')
        const axes = buildViewAxes(data, viewDef)
        res.json({ ...axes, cellset: data })
    } catch (e) { fail(res, e) }
})

app.post('/api/mdx/execute', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.executeMDX(req.body.mdx))
    } catch (e) { fail(res, e) }
})
}

module.exports = { register }
