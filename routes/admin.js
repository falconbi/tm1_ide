'use strict'

function register(app, deps) {
    const { catalogRoutes, cl, createCancelJobRoute, createProvisionUserRoute, fail, gateReadOnly, gateWrite, getServerCredentials, isAdminGroups, makeClient, odataKey, requireTm1Admin, sendMaintenanceError, setServerCredentials, txLogSearches, userServer } = deps

app.get('/api/jobs', async (req, res) => {
    try {
        res.json(await makeClient(req.query.server, req.ideToken).getJobs())
    } catch (e) {
        // Jobs endpoint is V12+ only — return empty list with flag for V11 servers
        const is404 = e.message?.includes('404') || e.response?.status === 404
        if (is404) return res.json({ items: [], v12only: true })
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/job/cancel', createCancelJobRoute({ makeClient, requireTm1Admin }))

app.get('/api/transactions', async (req, res) => {
    try {
        const { server, cube, top, elements, days } = req.query
        const parsed = elements ? JSON.parse(elements) : null
        const nDays  = Math.min(Math.max(parseInt(days) || 7, 1), 366)
        const client = makeClient(server, req.ideToken)
        // Logging off: TM1 keeps no history for this cube, so don't make it search for nothing.
        if (await client.getCubeLoggingOff(cube) === true) return res.json({ entries: [], loggingOff: true, days: nDays })
        const key = [req.ideToken ?? '', server, cube, nDays].join('|')
        let search = txLogSearches.get(key)
        if (!search) {
            search = client.getTransactionLog(cube, { top: 5000, days: nDays }).finally(() => txLogSearches.delete(key))
            txLogSearches.set(key, search)
        }
        const rows = await search
        const want = Array.isArray(parsed) ? parsed : null
        const entries = rows
            .filter(e => !want || want.every((el, i) => !el || (e.Tuple?.[i] ?? '') === el))
            .slice(0, top ? parseInt(top) : 200)
        res.json({ entries, loggingOff: false, days: nDays })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/transactions/restore', async (req, res) => {
    try {
        const { server, cube, tuple, restoreTo, expectNow, force } = req.body ?? {}
        if (!gateReadOnly(res, server)) return
        if (!server || !cube || !Array.isArray(tuple) || !tuple.length)
            return res.status(400).json({ error: 'server, cube and tuple are required' })
        const client = makeClient(server, req.ideToken)
        const me = await client.get('ActiveUser', { '$expand': 'Groups($select=Name)' })
        if (!isAdminGroups(me?.Groups))
            return res.status(403).json({ error: `Only TM1 admins can restore values from the transaction log on ${server}.` })
        const dims = ((await client.get(`Cubes('${odataKey(cube)}')/Dimensions`, { '$select': 'Name' })).value ?? []).map(d => d.Name)
        if (dims.length !== tuple.length)
            return res.status(400).json({ error: `The log row has ${tuple.length} elements but ${cube} has ${dims.length} dimensions.` })
        const br = x => String(x).replace(/]/g, ']]')
        // TM1 v11 rejects an axis-less SELECT, so the last dimension goes on columns, the rest in WHERE.
        const mem = i => `[${br(dims[i])}].[${br(dims[i])}].[${br(tuple[i])}]`
        const last = dims.length - 1
        const where = dims.slice(0, last).map((_, i) => mem(i)).join(',')
        const cell = await client.post('ExecuteMDX?$expand=Cells($select=Value)', {
            MDX: `SELECT {${mem(last)}} ON 0 FROM [${br(cube)}]${where ? ` WHERE (${where})` : ''}` })
        const current = cell?.Cells?.[0]?.Value ?? null
        const same = (a, b) => (a == null || a === '' ? 0 : a) == (b == null || b === '' ? 0 : b) || String(a ?? '') === String(b ?? '')
        if (!force && !same(current, expectNow))
            return res.status(409).json({ error: 'changed since', current })
        await client.writeCellValue(cube, dims.map((dim, i) => ({ dim, element: tuple[i] })), restoreTo ?? 0)
        cl.writeLog({ server, action: 'CELL_RESTORED', objectType: 'cell', objectName: cube,
            detail: `${tuple.join(' · ')}: ${current} → ${restoreTo} (restored from the transaction log)`,
            beforeState: { tuple, value: current }, afterState: { tuple, value: restoreTo }, user: req.user })
        res.json({ ok: true, previous: current, value: restoreTo })
    } catch (e) { fail(res, e) }
})

app.get('/api/threads', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const threads = await client.getThreads()
        res.json(threads)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/thread/cancel', async (req, res) => {
    try {
        if (!(await requireTm1Admin(req, res, req.query.server))) return
        await makeClient(req.query.server, req.ideToken).cancelThread(req.query.id)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/admin/metrics', async (req, res) => {
    try {
        const { server, cube } = req.query
        if (!(await requireTm1Admin(req, res, server))) return
        res.json(await makeClient(server, req.ideToken).getMetrics(cube || null))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/admin/configuration', async (req, res) => {
    try {
        if (!(await requireTm1Admin(req, res, req.query.server))) return
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getActiveConfiguration())
    } catch (e) {
        console.error('[config] error:', e.response?.status, e.response?.data ?? e.message)
        res.status(500).json({ error: e.message })
    }
})

app.patch('/api/admin/configuration', async (req, res) => {
    try {
        const { server, section = 'Administration', values } = req.body
        if (!gateReadOnly(res, server)) return
        if (!(await requireTm1Admin(req, res, server))) return
        res.json(await makeClient(server, req.ideToken).patchStaticConfiguration(section, values))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/admin/maintenance/enable', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.body.server)) return
        if (!(await requireTm1Admin(req, res, req.body.server))) return
        res.json(await makeClient(req.body.server, req.ideToken).enableMaintenanceMode())
    } catch (e) { sendMaintenanceError(res, e) }
})

app.post('/api/admin/maintenance/disable', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.body.server)) return
        if (!(await requireTm1Admin(req, res, req.body.server))) return
        res.json(await makeClient(req.body.server, req.ideToken).disableMaintenanceMode())
    } catch (e) { sendMaintenanceError(res, e) }
})

