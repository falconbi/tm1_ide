'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))
const arReal = require(resolve('core/adapter-registry'))
const updates = []
const source = {
    async getElementAttributes() { return [{ Name: 'Desc', Type: 'String' }] },
    async getElementAttributeValues() { return { Desc: '' } },
}
const target = {
    async updateCells(_cube, rows) { updates.push(...rows) },
}
require.cache[resolve('core/adapter-registry')] = {
    id: resolve('core/adapter-registry'), filename: resolve('core/adapter-registry'), loaded: true,
    exports: { ...arReal, makeClient: s => (s === 'SRC' ? source : target) },
}
const { syncAttributeValues } = require(resolve('core/git-reconcile'))

test('a blank attribute value is written as a clear, not skipped', async () => {
    updates.length = 0
    const out = await syncAttributeValues('SRC', 'TGT', {
        dims: ['Region'],
        attrElements: [{ dim: 'Region', element: 'North', attribute: 'Desc' }],
    })
    assert.deepEqual(out.errors, [])
    assert.equal(updates.length, 1)
    assert.equal(updates[0].value, '')
})
