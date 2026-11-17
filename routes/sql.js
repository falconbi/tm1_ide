'use strict'

function register(app, deps) {
    const { SQL_PASSWORD_MASK, executeQuery, fail, gateWrite, getConnection, getSchema, loadConnections, loadQueries, makeClient, odataKey, saveConnections, saveQueries, testConnection } = deps

app.get('/api/sql/connections', (req, res) => {
    res.json(loadConnections().map(c => ({ ...c, password: c.password ? SQL_PASSWORD_MASK : '' })))
})

app.post('/api/sql/connections', (req, res) => {
    try {
        const conns = loadConnections()
        const conn  = { ...req.body, id: req.body.id || `sql-${Date.now()}` }
        const idx   = conns.findIndex(c => c.id === conn.id)
        // The edit form starts from the masked list entry — an untouched password
        // field comes back as the mask, which means "keep the stored one".
        if (conn.password === SQL_PASSWORD_MASK) conn.password = idx >= 0 ? conns[idx].password : ''
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
        if (!gateWrite(res, server)) return

        const conn = getConnection(connectionId)
        if (!conn) return res.status(404).json({ error: 'Connection not found' })
        if (!conn.dsn) return res.status(400).json({ error: 'Connection has no TM1 DSN configured' })

        const result = await require('../core/ti-generate').postSqlToTi(makeClient(server, req.ideToken), { conn, sql, processName, createNew })
        res.json(result)
    } catch (e) {
        console.error('[sql/post-to-ti]', e.message)
        fail(res, e)
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
        console.error('[sql/preview-datasource]', e.message)
        fail(res, e)
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
}

module.exports = { register }
