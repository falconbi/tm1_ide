'use strict'

// The one-button Ship must stop when a release would remove elements, and pass
// straight through when it would not. That decision is now a pure function
// (shared/deploy-loss-gate.cjs) so it is testable without a browser — the live
// run proves the wiring, this proves the rule.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { decideLossGate } = require('../shared/deploy-loss-gate.cjs')

test('nothing removed — Ship carries on with no extra step', () => {
    assert.equal(decideLossGate({ loss: { elements: 0, dimensions: 0 } }), 'pass')
    assert.equal(decideLossGate({ loss: null }), 'pass')
    assert.equal(decideLossGate({}), 'pass')
})

test('elements would be removed — Ship stops and asks', () => {
    assert.equal(decideLossGate({ loss: { elements: 1, dimensions: 1 } }), 'confirm')
    assert.equal(decideLossGate({ loss: { elements: 12, dimensions: 3 } }), 'confirm')
})

test('once confirmed, the same release proceeds', () => {
    assert.equal(decideLossGate({ loss: { elements: 1, dimensions: 1 }, confirmed: true }), 'pass')
})

test('a missing count is treated as no loss, never as a silent block', () => {
    assert.equal(decideLossGate({ loss: { dimensions: 2 } }), 'pass')
})
