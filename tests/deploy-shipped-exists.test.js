'use strict'

// The deploy checks that every object the change set claims is on the target when
// it ends — including an object the release inherited from its base and never
// listed as "changed". A recorded delivery that is not there is what poisoned the
// next deploy; this is the path list that check walks, deduped by object.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { shippedTargetPaths } = require('../core/git-deploy')

test('a process listed twice (two files) is checked once', () => {
    const paths = shippedTargetPaths([
        { type: 'process', name: 'P' },
        { type: 'process', name: 'P' },
    ])
    assert.equal(paths.length, 1)
    assert.equal(paths[0].label, 'process P')
})

test('each type maps to its own entity path', () => {
    const paths = shippedTargetPaths([
        { type: 'dimension', name: 'D' },
        { type: 'cube', name: 'C' },
        { type: 'view', name: 'V', parent: 'C' },
        { type: 'subset', name: 'S', parent: 'D' },
        { type: 'process', name: 'P' },
        { type: 'chore', name: 'H' },
    ])
    assert.deepEqual(paths.map(p => p.path.split('/')[0].replace(/\('.*$/, '')), ['Dimensions', 'Cubes', 'Cubes', 'Dimensions', 'Processes', 'Chores'])
    assert.ok(paths.find(p => p.label === 'view V').path.includes("/Views('V')"))
    assert.ok(paths.find(p => p.label === 'subset S').path.includes("/Subsets('S')"))
})

test('an unknown type is skipped, never guessed', () => {
    assert.equal(shippedTargetPaths([{ type: 'other', name: 'x' }]).length, 0)
    assert.equal(shippedTargetPaths([{ type: 'dimension' }]).length, 0)
    assert.equal(shippedTargetPaths([]).length, 0)
})
