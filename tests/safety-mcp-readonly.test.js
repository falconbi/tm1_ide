'use strict'
// readonly mode offers no write tools at all — not refused at call time, simply
// absent from the tool list the agent sees.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./_mcp-harness')
const guard = require('../tools/tm1mcp/guard')
const { DEPLOY_CHECK_TOOLS } = require('../tools/tm1mcp/registry')

test('readonly registers read tools only — not one write tool', () => {
    const { registered, handlers } = setup({ mode: 'readonly', explicitTargets: true })
    assert.equal(registered.length, guard.READ_TOOLS.size)
    assert.ok(registered.every(t => t.kind === 'read'))
    for (const w of guard.WRITE_TOOLS) assert.equal(handlers[w], undefined, `${w} must not be registered in readonly`)
})

test('readonly offers the deploy checks only when target servers were named on purpose', () => {
    const plain = setup({ mode: 'readonly' })
    for (const t of DEPLOY_CHECK_TOOLS) assert.equal(plain.handlers[t], undefined, `${t} must not be offered without an explicit target list`)
    assert.equal(plain.registered.length, guard.READ_TOOLS.size - DEPLOY_CHECK_TOOLS.size)
    const named = setup({ mode: 'readonly', explicitTargets: true })
    for (const t of DEPLOY_CHECK_TOOLS) assert.equal(typeof named.handlers[t], 'function')
    const build = setup({ mode: 'build' })
    for (const t of DEPLOY_CHECK_TOOLS) assert.equal(typeof build.handlers[t], 'function', 'build mode unchanged')
})

test('build registers all 68 tools — every one classified', () => {
    const { registered } = setup({ mode: 'build' })
    assert.equal(registered.length, 68)
    assert.equal(guard.READ_TOOLS.size + guard.WRITE_TOOLS.size, 68)
})

test('an unclassified tool stops start-up', () => {
    assert.throws(() => guard.classify('drop_everything'), /not classified/)
})

test('mode: unset is readonly on every server; build only when asked; build on a read-only server is refused', () => {
    assert.equal(guard.resolveMode(undefined, true), 'readonly')
    assert.equal(guard.resolveMode(undefined, false), 'readonly', 'a writable server is still read-only until build is asked for')
    assert.equal(guard.resolveMode('', false), 'readonly')
    assert.equal(guard.resolveMode('build', false), 'build')
    assert.equal(guard.resolveMode('READONLY', false), 'readonly')
    assert.throws(() => guard.resolveMode('build', true), /read-only/)
    assert.throws(() => guard.resolveMode('admin', false), /readonly" or "build/)
})
