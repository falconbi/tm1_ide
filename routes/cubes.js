'use strict'

function register(app, deps) {
    const { ai, buildCubeMapModel, cl, fail, gateReadOnly, gateWrite, getCubeDataSources, invalidateCubeSources, makeClient, odataKey, parseDbRefs, parseRuleLens, scanIdentity } = deps

app.get('/api/cubes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getCubes())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/cube', async (req, res) => {
    try {
        const { server, name, dims } = req.body
        if (!server || !name?.trim() || !Array.isArray(dims) || dims.length < 2)
            return res.status(400).json({ error: 'Name and at least 2 dimensions are required' })
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.createCube(name.trim(), dims)
        const { hasSession } = cl.writeLog({ server, action: 'CUBE_CREATED', objectType: 'cube', objectName: name.trim(), user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        console.error('[view/save] error:', e.message, 'data:', JSON.stringify(e.response?.data).slice(0, 300))
        fail(res, e)
    }
})

app.delete('/api/cube', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteCube(req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'CUBE_DELETED', objectType: 'cube', objectName: req.query.name, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/rules', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const cube   = await client.getCube(req.query.cube)
        res.json({ rules: cube?.Rules ?? '' })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/rules', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        const current = await client.getCube(req.query.cube).catch(() => null)
        const beforeState = { text: current?.Rules ?? '' }
        await client.patch(`Cubes('${odataKey(req.query.cube)}')`, { Rules: req.body.rules })
        invalidateCubeSources(req.query.server)
        const afterState  = { text: req.body.rules }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'RULES_SAVED', objectType: 'rules', objectName: req.query.cube, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/rules/check', async (req, res) => {
    try {
        const { server, cube, rules } = req.body
        const client = makeClient(server, req.ideToken)
        const result = await client.post(`Cubes('${odataKey(cube)}')/tm1.CheckRules`, { Rules: rules })
        res.json({ errors: result.value ?? [] })
    } catch (e) { fail(res, e) }
})

app.get('/api/cube/dimensions', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const cube   = await client.getCube(req.query.cube)
        const dims   = (cube?.Dimensions ?? []).map(d => d.Name)
        res.json(dims)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/cube/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanCubeUsage(req.query.cube))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/lineage', async (req, res) => {
    try {
        const client   = makeClient(req.query.server, req.ideToken)
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
        const client = makeClient(req.query.server, req.ideToken)
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

app.get('/api/model/cubes', async (req, res) => {
    try {
        res.json(await makeClient(req.query.server, req.ideToken).getModelCubes())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/cube/trace', async (req, res) => {
    try {
        const { server, cube, dimElemPairs } = req.body
        res.json(await makeClient(server, req.ideToken).traceCellCalculation(cube, dimElemPairs))
    } catch (e) { fail(res, e) }
})

app.post('/api/cube/rules/check-references', async (req, res) => {
    try {
        const { server, cube, rules } = req.body
        res.json(await makeClient(server, req.ideToken).checkRulesReferences(cube, rules))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/control/objects', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getControlObjects())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/cells/write', async (req, res) => {
    try {
        const { server, cube, dims, value } = req.body
        if (!gateReadOnly(res, server)) return
        if (!server || !cube || !Array.isArray(dims) || dims.length === 0)
            return res.status(400).json({ error: 'server, cube, and dims are required' })
        const client = makeClient(server, req.ideToken)
        const result = await client.writeCellValue(cube, dims, value)
        res.json({ ok: true })
    } catch (e) {
        console.error('[cells/write] ERROR:', e.message)
        fail(res, e)
    }
})

app.post('/api/model-health', async (req, res) => {
    try {
        const server = req.query.server ?? req.body?.server
        if (!server) return res.status(400).json({ error: 'server required' })
        const { check } = require('../core/model-health')
        res.json(await check(server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/cube/rules-lens', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const name = req.query.cube
        const cube = await client.getCube(name)
        if (!cube) return res.status(404).json({ error: `Cube "${name}" not found` })
        const dims = (cube.Dimensions ?? []).map(d => d.Name)
        const measureDim = dims.find(d => /measure/i.test(d)) ?? null
        const measureEls = measureDim ? await client.getElements(measureDim).catch(() => []) : []
        const allCubes = await client.getAllCubesWithRules().catch(() => [])
        const cubeNames = new Set(allCubes.map(c => c.Name))
        const parsed = parseRuleLens(cube.Rules ?? '', { measureElements: new Set(measureEls.map(e => e.Name)) })
        const checks = []
        const referenced = parsed.items.flatMap(i => [...(i.dbSources ?? []), ...(i.targetCubes ?? [])])
        const missing = [...new Set(referenced.filter(c => !cubeNames.has(c)))]
        if (missing.length) checks.push({ level: 'error', message: `Reads or feeds cubes that do not exist: ${missing.join(', ')}` })
        if ((cube.Rules ?? '').trim() && parsed.summary.feeders === 0) checks.push({ level: 'warn', message: 'No feeder statements found.' })
        res.json({ cube: name, dims, measureDim, hasRules: !!(cube.Rules ?? '').trim(), ...parsed, checks })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/cube/data-sources', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        if (req.query.refresh) invalidateCubeSources(req.query.server)
        const data = await getCubeDataSources(client, req.query.server, req.query.cube, scanIdentity(req))
        res.json({ ...data, aiConfigured: ai.isConfigured() })
    } catch (e) {
        fail(res, e)
    }
})

app.get('/api/cubemap/model', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await buildCubeMapModel(client))
    } catch (e) {
        fail(res, e)
    }
})
}

module.exports = { register }
