'use strict'
// The tab model a forker copies: open, close, split, move, reorder, close others /
// close to right, and history. Pure state; the store only needs storage/confirm stubs.

const { test, before, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

let useStore
const local = new Map()
globalThis.localStorage = {
  getItem: (k) => local.has(k) ? local.get(k) : null,
  setItem: (k, v) => local.set(k, String(v)),
  removeItem: (k) => local.delete(k),
}
globalThis.window = {
  confirm: () => true,
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })

before(async () => {
  ({ useStore } = await import('../client/src/store/index.js'))
})

const tab = (id, dirty = false) => ({ id, type: id.split(':')[0], label: id, dirty, server: 'S' })
const leaf = (id, tabIds, activeTabId = tabIds[0] ?? null) => ({ type: 'leaf', id, tabIds, activeTabId })

beforeEach(() => {
  useStore.setState({
    tabs: [],
    layout: leaf('g1', []),
    groups: [leaf('g1', [])],
    activeGroupId: 'g1',
    activeTab: null,
    tabHistory: [],
  })
})

test('openTab adds a tab to the active group and makes it active', () => {
  useStore.getState().openTab(tab('rules:S:A'))
  assert.deepEqual(useStore.getState().tabs.map(t => t.id), ['rules:S:A'])
  assert.deepEqual(useStore.getState().groups[0].tabIds, ['rules:S:A'])
  assert.equal(useStore.getState().activeTab, 'rules:S:A')
})

test('opening the same object again focuses it instead of duplicating it', () => {
  useStore.getState().openTab(tab('rules:S:A'))
  useStore.getState().openTab({ ...tab('rules:S:A'), scrollToLine: 12 })
  assert.equal(useStore.getState().tabs.length, 1)
  assert.equal(useStore.getState().tabs[0].scrollToLine, 12)
})

test('closeTab removes it from the group and picks the previous tab', () => {
  useStore.getState().openTab(tab('rules:S:A'))
  useStore.getState().openTab(tab('rules:S:B'))
  useStore.getState().closeTab('rules:S:B', 'g1')
  assert.deepEqual(useStore.getState().groups[0].tabIds, ['rules:S:A'])
  assert.equal(useStore.getState().activeTab, 'rules:S:A')
})

test('splitGroup creates a second leaf with the tab and supports both directions', () => {
  useStore.getState().openTab(tab('rules:S:A'))
  useStore.getState().splitGroup('horizontal', 'rules:S:A')
  assert.equal(useStore.getState().groups.length, 2)
  assert.equal(useStore.getState().layout.children[0].tabIds[0], 'rules:S:A')
  assert.equal(useStore.getState().layout.direction, 'horizontal')
  useStore.setState({ layout: leaf('g1', ['rules:S:A']), groups: [leaf('g1', ['rules:S:A'])], activeGroupId: 'g1' })
  useStore.getState().splitGroup('vertical', 'rules:S:A')
  assert.equal(useStore.getState().layout.direction, 'vertical')
})

test('moveTabToGroup moves a tab between panes', () => {
  const g1 = leaf('g1', ['rules:S:A'])
  const g2 = leaf('g2', ['rules:S:B'])
  useStore.setState({ tabs: [tab('rules:S:A'), tab('rules:S:B')], layout: { type: 'split', id: 's1', direction: 'horizontal', children: [g1, g2] }, groups: [g1, g2], activeGroupId: 'g1' })
  useStore.getState().moveTabToGroup('rules:S:A', 'g1', 'g2')
  assert.deepEqual(useStore.getState().groups.find(g => g.id === 'g1').tabIds, [])
  assert.deepEqual(useStore.getState().groups.find(g => g.id === 'g2').tabIds, ['rules:S:B', 'rules:S:A'])
})

test('reorderTabInGroup changes the order inside that pane only', () => {
  useStore.setState({ tabs: [tab('rules:S:A'), tab('rules:S:B'), tab('rules:S:C')], layout: leaf('g1', ['rules:S:A', 'rules:S:B', 'rules:S:C']), groups: [leaf('g1', ['rules:S:A', 'rules:S:B', 'rules:S:C'])] })
  useStore.getState().reorderTabInGroup('g1', 0, 2)
  assert.deepEqual(useStore.getState().groups[0].tabIds, ['rules:S:B', 'rules:S:C', 'rules:S:A'])
})

test('closeOtherTabsInGroup leaves only the chosen tab', () => {
  useStore.setState({ tabs: [tab('rules:S:A'), tab('rules:S:B')], layout: leaf('g1', ['rules:S:A', 'rules:S:B']), groups: [leaf('g1', ['rules:S:A', 'rules:S:B'])] })
  useStore.getState().closeOtherTabsInGroup('rules:S:A', 'g1')
  assert.deepEqual(useStore.getState().tabs.map(t => t.id), ['rules:S:A'])
})

test('closeTabsToRight removes only tabs after the chosen one', () => {
  useStore.setState({ tabs: [tab('rules:S:A'), tab('rules:S:B'), tab('rules:S:C')], layout: leaf('g1', ['rules:S:A', 'rules:S:B', 'rules:S:C']), groups: [leaf('g1', ['rules:S:A', 'rules:S:B', 'rules:S:C'])] })
  useStore.getState().closeTabsToRight('rules:S:A', 'g1')
  assert.deepEqual(useStore.getState().tabs.map(t => t.id), ['rules:S:A'])
})

test('opening objects records the last ten in history', () => {
  for (let i = 0; i < 12; i++) useStore.getState().openTab(tab(`rules:S:C${i}`))
  const history = useStore.getState().tabHistory
  assert.equal(history.length, 10)
  assert.equal(history[0].id, 'rules:S:C11')
})
