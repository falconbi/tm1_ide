'use strict'
function register(app, deps) {
    const { FORGE_PATH, fail, fs, path } = deps

app.get('/api/forge', (req, res) => {
    try {
        const data = fs.existsSync(FORGE_PATH)
            ? JSON.parse(fs.readFileSync(FORGE_PATH, 'utf8'))
            : {}
        res.json(data)
    } catch (e) { fail(res, e) }
})

app.post('/api/forge', (req, res) => {
    try {
        fs.mkdirSync(path.dirname(FORGE_PATH), { recursive: true })
        // The workspace file is layout only. Strip an old client's editor bodies and
        // dirty flags so they cannot be written back.
        const body = { ...(req.body ?? {}) }
        if (Array.isArray(body.tabs)) body.tabs = body.tabs.map(({ content: _c, dirty: _d, ...meta }) => meta)
        fs.writeFileSync(FORGE_PATH, JSON.stringify(body, null, 2))
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})
}

module.exports = { register }
