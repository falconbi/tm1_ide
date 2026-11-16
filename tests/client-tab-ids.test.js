'use strict'
// The same object must produce the same tab id from every opener, or "already
// open" detection fails and the object can appear in two tabs.

const { test } = require('node:test')
const assert = require('node:assert/strict')

// The helper is ESM; use a dynamic import (tests may run as CJS).
test('view ids: the default keeps the three-segment form, a named view adds its name', async () => {
  const m = await import('../client/src/lib/tab-ids.js')
  assert.equal(m.viewTabId('S', 'WFP', 'Default'), 'cubeview:S:WFP')
  assert.equal(m.viewTabId('S', 'WFP'), 'cubeview:S:WFP')
  assert.equal(m.viewTabId('S', 'WFP', 'Cost by CC'), 'cubeview:S:WFP:Cost by CC')
})

test('rules, process and dimension ids are one shape', async () => {
  const m = await import('../client/src/lib/tab-ids.js')
  assert.equal(m.rulesTabId('S', 'WFP'), 'rules:S:WFP')
  assert.equal(m.processTabId('S', 'Load'), 'process:S:Load')
  assert.equal(m.dimensionTabId('S', 'WFP Position'), 'dim:S:WFP Position:WFP Position')
  assert.equal(m.dimensionTabId('S', 'WFP Position', 'By Location'), 'dim:S:WFP Position:By Location')
})

test('subset ids keep the hierarchy when it is not the default', async () => {
  const m = await import('../client/src/lib/tab-ids.js')
  assert.equal(m.subsetTabId('S', 'WFP Position', 'WFP Position', 'Open Reqs'), 'subset:S:WFP Position:Open Reqs')
  assert.equal(m.subsetTabId('S', 'WFP Position', 'By Location', 'Cities'), 'subset:S:WFP Position:By Location:Cities')
})
