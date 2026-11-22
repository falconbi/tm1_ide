'use strict'

// A delete or a move that PROD made must be decided explicitly before a refresh
// applies. There is no default: an undecided delete left alone is silently put
// back on PROD by the next deploy (without its data), and an undecided move puts
// DEV's parenting back. Both are recorded once chosen.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { undecidedDecisions } = require('../core/refresh-dev')

const diff = () => ({
    removeElements: ['Gone', 'AlsoGone'],
    moves: [{ child: 'Moved', toParent: 'A', fromParent: 'B' }],
})

test('an undecided delete blocks — both of them, named', () => {
    const open = undecidedDecisions(diff(), { dimension: 'D' })
    assert.deepEqual(open.map(o => `${o.kind}:${o.element}`), ['delete:Gone', 'delete:AlsoGone', 'move:Moved'])
})

test('each delete needs its own choice; a partial set still blocks', () => {
    const open = undecidedDecisions(diff(), { dimension: 'D', deletes: { Gone: 'delete' }, moves: { Moved: 'take' } })
    assert.deepEqual(open.map(o => o.element), ['AlsoGone'])
})

test('"delete on DEV too" satisfies it', () => {
    const open = undecidedDecisions({ removeElements: ['Gone'], moves: [] }, { dimension: 'D', deletes: { Gone: 'delete' } })
    assert.equal(open.length, 0)
})

test('"keep it and restore it on PROD" satisfies it too — deliberately', () => {
    const open = undecidedDecisions({ removeElements: ['Gone'], moves: [] }, { dimension: 'D', deletes: { Gone: 'keep' } })
    assert.equal(open.length, 0)
})

test('a move is decided either way: take PROD\'s or keep DEV\'s', () => {
    const base = { removeElements: [], moves: [{ child: 'M', toParent: 'A', fromParent: 'B' }] }
    assert.equal(undecidedDecisions(base, { dimension: 'D', moves: { M: 'take' } }).length, 0)
    assert.equal(undecidedDecisions(base, { dimension: 'D', moves: { M: 'keep' } }).length, 0)
})

test('an invented choice does not count as decided', () => {
    const open = undecidedDecisions({ removeElements: ['Gone'], moves: [] }, { dimension: 'D', deletes: { Gone: 'maybe' } })
    assert.equal(open.length, 1)
})

test('nothing to decide when the target deleted and moved nothing', () => {
    assert.equal(undecidedDecisions({ removeElements: [], moves: [] }, { dimension: 'D' }).length, 0)
})
