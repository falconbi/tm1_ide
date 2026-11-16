'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeOverrides } = require('../core/catalog_overrides')

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

test('GET returns the overrides under a versioned wrapper', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8')
    const route = src.slice(src.indexOf("app.get('/api/admin/catalog-overrides'"), src.indexOf("app.put('/api/admin/catalog-overrides'"))
    assert.match(route, /overrides: raw, version:/)
})
