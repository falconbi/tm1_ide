'use strict'

// A target object that is MISSING is never "carried by the release", however the
// element-loss comparison reads. Having no elements to lose is not the same as
// having everything the release contains — and this is the case that let a
// recorded-as-delivered object sit missing on PROD without blocking a deploy.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { partitionCarriedDrift } = require('../core/git-deploy')

const dim = (dimName = 'ZZ Deploy Proof', status = 'M') =>
    ({ status, file: `dimensions/${dimName}.hierarchies/${dimName}.json`, blocking: true })

test('a dimension missing on the target blocks even with zero element loss', () => {
    const { blocking, carried } = partitionCarriedDrift([dim('ZZ Deploy Proof', 'D')], [])
    assert.equal(blocking.length, 1)
    assert.equal(carried.length, 0)
})

test('a modified dimension the release carries is still carried', () => {
    const { blocking, carried } = partitionCarriedDrift([dim('WFP Currency', 'M')], [])
    assert.equal(blocking.length, 0)
    assert.equal(carried.length, 1)
})

test('a missing object blocks while a modified one is carried — in the same run', () => {
    const { blocking, carried } = partitionCarriedDrift(
        [dim('ZZ Deploy Proof', 'D'), dim('WFP Currency', 'M')], [],
    )
    assert.deepEqual(blocking.map(e => e.file), ['dimensions/ZZ Deploy Proof.hierarchies/ZZ Deploy Proof.json'])
    assert.deepEqual(carried.map(e => e.file), ['dimensions/WFP Currency.hierarchies/WFP Currency.json'])
})

test('a missing dimension still blocks when its loss is known and zero', () => {
    const { blocking } = partitionCarriedDrift([dim('WFP Period', 'D')], [{ dimension: 'Other', hierarchy: 'Other', count: 1 }])
    assert.equal(blocking.length, 1)
})
