'use strict'

// Drift on a dimension stops blocking once the release already carries what PROD
// changed there — that is what makes a refresh pay off. Everything else blocks.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { partitionCarriedDrift } = require('../core/git-deploy')

const dimEntry = (dim = 'WFP Currency') => ({ status: 'M', file: `dimensions/${dim}.hierarchies/${dim}.json`, blocking: true })

test('a dimension with no element loss is carried by the release', () => {
    const { blocking, carried } = partitionCarriedDrift([dimEntry()], [])
    assert.equal(blocking.length, 0)
    assert.equal(carried.length, 1)
    assert.equal(carried[0].carried, true)
})

test('the same dimension blocks as soon as an element would be lost — e.g. PROD changed after the refresh', () => {
    const { blocking, carried } = partitionCarriedDrift(
        [dimEntry()],
        [{ dimension: 'WFP Currency', hierarchy: 'WFP Currency', count: 1, sample: ['ZZ_AFTER'] }],
    )
    assert.equal(blocking.length, 1)
    assert.equal(carried.length, 0)
})

test('a cube, process or chore still blocks — the rule is about dimensions only', () => {
    for (const file of ['cubes/A.rules', 'processes/P.json', 'chores/C.json']) {
        const { blocking } = partitionCarriedDrift([{ status: 'M', file, blocking: true }], [])
        assert.equal(blocking.length, 1, file)
    }
})

test('views and subsets are reported, never blocking (as before)', () => {
    const { blocking, carried } = partitionCarriedDrift([{ status: 'M', file: 'cubes/A.views/V.json', blocking: false }], [])
    assert.equal(blocking.length, 0)
    assert.equal(carried.length, 1)
})

test('an unknown loss never counts as carried', () => {
    const { blocking } = partitionCarriedDrift([dimEntry()], undefined)
    assert.equal(blocking.length, 1)
    assert.equal(partitionCarriedDrift([dimEntry()], null).blocking.length, 1)
})

test('several dimensions: each is judged on its own loss', () => {
    const entries = [dimEntry('WFP Currency'), dimEntry('WFP Period')]
    const { blocking, carried } = partitionCarriedDrift(entries, [
        { dimension: 'WFP Period', hierarchy: 'WFP Period', count: 3, sample: ['A'] },
    ])
    assert.deepEqual(blocking.map(e => e.file), ['dimensions/WFP Period.hierarchies/WFP Period.json'])
    assert.deepEqual(carried.map(e => e.file), ['dimensions/WFP Currency.hierarchies/WFP Currency.json'])
})
