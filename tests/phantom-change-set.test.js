'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { isPhantom } = require(path.join(__dirname, '..', 'core', 'phantom-change-set'))

const empty = { cubes: new Set(), dimensions: new Set(), processes: new Set(), chores: new Set() }

test('a set whose objects are all gone is a phantom', () => {
    assert.equal(isPhantom([
        { object_type: 'dimension', object_name: 'LAB Period' },
        { object_type: 'cube', object_name: 'LAB Workforce Cost' },
        { object_type: 'process', object_name: 'LAB Assignment Base' },
    ], empty), true)
})

test('one surviving object keeps the set active', () => {
    assert.equal(isPhantom([{ object_type: 'dimension', object_name: 'LAB Period' }], { ...empty, dimensions: new Set(['LAB Period']) }), false)
})

test('a set with no object changes is a phantom', () => {
    assert.equal(isPhantom([{ object_type: 'process-run', object_name: 'X' }], empty), true)
})

test('subset and view checks stay conservative when their parent exists', () => {
    assert.equal(isPhantom([{ object_type: 'subset', object_name: 'Default', detail: 'Region' }], { ...empty, dimensions: new Set(['Region']) }), false)
    assert.equal(isPhantom([{ object_type: 'view', object_name: 'Default', detail: 'Sales' }], { ...empty, cubes: new Set(['Sales']) }), false)
})
