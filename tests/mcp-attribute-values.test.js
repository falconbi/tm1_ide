'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./_mcp-harness')

test('set_attribute_values logs the changed pair as ATTRIBUTE_VALUE_SET', async () => {
    const h = setup({ mode: 'build' })
    await h.call('set_attribute_values', {
        dimension: 'Region',
        values: [{ element: 'North', attribute: 'Code', value: 'N2' }],
    })
    const entry = h.changes.find(c => c[0] === 'ATTRIBUTE_VALUE_SET')
    assert.ok(entry, `changes: ${JSON.stringify(h.changes)}`)
    assert.equal(entry[1], 'attribute-value')
    assert.equal(entry[2], 'Region:North:Code')
})
