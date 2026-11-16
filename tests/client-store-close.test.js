'use strict'
// The tab store must not lose a dirty editor without asking — on every close path.
// Plain Zustand: no DOM beyond a confirm stub and the storage access the store does
// at module load.

const { test, before, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

let useStore
let confirms = []

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}
globalThis.window = {
  confirm: (message) => { confirms.push(message); return true },
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })

before(async () => {
  ({ useStore } = await import('../client/src/store/index.js'))
})

const tab = (id, dirty = false, label = id, type = 'rules') => ({ id, type, label, dirty, server: 'S' })
const leaf = (id, tabIds, activeTabId = tabIds[0] ?? null) => ({ type: 'leaf', id, tabIds, activeTabId })

function reset(tabs, layout = leaf('g1', tabs.map(t => t.id)), activeGroupId = 'g1') {
  confirms = []
  window.confirm = (message) => { confirms.push(message); return true }
  useStore.setState({ tabs, layout, groups: layout.type === 'split' ? layout.children : [layout], activeGroupId, activeTab: layout.activeTabId ?? null })
}

beforeEach(() => { confirms = [] })

test('closeTab asks before discarding a dirty tab', () => {
  reset([tab('a', true, 'Budget')])
  window.confirm = (m) => { confirms.push(m); return false }
  useStore.getState().closeTab('a')
  assert.equal(useStore.getState().tabs.length, 1)
  assert.equal(confirms.length, 1)
  window.confirm = (m) => { confirms.push(m); return true }
  useStore.getState().closeTab('a')
  assert.equal(useStore.getState().tabs.length, 0)
})

test('closeTab with no dirty tab never asks', () => {
  reset([tab('a')])
  useStore.getState().closeTab('a')
  assert.equal(confirms.length, 0)
  assert.equal(useStore.getState().tabs.length, 0)
})

test('closeGroup asks once and names the dirty tab', () => {
  const g1 = leaf('g1', ['a'])
  const g2 = leaf('g2', ['b'])
  reset([tab('a', true, 'Budget')], { type: 'split', id: 's1', direction: 'horizontal', children: [g1, g2] }, 'g1')
  window.confirm = (m) => { confirms.push(m); return false }
  useStore.getState().closeGroup('g1')
  assert.equal(useStore.getState().groups.length, 2)
  assert.match(confirms[0], /Budget/)
  window.confirm = (m) => { confirms.push(m); return true }
  useStore.getState().closeGroup('g1')
  assert.equal(useStore.getState().groups.length, 1)
})

test('closeOtherTabsInGroup asks before removing dirty siblings', () => {
  reset([tab('a'), tab('b', true, 'Costs')])
  window.confirm = (m) => { confirms.push(m); return false }
  useStore.getState().closeOtherTabsInGroup('a', 'g1')
  assert.equal(useStore.getState().tabs.length, 2)
  assert.equal(confirms.length, 1)
  window.confirm = () => true
  useStore.getState().closeOtherTabsInGroup('a', 'g1')
  assert.deepEqual(useStore.getState().tabs.map(t => t.id), ['a'])
})

test('closeTabsToRight asks before removing dirty tabs', () => {
  reset([tab('a'), tab('b', true, 'Costs'), tab('c')])
  window.confirm = (m) => { confirms.push(m); return false }
  useStore.getState().closeTabsToRight('a', 'g1')
  assert.equal(useStore.getState().tabs.length, 3)
  window.confirm = () => true
  useStore.getState().closeTabsToRight('a', 'g1')
  assert.deepEqual(useStore.getState().tabs.map(t => t.id), ['a'])
})

test('closeAllTabs asks when anything is dirty', () => {
  reset([tab('a'), tab('b', true, 'Costs')])
  window.confirm = (m) => { confirms.push(m); return false }
  useStore.getState().closeAllTabs()
  assert.equal(useStore.getState().tabs.length, 2)
  window.confirm = () => true
  useStore.getState().closeAllTabs()
  assert.equal(useStore.getState().tabs.length, 0)
})
