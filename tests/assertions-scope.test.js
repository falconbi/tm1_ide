'use strict'

// What a run includes: quality never gates, and a test that owns its data (a
// fixture) never runs on the target.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { shouldRun } = require('../core/assertions')

const a = (o = {}) => ({ id: 'x', description: 'd', scope: 'logic', ...o })

test('logic without a fixture runs everywhere', () => {
    assert.equal(shouldRun(a(), { sourceServer: 'DEV' }), true)
    assert.equal(shouldRun(a(), { sourceServer: 'DEV', targetServer: 'PROD' }), true)
})

test('quality is excluded from the close and from the target', () => {
    assert.equal(shouldRun(a({ scope: 'quality' }), { sourceServer: 'DEV', scope: 'logic' }), false)
    assert.equal(shouldRun(a({ scope: 'quality' }), { sourceServer: 'DEV', targetServer: 'PROD' }), false)
    assert.equal(shouldRun(a({ scope: 'quality' }), { sourceServer: 'PROD' }), true)
})

test('a fixture test runs only where its data lives', () => {
    assert.equal(shouldRun(a({ fixture: true }), { sourceServer: 'DEV' }), true)
    assert.equal(shouldRun(a({ fixture: true }), { sourceServer: 'DEV', targetServer: 'PROD' }), false)
    assert.equal(shouldRun(a({ setup: { process: 'Setup' } }), { sourceServer: 'DEV', targetServer: 'PROD' }), false)
})

test('kind, severity and tags still filter', () => {
    assert.equal(shouldRun(a({ kind: 'control' }), { sourceServer: 'DEV', kind: 'control' }), true)
    assert.equal(shouldRun(a({ kind: 'behaviour' }), { sourceServer: 'DEV', kind: 'control' }), false)
    assert.equal(shouldRun(a({ severity: 'warn' }), { sourceServer: 'DEV', severity: 'block' }), false)
    assert.equal(shouldRun(a({ tags: ['paye'] }), { sourceServer: 'DEV', tags: ['paye'] }), true)
    assert.equal(shouldRun(a({ tags: ['paye'] }), { sourceServer: 'DEV', tags: ['tax'] }), false)
})
