'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const realBsq = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBsq(':memory:') } }
const cl = require(path.join(__dirname, '..', 'core', 'change_log'))

test('attribute-value entries build a scoped manifest', () => {
    const s = cl.startSession('attrs', 'SRC', 'admin')
    const detail = { dimension: 'Region', hierarchy: 'Region', element: 'North', attribute: 'Code', before: 'N1', after: 'N2' }
    cl.writeLog({ server: 'SRC', action: 'ATTRIBUTE_VALUE_SET', objectType: 'attribute-value', objectName: 'Region:North:Code', detail, user: 'admin' })
    cl.writeLog({ server: 'SRC', action: 'ATTRIBUTE_VALUE_SET', objectType: 'attribute-value', objectName: 'Region:South:Code', detail: { ...detail, element: 'South', before: 'S1', after: 'S2' }, user: 'admin' })
    cl.writeLog({ server: 'SRC', action: 'SUBSET_DELETED', objectType: 'subset', objectName: 'Old Subset', detail: 'Region', user: 'admin' })

    const m = cl.getSessionManifest(s.id)
    assert.deepEqual(m.dims, ['Region'])
    assert.deepEqual(m.attrElements.map(p => `${p.dim}.${p.element}.${p.attribute}`), ['Region.North.Code', 'Region.South.Code'])
    assert.deepEqual(m.deletes, [{ type: 'subset', name: 'Old Subset', detail: 'Region' }])
})

test('attribute definitions contribute their dimension without inventing a pair', () => {
    const s = cl.startSession('attrs2', 'SRC', 'admin')
    cl.writeLog({ server: 'SRC', action: 'ATTRIBUTE_CREATED', objectType: 'attribute', objectName: 'Code', detail: 'Region', user: 'admin' })
    const m = cl.getSessionManifest(s.id)
    assert.deepEqual(m.dims, ['Region'])
    assert.deepEqual(m.attrElements, [])
})
