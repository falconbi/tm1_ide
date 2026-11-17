'use strict'

function register(app, deps) {
    const { LOGIN_REQUIRED, PAW_HOST, SAMPLE_PASSWORD_WARNING, attachPawSession, cl, clearServerCredentials, closeServerSession, createDirectSession, createLocalSession, createSaveDataAllRoute, createSession, fail, gateReadOnly, getCSRF, getCachedPawSession, getLoginServer, getServerCredentials, getServerStatus, getSessionCredentials, invalidateSession, isAdminGroups, isDirectServer, isLoopbackReq, isPawNativeServer, isSampleLogin, isTm1Admin, listServerEntries, listServers, listServersWithFlags, loginRateLimit, makeClient, makeClientWithCredentials, path, probeAuthMethod, requireTm1Admin, sendSetupError, setServerCredentials, setSimpleInModes, setupBlankAdmin, simpleSource } = deps

app.post('/api/auth/login', loginRateLimit, async (req, res) => {
    const clearHits = () => loginRateLimit.clear(req)
    try {
        const { username, password } = req.body
        if (!username || !password) return res.status(400).json({ error: 'username and password required' })
        // Sign in through any server you have an account on (default: the configured login server).
        const via = req.body.server || getLoginServer()

        if (via && isDirectServer(via)) {
            const token = await createDirectSession(username, password)
            try {
                // These credentials belong to that server only — every other
                // server gets its own login (per-server login).
                setServerCredentials(token, via, { username, password })
                const cl = makeClient(via, token)
                await cl.get('Configuration')
                clearHits()
                res.json({ token, username, ...(isSampleLogin(username, password) ? { warning: SAMPLE_PASSWORD_WARNING } : {}) })
            } catch (e) {
                invalidateSession(token)
                res.status(401).json({ error: 'Login failed — check your TM1 credentials' })
            }
        } else {
            const token = await createSession(username, password)
            clearHits()
            res.json({ token, username })
        }
    } catch (e) { res.status(401).json({ error: 'Login failed' }) }
})

app.post('/api/auth/logout', async (req, res) => {
    const token = req.headers['x-ide-token']
    if (token) {
        await Promise.all(listServerEntries(token).map(([server, entry]) => closeServerSession(server, entry)))
        invalidateSession(token)
    }
    res.json({ ok: true })
})

app.post('/api/auth/setup-login', loginRateLimit, async (req, res) => {
    try {
        const { server, newPassword } = req.body ?? {}
        const { state } = await setupBlankAdmin(server, newPassword)
        const token = await createDirectSession('admin', newPassword)
        setServerCredentials(token, server, { username: 'admin', password: newPassword }, state)
        loginRateLimit.clear(req)
        res.json({ token, username: 'admin', server })
    } catch (e) { sendSetupError(res, e) }
})

app.post('/api/auth/local-session', async (req, res) => {
    if (LOGIN_REQUIRED || !isLoopbackReq(req)) return res.status(403).json({ error: 'Sign in required' })
    const token = await createLocalSession()
    res.json({ token, username: 'local' })
})

app.get('/api/auth/servers', async (req, res) => {
    try {
        res.json(await Promise.all(listServers().map(async name => {
            if (!isDirectServer(name)) return { name, status: 'paw', isAdmin: false }
            const st = getServerStatus(req.ideToken, name)
            const status = st === 'ok' ? 'signed-in' : st === 'rejected' ? 'rejected' : 'needs-login'
            return {
                name,
                status,
                username: getServerCredentials(req.ideToken, name)?.username ?? null,
                isAdmin: status === 'signed-in' ? await isTm1Admin(req, name) : false,
            }
        })))
    } catch (e) { fail(res, e) }
})

app.post('/api/auth/server-login', loginRateLimit, async (req, res) => {
    try {
        const { server, username, password, useCurrent, namespace } = req.body ?? {}
        if (!server) return res.status(400).json({ error: 'server required' })
        const creds = useCurrent ? getSessionCredentials(req.ideToken) : { username, password: password ?? '', namespace: namespace || null }
        if (useCurrent && !creds) return res.status(400).json({ error: 'No current login to reuse — enter a username and password' })
        if (!creds?.username) return res.status(400).json({ error: 'username required' })
        if (isPawNativeServer(server)) {
            // One PAW sign-in covers every server behind that PAW.
            try { await attachPawSession(req.ideToken, creds.username, creds.password) }
            catch { return res.status(403).json({ rejected: true, error: `PAW rejected the login for "${server}" — check the username and password` }) }
            loginRateLimit.clear(req)
            return res.json({ ok: true, server, username: creds.username, paw: true })
        }
        const state = {}
        const cl = makeClientWithCredentials(server, creds, state)
        if (!cl) return res.json({ ok: true })   // machine-credential connection — nothing to sign in to
        try {
            await cl.get('ActiveUser', { '$select': 'Name' })
        } catch (e) {
            if (e.code === 'TM1_AUTH_REJECTED') {
                return res.status(403).json({ rejected: true, error: `TM1 rejected the login for "${server}" — check the username and password` })
            }
            throw e
        }
        setServerCredentials(req.ideToken, server, { username: creds.username, password: creds.password, namespace: creds.namespace ?? null }, state)
        loginRateLimit.clear(req)
        res.json({ ok: true, server, username: creds.username, ...(isSampleLogin(creds.username, creds.password) ? { warning: SAMPLE_PASSWORD_WARNING } : {}) })
    } catch (e) { res.status(500).json({ error: `Could not reach "${req.body?.server}": ${e.message}` }) }
})

app.get('/api/auth/method', async (req, res) => {
    try {
        if (!req.query.server) return res.status(400).json({ error: 'server required' })
        res.json(await probeAuthMethod(String(req.query.server)))
    } catch (e) { res.status(502).json({ server: req.query.server, method: 'unreachable', error: e.message }) }
})

app.post('/api/auth/server-logout', async (req, res) => {
    const { server } = req.body ?? {}
    if (!server) return res.status(400).json({ error: 'server required' })
    await closeServerSession(server, clearServerCredentials(req.ideToken, server))
    res.json({ ok: true })
})

app.post('/api/servers/setup', loginRateLimit, async (req, res) => {
    try {
        const { server, newPassword } = req.body ?? {}
        const { state } = await setupBlankAdmin(server, newPassword)
        setServerCredentials(req.ideToken, server, { username: 'admin', password: newPassword }, state)
        res.json({ ok: true, server, username: 'admin' })
    } catch (e) { sendSetupError(res, e) }
})

app.get('/api/servers', (req, res) => {
    try { res.json(listServersWithFlags()) }
    catch (e) { fail(res, e) }
})

app.get('/api/paw/book-usage', async (req, res) => {
    try {
        const { server, cube, view } = req.query
        if (!server || !cube) return res.json({ books: [] })

        if (!PAW_HOST) return res.json({ books: [], pawUnavailable: true })

        let pawSession, csrf
        try {
            pawSession = await getCachedPawSession(req.ideToken)
            csrf = await getCSRF(pawSession)
        } catch {
            return res.json({ books: [], pawUnavailable: true })
        }
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
        const encodePath = (p) => encodeURIComponent(encodeURIComponent(p)) // odata-key: ok — PAW Assets path, not a TM1 key
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

app.get('/api/tm1-sessions', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const sessions = await client.getSessions()
        res.json(sessions)
    } catch (e) {
        console.error('[sessions] error:', e.response?.status, e.response?.data ?? e.message)
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/session', async (req, res) => {
    try {
        if (!(await requireTm1Admin(req, res, req.query.server))) return
        await makeClient(req.query.server, req.ideToken).disconnectSession(req.query.id)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/server/version', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json({ version: await client.getProductVersion() })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/server/save-data-all', createSaveDataAllRoute({
    makeClient,
    gateReadOnly,
    writeLog: cl.writeLog,
}))

app.post('/api/server/simple-mode', async (req, res) => {
    const { server, simple } = req.body ?? {}
    if (!server) return res.status(400).json({ error: 'server required' })
    try {
        if (simpleSource(server) === 'config') {
            return res.status(409).json({ error: `Simple mode for ${server} is set in config/servers.json — change it there.` })
        }
        const me = await makeClient(server, req.ideToken).get('ActiveUser', { '$expand': 'Groups($select=Name)' })
        if (!isAdminGroups(me?.Groups)) {
            return res.status(403).json({ error: `Only TM1 admins can change Simple mode on ${server}.` })
        }
        setSimpleInModes(server, !!simple)
        cl.writeLog({ server, action: simple ? 'SIMPLE_MODE_ON' : 'SIMPLE_MODE_OFF', objectType: 'server', objectName: server, detail: `Simple mode ${simple ? 'on' : 'off'}`, user: req.user })
        res.json({ ok: true, server, simple: !!simple })
    } catch (e) { fail(res, e) }
})
}

module.exports = { register }