app.post('/api/users/provision', createProvisionUserRoute({ makeClient, gateReadOnly, requireTm1Admin, userServer, fail }))

app.post('/api/users/:name/password', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
        const { password } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.resetClientPassword(req.params.name, password)
        // Reset your own login on this server → keep the IDE signed in with the new one.
        const mine = getServerCredentials(req.ideToken, userServer(req))
        if (mine && mine.username.toLowerCase() === req.params.name.toLowerCase()) {
            setServerCredentials(req.ideToken, userServer(req), { username: mine.username, password }, mine.state)
        }
        res.json({ ok: true })
    } catch (e) { fail(res, e) }
})

app.get('/api/users', async (req, res) => {
    try {
        const cl = makeClient(userServer(req), req.ideToken)
        res.json(await cl.getClients())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/users/:name', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
        const { server: _s, ...patch } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.updateClient(req.params.name, patch)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/users/:name', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.deleteClient(req.params.name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/groups', async (req, res) => {
    try {
        const cl = makeClient(userServer(req), req.ideToken)
        res.json(await cl.getGroups())
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/users/:name/groups', async (req, res) => {
    try {
        const cl = makeClient(userServer(req), req.ideToken)
        res.json(await cl.getClientGroups(req.params.name))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/users/:name/groups', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
        const { group } = req.body
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.addClientToGroup(req.params.name, group)
        res.json({ ok: true })
    } catch (e) {
        console.error('[addClientToGroup]', e.response?.status, e.message)
        fail(res, e)
    }
})

app.delete('/api/users/:name/groups/:group', async (req, res) => {
    try {
        if (!gateReadOnly(res, userServer(req))) return
        if (!(await requireTm1Admin(req, res, userServer(req)))) return
        const cl = makeClient(userServer(req), req.ideToken)
        await cl.removeClientFromGroup(req.params.name, req.params.group)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/admin/catalog-overrides', catalogRoutes.get)

app.put('/api/admin/catalog-overrides', catalogRoutes.put)

app.post('/api/admin/validate-ti-functions', async (req, res) => {
    try {
        const { server, tests } = req.body
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const results = []
        for (const { name, code } of tests) {
            const procName = `}IDE_FnTest_${name}_${Date.now()}`
            let status = 'unknown'
            let message = ''
            try {
                await client.post('Processes', {
                    Name: procName,
                    PrologProcedure: code,
                    MetadataProcedure: '',
                    DataProcedure: '',
                    EpilogProcedure: '',
                    Parameters: [],
                    Variables: [],
                })
                status = 'valid'
                try { await client.delete(`Processes('${odataKey(procName)}')`) } catch {}
            } catch (e) {
                message = e.message ?? ''
                status = message.toLowerCase().includes('syntax') || message.toLowerCase().includes('equal sign') ? 'invalid' : 'error'
                try { await client.delete(`Processes('${odataKey(procName)}')`) } catch {}
            }
            results.push({ name, status, message })
        }
        res.json({ results })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})
}

module.exports = { register }
