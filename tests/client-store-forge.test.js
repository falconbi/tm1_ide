'use strict'
// forge.json is the workspace layout, never an editor draft. Saving strips
// content/dirty; loading strips them again for an older client.

const { test, before } = require('node:test')
const assert = require('node:assert/strict')

let useStore
let posted = null

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
globalThis.window = {
  confirm: () => true,
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.fetch = async (url, init = {}) => {
  if (url === '/api/forge' && init.method === 'POST') posted = JSON.parse(init.body)
  return {
    ok: true,
    json: async () => ({
      server: 'S',
      tabs: [{ id: 'rules:S:A', type: 'rules', label: 'A', server: 'S', content: 'stale', dirty: true }],
      activeTab: 'rules:S:A',
      layout: { type: 'leaf', id: 'g1', tabIds: ['rules:S:A'], activeTabId: 'rules:S:A' },
      activeGroupId: 'g1',
    }),
  }
}

before(async () => {
  ({ useStore } = await import('../client/src/store/index.js'))
})

test('saving the workspace omits every content and dirty field', async () => {
  posted = null
  useStore.setState({
    tabs: [{ id: 'rules:S:A', type: 'rules', label: 'A', server: 'S', content: 'unsaved text', dirty: true }],
    layout: { type: 'leaf', id: 'g1', tabIds: ['rules:S:A'], activeTabId: 'rules:S:A' },
    groups: [{ type: 'leaf', id: 'g1', tabIds: ['rules:S:A'], activeTabId: 'rules:S:A' }],
    activeGroupId: 'g1',
    activeTab: 'rules:S:A',
  })
  useStore.getState().setServer('S')       // schedules _saveForge
  await new Promise(r => setTimeout(r, 900))
  assert.ok(posted?.tabs?.length, 'forge POST should have happened')
  for (const t of posted.tabs) {
    assert.equal('content' in t, false, 'content must not be saved')
    assert.equal('dirty' in t, false, 'dirty must not be saved')
  }
})

test('loading the workspace strips content/dirty left by an older client', async () => {
  await useStore.getState().loadForge()
  const tabs = useStore.getState().tabs
  assert.equal(tabs.length, 1)
  assert.equal('content' in tabs[0], false)
  assert.equal('dirty' in tabs[0], false)
})
