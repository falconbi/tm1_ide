import { create } from 'zustand'

/**
 * @typedef {'rules'|'process'|'subset'|'dimension'|'cubeview'} TabType
 *
 * @typedef {Object} Tab
 * @property {string}   id
 * @property {TabType}  type
 * @property {string}   label
 * @property {string}   server
 * @property {string}   [cube]        - rules, cubeview
 * @property {string}   [viewName]    - cubeview with a named view
 * @property {string}   [name]        - process
 * @property {string}   [dimension]   - dimension, subset
 * @property {string}   [subsetName]  - subset
 * @property {string}   [hierarchy]   - dimension
 * @property {string}   [content]     - editor content (null = not yet loaded)
 * @property {boolean}  [dirty]       - unsaved changes
 * @property {number}   [scrollToLine]
 * @property {string}   [scrollToSection]
 */

/**
 * @typedef {Object} RevealTarget
 * @property {'rules'|'cube'|'view'|'dimension'|'hierarchy'|'subset'|'process'} type
 * @property {string}  server
 * @property {string}  [cube]        - rules, cube, view
 * @property {string}  [viewName]    - view
 * @property {string}  [dimension]   - dimension, hierarchy, subset
 * @property {string}  [hierarchy]   - hierarchy
 * @property {string}  [subsetName]  - subset
 * @property {string}  [name]        - process
 */

let _forgeTimer = null

// ── Layout tree helpers (nested splits) ──────────────────────────────────────
// A layout node is either:
//   leaf:  { type:'leaf', id, tabIds[], activeTabId }
//   split: { type:'split', id, direction:'horizontal'|'vertical', children:[n,n] }
// The workspace root is a single node; splits nest recursively.
function isLeaf(n) { return n?.type === 'leaf' }
function collectLeaves(node) {
  if (!node) return []
  if (isLeaf(node)) return [node]
  return [...collectLeaves(node.children[0]), ...collectLeaves(node.children[1])]
}
function leafCount(node) { return isLeaf(node) ? 1 : leafCount(node.children[0]) + leafCount(node.children[1]) }
function findLeaf(node, id) {
  if (!node) return null
  if (isLeaf(node)) return node.id === id ? node : null
  return findLeaf(node.children[0], id) || findLeaf(node.children[1], id)
}
function findLeafByTab(node, tabId) {
  if (!node) return null
  if (isLeaf(node)) return node.tabIds.includes(tabId) ? node : null
  return findLeafByTab(node.children[0], tabId) || findLeafByTab(node.children[1], tabId)
}
function mapLeaves(node, fn) {
  if (isLeaf(node)) return fn(node)
  return { ...node, children: [mapLeaves(node.children[0], fn), mapLeaves(node.children[1], fn)] }
}
function replaceLeaf(node, leafId, replacement) {
  if (isLeaf(node)) return node.id === leafId ? replacement : node
  return { ...node, children: [replaceLeaf(node.children[0], leafId, replacement), replaceLeaf(node.children[1], leafId, replacement)] }
}
// Remove a leaf, collapsing a split that would drop to one child. null if empty.
function removeLeaf(node, leafId) {
  if (!node) return null
  if (isLeaf(node)) return node.id === leafId ? null : node
  const a = removeLeaf(node.children[0], leafId)
  const b = removeLeaf(node.children[1], leafId)
  if (!a) return b
  if (!b) return a
  return { ...node, children: [a, b] }
}
// Migrate the old flat groups[] (pre-nested-splits) into a layout tree.
function migrateGroupsToLayout(oldGroups) {
  if (!oldGroups?.length) return null
  let tree = { type: 'leaf', ...oldGroups[0] }
  for (const g of oldGroups.slice(1)) {
    tree = { type: 'split', id: `s${Date.now()}`, direction: 'horizontal', children: [tree, { type: 'leaf', ...g }] }
  }
  return tree
}

