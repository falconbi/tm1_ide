'use strict'

require('dotenv').config()

const express = require('express')
const path    = require('path')
const { TM1Client } = require('./core/tm1_client')

const app  = express()
const PORT = process.env.PORT || 8083

app.use(express.json())
app.use(express.static(path.join(__dirname, 'static')))

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

// ── Processes ─────────────────────────────────────────────────────────────────
app.get('/api/processes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getProcesses())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
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
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/process/run', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const result = await client.executeProcess(req.query.name, req.body.params ?? {})
        res.json({ ok: true, result })
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

app.post('/api/view/execute', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.executeView(req.query.cube, req.query.view))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Elements ──────────────────────────────────────────────────────────────────
app.get('/api/elements', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getElements(req.query.dimension))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'ide.html'))
})

app.listen(PORT, () => {
    console.log(`TM1 IDE running at http://localhost:${PORT}`)
})
