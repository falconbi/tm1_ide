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

test('build_dimension logs every attribute value and the default Format', async () => {
    const builder = {
        async createDimension() {},
        async addElement() {},
        async addEdge() {},
        async createElementAttribute() {},
        async getElementAttributeValues() { return {} },
        async writeElementAttribute() {},
    }
    const h = setup({ mode: 'build', builder })
    await h.call('build_dimension', {
        name: 'Sales Measure',
        elements: [{ name: 'Amount', type: 'N' }],
        attributes: [{ name: 'Desc', type: 'String' }, { name: 'Code', type: 'String' }],
        attribute_values: [
            { element: 'Amount', attribute: 'Desc', value: 'Amount' },
            { element: 'Amount', attribute: 'Code', value: 'AMT' },
        ],
    })
    const values = h.changes.filter(c => c[0] === 'ATTRIBUTE_VALUE_SET')
    assert.equal(values.length, 3, `changes: ${JSON.stringify(h.changes)}`)
    assert.ok(values.some(c => c[2] === 'Sales Measure:Amount:Format'))
})