const _saveForge = (state) => {
  clearTimeout(_forgeTimer)
  _forgeTimer = setTimeout(() => {
    fetch('/api/forge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ide-token': localStorage.getItem('tm1-token') ?? '' },
      body: JSON.stringify({
        server: state.server,
        tabs: state.tabs,
        activeTab: state.activeTab,
        layout: state.layout,
        activeGroupId: state.activeGroupId,
      }),
    }).catch(() => {})
  }, 800)
}

export const useStore = create((set, get) => ({
  _init: (() => { if (typeof window !== 'undefined') window.__tm1store = { getState: () => get() } })(),
  // ── Theme ───────────────────────────────────────────────────────────────────
  dark: localStorage.getItem('tm1-theme') === 'dark' ||
    (!localStorage.getItem('tm1-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches),
  setDark: (dark) => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('tm1-theme', dark ? 'dark' : 'light')
    set({ dark })
  },
  themeVersion: 0,
  bumpThemeVersion: () => set(s => ({ themeVersion: s.themeVersion + 1 })),
  formatSettingsOpen: false,
  setFormatSettingsOpen: (v) => set({ formatSettingsOpen: v }),

  // ── Tab history (last 10 unique opened objects) ──────────────────────────────
  tabHistory: (() => {
    try { return JSON.parse(localStorage.getItem('tm1-tab-history') ?? '[]') } catch { return [] }
  })(),

  // ── Tab bar visibility ───────────────────────────────────────────────────────
  tabsVisible: localStorage.getItem('tm1-tabs-visible') !== 'false',
  toggleTabs: () => set(s => {
    const next = !s.tabsVisible
    localStorage.setItem('tm1-tabs-visible', String(next))
    return { tabsVisible: next }
  }),

  // ── Forge ───────────────────────────────────────────────────────────────────
  forgeLoaded: false,
  loadForge: async () => {
    try {
      const r = await fetch('/api/forge', { headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' } })
      const forge = await r.json()
      const patch = {}
      if (forge.server) patch.server = forge.server
      if (forge.tabs?.length) {
        patch.tabs = forge.tabs
        patch.activeTab = forge.activeTab ?? null
        const layout = forge.layout
          ? forge.layout
          : migrateGroupsToLayout(forge.groups)
          ?? { type: 'leaf', id: 'g1', tabIds: forge.tabs.map(t => t.id), activeTabId: forge.activeTab ?? null }
        patch.layout = layout
        patch.groups = collectLeaves(layout)
        patch.activeGroupId = forge.activeGroupId && findLeaf(layout, forge.activeGroupId)
          ? forge.activeGroupId
          : (patch.groups[0]?.id ?? 'g1')
      }
      patch.forgeLoaded = true
      set(patch)
    } catch { set({ forgeLoaded: true }) }
  },

  // ── Auth ────────────────────────────────────────────────────────────────────
  token:    localStorage.getItem('tm1-token')    ?? null,
  username: localStorage.getItem('tm1-username') ?? null,
  setAuth: (token, username) => {
    localStorage.setItem('tm1-token', token)
    localStorage.setItem('tm1-username', username)
    set({ token, username })
  },
  clearAuth: () => {
    localStorage.removeItem('tm1-token')
    localStorage.removeItem('tm1-username')
    set({ token: null, username: null })
  },

  // ── Server ──────────────────────────────────────────────────────────────────
  server: null,
  setServer: (server) => { set({ server }); _saveForge({ ...get(), server }) },
  serverVersion: null,
  setServerVersion: (serverVersion) => set({ serverVersion }),

  // ── Tabs & Editor Groups (nested split layout) ──────────────────────────────
  // tabs is flat; `layout` is the split tree; `groups` is the derived flat leaf
  // list (kept in sync so existing consumers keep working).
  tabs: [],
  activeTab: null,
  layout: { type: 'leaf', id: 'g1', tabIds: [], activeTabId: null },
  groups: [{ type: 'leaf', id: 'g1', tabIds: [], activeTabId: null }],
  activeGroupId: 'g1',

  /** @param {Tab} tab */
  openTab: (tab) => {
    const { layout, activeGroupId } = get()
    const holder = findLeafByTab(layout, tab.id)
    if (holder) {
      // Already open somewhere — activate that group and tab
      const newLayout = mapLeaves(layout, l => l.id === holder.id ? { ...l, activeTabId: tab.id } : l)
      set(s => ({
        tabs: s.tabs.map(t => t.id === tab.id
          ? { ...t, scrollToLine: tab.scrollToLine ?? null, scrollToSection: tab.scrollToSection ?? null }
          : t),
        layout: newLayout,
        groups: collectLeaves(newLayout),
        activeGroupId: holder.id,
        activeTab: tab.id,
      }))
    } else {
      // New tab — add to active leaf group
      const newLayout = mapLeaves(layout, l => l.id === activeGroupId
        ? { ...l, tabIds: [...l.tabIds, tab.id], activeTabId: tab.id }
        : l)
      set(s => ({
        tabs: [...s.tabs, tab],
        layout: newLayout,
        groups: collectLeaves(newLayout),
        activeTab: tab.id,
      }))
    }
    const { content, dirty, ...meta } = tab
    const history = [meta, ...get().tabHistory.filter(h => h.id !== tab.id)].slice(0, 10)
    localStorage.setItem('tm1-tab-history', JSON.stringify(history))
    set({ tabHistory: history })
    _saveForge(get())
  },

  clearScrollTo: (id) => {
    set(s => ({
      tabs: s.tabs.map(t => t.id === id ? { ...t, scrollToLine: null, scrollToSection: null } : t),
    }))
  },

  closeTab: (id) => {
    const { tabs, layout, activeGroupId } = get()
    const holder = findLeafByTab(layout, id)
    if (!holder) { set({ tabs: tabs.filter(t => t.id !== id) }); return }

    const newTabIds = holder.tabIds.filter(tid => tid !== id)
    let newLayout
    if (newTabIds.length === 0 && leafCount(layout) > 1) {
      // Last tab in a leaf that isn't the only one — collapse the split
      newLayout = removeLeaf(layout, holder.id)
    } else {
      const newActiveTabId = holder.activeTabId === id ? (newTabIds.at(-1) ?? null) : holder.activeTabId
      newLayout = mapLeaves(layout, l => l.id === holder.id ? { ...l, tabIds: newTabIds, activeTabId: newActiveTabId } : l)
    }

    // A split mirrors the same tab into another pane — closing here must NOT
    // destroy it there. Only delete the tab object if no leaf still references it.
    const stillReferenced = collectLeaves(newLayout).some(l => l.tabIds.includes(id))
    const newTabs = stillReferenced ? tabs : tabs.filter(t => t.id !== id)

    const groups = collectLeaves(newLayout)
    const newActiveGroupId = findLeaf(newLayout, activeGroupId) ? activeGroupId : (groups.at(-1)?.id ?? null)
    const newActiveTab = newActiveGroupId ? (findLeaf(newLayout, newActiveGroupId)?.activeTabId ?? null) : null
    set({ tabs: newTabs, layout: newLayout, groups, activeGroupId: newActiveGroupId, activeTab: newActiveTab })
    _saveForge(get())
  },

  setActiveTab: (id) => {
    const { layout } = get()
    const group = findLeafByTab(layout, id)
    if (!group) return
    const newLayout = mapLeaves(layout, l => l.id === group.id ? { ...l, activeTabId: id } : l)
    set({
      activeTab: id,
      activeGroupId: group.id,
      layout: newLayout,
      groups: collectLeaves(newLayout),
    })
    _saveForge(get())
  },

  closeAllTabs: () => {
    const l = { type: 'leaf', id: 'g1', tabIds: [], activeTabId: null }
    set({ tabs: [], activeTab: null, layout: l, groups: [l], activeGroupId: 'g1' })
    _saveForge(get())
  },

  // Split the leaf containing `tabId` (or the active leaf) into a nested split.
  splitGroup: (direction, tabId) => {
    const { layout, activeGroupId, activeTab } = get()
    const id = tabId ?? activeTab
    if (!id) return
    const targetLeaf = tabId
      ? (findLeafByTab(layout, tabId) ?? findLeaf(layout, activeGroupId))
      : findLeaf(layout, activeGroupId)
    if (!targetLeaf) return
    const newGroup = { type: 'leaf', id: `g${Date.now()}`, tabIds: [id], activeTabId: id }
    const split = { type: 'split', id: `s${Date.now()}`, direction, children: [targetLeaf, newGroup] }
    const newLayout = replaceLeaf(layout, targetLeaf.id, split)
    set({ layout: newLayout, groups: collectLeaves(newLayout), activeGroupId: newGroup.id, activeTab: id })
    _saveForge(get())
  },

  setActiveGroup: (groupId) => {
    const { layout } = get()
    const group = findLeaf(layout, groupId)
    if (!group) return
    set({ activeGroupId: groupId, activeTab: group.activeTabId })
  },

  closeGroup: (groupId) => {
    const { layout, tabs } = get()
    if (leafCount(layout) <= 1) return
    const group = findLeaf(layout, groupId)
    if (!group) return
    const newLayout = removeLeaf(layout, groupId)
    const groups = collectLeaves(newLayout)
    const otherTabIds = new Set(groups.flatMap(g => g.tabIds))
    const newTabs = tabs.filter(t => otherTabIds.has(t.id) || !group.tabIds.includes(t.id))
    const newActiveGroupId = groups.at(-1)?.id ?? null
    const newActiveTab = newActiveGroupId ? (findLeaf(newLayout, newActiveGroupId)?.activeTabId ?? null) : null
    set({ layout: newLayout, groups, activeGroupId: newActiveGroupId, tabs: newTabs, activeTab: newActiveTab })
    _saveForge(get())
  },

  reorderTabInGroup: (groupId, fromIdx, toIdx) => {
    const { layout } = get()
    const newLayout = mapLeaves(layout, l => {
      if (l.id !== groupId) return l
      const tabIds = [...l.tabIds]
      const [moved] = tabIds.splice(fromIdx, 1)
      tabIds.splice(toIdx, 0, moved)
      return { ...l, tabIds }
    })
    set({ layout: newLayout, groups: collectLeaves(newLayout) })
    _saveForge(get())
  },

  openTabInOtherGroup: (tabId) => {
    const { layout, activeGroupId } = get()
    const other = collectLeaves(layout).find(g => g.id !== activeGroupId)
    if (other) {
      const newLayout = mapLeaves(layout, l => l.id === other.id
        ? { ...l, tabIds: l.tabIds.includes(tabId) ? l.tabIds : [...l.tabIds, tabId], activeTabId: tabId }
        : l)
      set({ layout: newLayout, groups: collectLeaves(newLayout), activeGroupId: other.id, activeTab: tabId })
    } else {
      // No other pane — split the active leaf
      const activeLeaf = findLeaf(layout, activeGroupId)
      if (!activeLeaf) return
      const newGroup = { type: 'leaf', id: `g${Date.now()}`, tabIds: [tabId], activeTabId: tabId }
      const split = { type: 'split', id: `s${Date.now()}`, direction: 'horizontal', children: [activeLeaf, newGroup] }
      const newLayout = replaceLeaf(layout, activeLeaf.id, split)
      set({ layout: newLayout, groups: collectLeaves(newLayout), activeGroupId: newGroup.id, activeTab: tabId })
    }
    _saveForge(get())
  },

  moveTabToGroup: (tabId, fromGroupId, toGroupId) => {
    if (fromGroupId === toGroupId) return
    const { layout } = get()
    const newLayout = mapLeaves(layout, l => {
      if (l.id === fromGroupId) {
        const newTabIds = l.tabIds.filter(id => id !== tabId)
        return { ...l, tabIds: newTabIds, activeTabId: l.activeTabId === tabId ? (newTabIds.at(-1) ?? null) : l.activeTabId }
      }
      if (l.id === toGroupId) {
        return l.tabIds.includes(tabId) ? { ...l, activeTabId: tabId } : { ...l, tabIds: [...l.tabIds, tabId], activeTabId: tabId }
      }
      return l
    })
    set({ layout: newLayout, groups: collectLeaves(newLayout), activeGroupId: toGroupId, activeTab: tabId })
    _saveForge(get())
  },

  closeOtherTabsInGroup: (tabId, groupId) => {
    const { tabs, layout } = get()
    const group = findLeaf(layout, groupId)
    if (!group) return
    const idsToRemove = group.tabIds.filter(id => id !== tabId)
    const otherGroupTabIds = new Set(collectLeaves(layout).filter(g => g.id !== groupId).flatMap(g => g.tabIds))
    const tabsToDelete = idsToRemove.filter(id => !otherGroupTabIds.has(id))
    const newLayout = mapLeaves(layout, l => l.id === groupId ? { ...l, tabIds: [tabId], activeTabId: tabId } : l)
    set({ tabs: tabs.filter(t => !tabsToDelete.includes(t.id)), layout: newLayout, groups: collectLeaves(newLayout), activeTab: tabId })
    _saveForge(get())
  },

  closeTabsToRight: (tabId, groupId) => {
    const { tabs, layout } = get()
    const group = findLeaf(layout, groupId)
    if (!group) return
    const idx = group.tabIds.indexOf(tabId)
    if (idx < 0) return
    const idsToRemove = group.tabIds.slice(idx + 1)
    const otherGroupTabIds = new Set(collectLeaves(layout).filter(g => g.id !== groupId).flatMap(g => g.tabIds))
    const tabsToDelete = idsToRemove.filter(id => !otherGroupTabIds.has(id))
    const newLayout = mapLeaves(layout, l => l.id === groupId ? { ...l, tabIds: l.tabIds.slice(0, idx + 1), activeTabId: tabId } : l)
    set({ tabs: tabs.filter(t => !tabsToDelete.includes(t.id)), layout: newLayout, groups: collectLeaves(newLayout), activeTab: tabId })
    _saveForge(get())
  },

  initTabContent: (id, content) => {
    set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, content } : t) }))
  },

  updateTabContent: (id, content) => {
    set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, content, dirty: true } : t) }))
  },

  markTabSaved: (id) => {
    set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, dirty: false } : t) }))
  },

  patchTab: (id, props) => {
    set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, ...props } : t) }))
  },

  subsetVersions: {},
  bumpSubsetVersion: (server, dim) => set(s => ({
    subsetVersions: { ...s.subsetVersions, [`${server}::${dim}`]: (s.subsetVersions[`${server}::${dim}`] ?? 0) + 1 },
  })),

  rulesVersions: {},
  bumpRulesVersion: (server, cube) => set(s => ({
    rulesVersions: { ...s.rulesVersions, [`${server}::${cube}`]: (s.rulesVersions[`${server}::${cube}`] ?? 0) + 1 },
  })),

  formatVersions: {},
  bumpFormatVersion: (server, dim) => set(s => ({
    formatVersions: { ...s.formatVersions, [`${server}::${dim}`]: (s.formatVersions[`${server}::${dim}`] ?? 0) + 1 },
  })),

  // ── Reveal in Explorer tree ────────────────────────────────────────────────
  /** @type {RevealTarget|null} */
  revealTarget: null,
  /** @param {RevealTarget} target */
  setRevealTarget: (target) => set({ revealTarget: { ...target, _ts: Date.now() } }),
  clearRevealTarget: () => set({ revealTarget: null }),

  // ── Deploy Center ─────────────────────────────────────────────────────────
  // A full-screen takeover, not a tab — the entire normal IDE (sidebar, tab
  // bar, every open editor) is hidden while this is set. Closing it restores
  // the IDE exactly as it was; tab/group state is untouched by this.
  // Shape matches what DeployPanel already reads off a tab: { server, session?, release?, importDir? }
  deployCenter: null,
  openDeployCenter:  (config) => set({ deployCenter: config }),
  closeDeployCenter: () => set({ deployCenter: null }),
}))
