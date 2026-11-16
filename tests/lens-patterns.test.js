'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { listPatterns, readPattern } = require('../core/lens_patterns')
const { lensWrites } = require('../core/lens_bridge')

// There are no prebuilt templates: every Lens's code is its own, stored in the
// model. The patterns are worked demonstrations to learn from.
test('the patterns list with what they show and an example config; each has code; odd names are refused', () => {
  const list = listPatterns()
  assert.ok(list.length >= 10)
  for (const e of list) for (const k of ['name', 'title', 'description', 'sample']) assert.ok(e[k], `${e.name}: ${k}`)
  assert.match(readPattern('input-form'), /Lens\.config\(\)/)
  assert.throws(() => readPattern('../../etc/passwd'), /Unknown Lens pattern/)
  assert.throws(() => readPattern('no-such-example'), /Unknown Lens pattern/)
})

test('a Lens runs its own code, and what it may write comes from its code and config', () => {
  assert.deepEqual(lensWrites({ html: '<meta name="lens-writes" content="Plan">', config: { writes: ['Capital'] } }).sort(), ['Capital', 'Plan'])
  assert.deepEqual(lensWrites({ template: 'input-form', html: '', config: {} }), [], 'a stale template name gives a Lens nothing')
})

test('saving a Lens needs its code — there is no template to fall back on', async () => {
  const store = require('../core/model-store')
  const saved = {}
  const orig = { readDoc: store.readDoc, writeDoc: store.writeDoc }
  store.readDoc = async () => null
  store.writeDoc = async (s, a, n, doc) => { saved[n] = doc }
  try {
    const ls = require('../core/lens_store')
    await assert.rejects(ls.saveLens('S', 'Empty', '', 'me', {}), /needs its code/)
    const d = await ls.saveLens('S', 'Budget', '<p>own</p>', 'me', { template: 'input-form' })
    assert.equal(saved['Budget.json'].html, '<p>own</p>')
    assert.equal(d.template, undefined, 'no template is recorded')
  } finally { Object.assign(store, orig) }
})
