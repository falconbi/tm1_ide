'use strict'
// readonly mode offers no write tools at all — not refused at call time, simply
// absent from the tool list the agent sees.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./_mcp-harness')
const guard = require('../tools/tm1mcp/guard')

test('readonly registers every read tool and not one write tool', () => {
    const { registered, skipped, handlers } = setup({ mode: 'readonly' })
    assert.equal(registered.length, guard.READ_TOOLS.size)
    assert.ok(registered.every(t => t.kind === 'read'))
    for (const w of guard.WRITE_TOOLS) assert.equal(handlers[w], undefined, `${w} must not be registered in readonly`)
    assert.deepEqual(new Set(skipped), guard.WRITE_TOOLS)
})

test('build registers all 65 tools — every one classified', () => {
    const { registered } = setup({ mode: 'build' })
    assert.equal(registered.length, 65)
    assert.equal(guard.READ_TOOLS.size + guard.WRITE_TOOLS.size, 65)
})

test('an unclassified tool stops start-up', () => {
    assert.throws(() => guard.classify('drop_everything'), /not classified/)
})

test('mode: unset follows the server posture; build on a read-only server is refused', () => {
    assert.equal(guard.resolveMode(undefined, true), 'readonly')
    assert.equal(guard.resolveMode(undefined, false), 'build')
    assert.equal(guard.resolveMode('READONLY', false), 'readonly')
    assert.throws(() => guard.resolveMode('build', true), /read-only/)
    assert.throws(() => guard.resolveMode('admin', false), /readonly" or "build/)
})
