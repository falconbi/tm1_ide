'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeOverrides, createCatalogOverrideRoutes } = require('../core/catalog_overrides')
const fs = require('fs')
const os = require('os')
const path = require('path')

const empty = () => ({ ti: { overrides: {}, additions: {}, deletions: [] }, rules: { overrides: {}, additions: {}, deletions: [] } })

test('valid overrides keep only ti and rules', () => {
    const out = normalizeOverrides({
        ti: { overrides: { SUBNM: { params: ['dimname'], compat: 'both' } }, additions: { MYFN: { params: ['n'], returnType: 'numeric' } }, deletions: ['OLD'] },
        rules: { overrides: {}, additions: {}, deletions: [] },
    })
    assert.deepEqual(Object.keys(out), ['ti', 'rules'])
    assert.equal(out.ti.overrides.SUBNM.params[0], 'dimname')
    assert.equal(out.ti.additions.MYFN.returnType, 'numeric')
    assert.deepEqual(out.ti.deletions, ['OLD'])
})

test('unknown areas and fields are refused', () => {
    assert.throws(() => normalizeOverrides({ ...empty(), mdx: empty().ti }), /Unknown catalog area/)
    assert.throws(() => normalizeOverrides({ ...empty(), ti: { overrides: { X: { nonsense: 1 } } } }), /unknown field/)
})

test('prototype keys and non-string deletions are refused', () => {
    assert.throws(() => normalizeOverrides({ ...empty(), ti: { overrides: { ['__proto__']: {} } } }), /reserved key/)
    assert.throws(() => normalizeOverrides({ ti: { deletions: [1] }, rules: {} }), /only function names/)
})

test('missing areas become empty and duplicate deletions collapse', () => {
    const out = normalizeOverrides({ ti: { deletions: ['A', 'A'] } })
    assert.deepEqual(out.ti.deletions, ['A'])
    assert.deepEqual(out.rules, empty().rules)
})

test('the catalog route pair reads and validates through a factory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1-catalog-'))
    const file = path.join(dir, 'overrides.json')
    const routes = createCatalogOverrideRoutes({
        filePath: file,
        requireTm1Admin: async () => true,
        gateReadOnly: () => true,
        serverOf: () => 'S1',
    })
    const res = () => {
        const r = { statusCode: 200, body: null }
        r.status = code => { r.statusCode = code; return r }
        r.json = body => { r.body = body; return r }
        return r
    }
    try {
        let out = res()
        await routes.get({ query: {} }, out)
        assert.ok(out.body.overrides)
        assert.ok(out.body.version)

        out = res()
        await routes.put({ body: { ti: { deletions: ['OLD'] } } }, out)
        assert.equal(out.statusCode, 200)
        assert.ok(fs.existsSync(file))

        out = res()
        await routes.put({ body: { mdx: {} } }, out)
        assert.equal(out.statusCode, 400)
        assert.match(out.body.error, /Unknown catalog area/)
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('the catalog routes refuse a non-admin', async () => {
    const routes = createCatalogOverrideRoutes({
        filePath: '/tmp/does-not-matter.json',
        requireTm1Admin: async (_req, res) => { res.status(403).json({ error: 'TM1 Admin group required' }); return false },
        gateReadOnly: () => true,
        serverOf: () => 'S1',
    })
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
    await routes.get({ query: {} }, res)
    assert.equal(res.statusCode, 403)
})
