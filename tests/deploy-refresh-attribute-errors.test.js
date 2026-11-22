'use strict'

// "Not chosen" and "failed" are different outcomes and must never be reported as
// the same. Attribute work reports three lists: changed, errors, decisions. A
// failure to create an attribute is an ERROR — it used to land in "skipped".

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { applyAttributeChanges } = require('../core/refresh-dev')

const prod = {
    getElementAttributes: async () => [{ Name: 'Loaded', Type: 'String' }],
    getElementAttributeValues: async () => ({ Loaded: 'yes' }),
}
const devOk = {
    getElementAttributes: async () => [],
    createElementAttribute: async () => ({}),
    deleteElementAttribute: async () => ({}),
    writeElementAttribute: async () => ({}),
}
const devFailsCreate = {
    getElementAttributes: async () => [],
    createElementAttribute: async () => { throw new Error('TM1 said no') },
    deleteElementAttribute: async () => ({}),
    writeElementAttribute: async () => ({}),
}

test('a created attribute is a change, not an error', async () => {
    const r = await applyAttributeChanges(devOk, prod, 'D', { creates: ['Loaded'] })
    assert.deepEqual(r.changed, ['attribute Loaded'])
    assert.equal(r.errors.length, 0)
})

test('an attribute nobody ticked is not created — attributes have no baseline', async () => {
    const r = await applyAttributeChanges(devOk, prod, 'D', {})
    assert.deepEqual(r.changed, [])
    assert.equal(r.errors.length, 0)
})

test('a creation that TM1 refuses is an ERROR, with its message — not a skip', async () => {
    const r = await applyAttributeChanges(devFailsCreate, prod, 'D', { creates: ['Loaded'] })
    assert.equal(r.changed.length, 0)
    assert.equal(r.errors.length, 1)
    assert.match(r.errors[0].why, /TM1 said no/)
    assert.equal(r.errors[0].what, 'attribute Loaded')
})

test('copying a value is a change; a failed write is an error', async () => {
    const ok = await applyAttributeChanges(devOk, prod, 'D', { confirmed: ['Loaded'], devElements: ['A'] })
    assert.ok(ok.changed.some(c => /values for Loaded \(1 cells\)/.test(c)))
    const bad = await applyAttributeChanges({ ...devOk, writeElementAttribute: async () => { throw new Error('write failed') } }, prod, 'D', { confirmed: ['Loaded'], devElements: ['A'] })
    assert.equal(bad.errors.length, 1)
    assert.match(bad.errors[0].why, /write failed/)
})

test('a type decision is recorded either way, and taking it needs no error', async () => {
    const prodType = { getElementAttributes: async () => [{ Name: 'Count', Type: 'Numeric' }] }
    const devType = { getElementAttributes: async () => [{ Name: 'Count', Type: 'String' }], deleteElementAttribute: async () => ({}), createElementAttribute: async () => ({}) }
    const take = await applyAttributeChanges(devType, prodType, 'D', { attributeTypes: { Count: 'take' } })
    assert.deepEqual(take.decisions, [{ kind: 'attribute', element: 'Count', choice: 'take' }])
    assert.equal(take.errors.length, 0)
    const keep = await applyAttributeChanges(devType, prodType, 'D', { attributeTypes: { Count: 'keep' } })
    assert.deepEqual(keep.decisions, [{ kind: 'attribute', element: 'Count', choice: 'keep' }])
    assert.equal(keep.changed.length, 0)
})
