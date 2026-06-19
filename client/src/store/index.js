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
        groups: state.groups,
        activeGroupId: state.activeGroupId,
        splitDirection: state.splitDirection,
        panelSizes: state.panelSizes,
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
        if (forge.groups?.length) {
          patch.groups = forge.groups
          patch.activeGroupId = forge.activeGroupId ?? forge.groups[0].id
        } else {
          // Migrate old single-group forge state
          patch.groups = [{ id: 'g1', tabIds: forge.tabs.map(t => t.id), activeTabId: forge.activeTab ?? null }]
          patch.activeGroupId = 'g1'
        }
      }
      if (forge.splitDirection) patch.splitDirection = forge.splitDirection
      if (forge.panelSizes)    patch.panelSizes    = forge.panelSizes
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

  // ── Tabs & Editor Groups ─────────────────────────────────────────────────────
  // tabs is flat; groups track which tabIds belong to each group and which is active.
  tabs: [],
  activeTab: null,
  groups: [{ id: 'g1', tabIds: [], activeTabId: null }],
  activeGroupId: 'g1',
  splitDirection: 'horizontal',
  setSplitDirection: (dir) => { set({ splitDirection: dir }); _saveForge(get()) },
  panelSizes: null,
  setPanelSizes: (sizes) => { set({ panelSizes: sizes }); _saveForge(get()) },

  /** @param {Tab} tab */
  openTab: (tab) => {
    const { groups, activeGroupId } = get()
    const existingGroup = groups.find(g => g.tabIds.includes(tab.id))
    if (existingGroup) {
      // Already open somewhere — activate that group and tab
      set(s => ({
        tabs: s.tabs.map(t => t.id === tab.id
          ? { ...t, scrollToLine: tab.scrollToLine ?? null, scrollToSection: tab.scrollToSection ?? null }
          : t),
        groups: s.groups.map(g => g.id === existingGroup.id ? { ...g, activeTabId: tab.id } : g),
        activeGroupId: existingGroup.id,
        activeTab: tab.id,
      }))
    } else {
      // New tab — add to active group
      set(s => ({
        tabs: [...s.tabs, tab],
        groups: s.groups.map(g => g.id === activeGroupId
          ? { ...g, tabIds: [...g.tabIds, tab.id], activeTabId: tab.id }
          : g),
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
    const { tabs, groups, activeGroupId } = get()
    const newTabs = tabs.filter(t => t.id !== id)
    const groupIdx = groups.findIndex(g => g.tabIds.includes(id))
    if (groupIdx < 0) { set({ tabs: newTabs }); return }

    const group = groups[groupIdx]
    const newTabIds = group.tabIds.filter(tid => tid !== id)
    let newGroups, newActiveGroupId = activeGroupId

    if (newTabIds.length === 0 && groups.length > 1) {
      // Last tab in group and not the only group — remove the group
      newGroups = groups.filter((_, i) => i !== groupIdx)
      newActiveGroupId = newGroups[Math.max(0, groupIdx - 1)].id
    } else {
      const newActiveTabId = group.activeTabId === id ? (newTabIds.at(-1) ?? null) : group.activeTabId
      newGroups = groups.map((g, i) => i === groupIdx ? { ...g, tabIds: newTabIds, activeTabId: newActiveTabId } : g)
    }

    const newActiveTab = newGroups.find(g => g.id === newActiveGroupId)?.activeTabId ?? null
    set({ tabs: newTabs, groups: newGroups, activeGroupId: newActiveGroupId, activeTab: newActiveTab })
    _saveForge(get())
  },

  setActiveTab: (id) => {
    const group = get().groups.find(g => g.tabIds.includes(id))
    if (!group) return
    set(s => ({
      activeTab: id,
      activeGroupId: group.id,
      groups: s.groups.map(g => g.id === group.id ? { ...g, activeTabId: id } : g),
    }))
    _saveForge(get())
  },

  closeAllTabs: () => {
    set({ tabs: [], activeTab: null, groups: [{ id: 'g1', tabIds: [], activeTabId: null }], activeGroupId: 'g1' })
    _saveForge(get())
  },

  splitGroup: (direction, tabId) => {
    const { activeTab } = get()
    const id = tabId ?? activeTab
    if (!id) return
    const newGroupId = `g${Date.now()}`
    set(s => ({
      groups: [...s.groups, { id: newGroupId, tabIds: [id], activeTabId: id }],
      activeGroupId: newGroupId,
      ...(direction ? { splitDirection: direction } : {}),
    }))
    _saveForge(get())
  },

  setActiveGroup: (groupId) => {
    const group = get().groups.find(g => g.id === groupId)
    if (!group) return
    set({ activeGroupId: groupId, activeTab: group.activeTabId })
  },

  closeGroup: (groupId) => {
    const { groups, tabs } = get()
    if (groups.length <= 1) return
    const groupIdx = groups.findIndex(g => g.id === groupId)
    if (groupIdx < 0) return
    const group = groups[groupIdx]
    const newGroups = groups.filter(g => g.id !== groupId)
    const newActiveGroupId = newGroups[Math.max(0, groupIdx - 1)].id
    const otherTabIds = new Set(newGroups.flatMap(g => g.tabIds))
    const newTabs = tabs.filter(t => otherTabIds.has(t.id) || !group.tabIds.includes(t.id))
    const newActiveTab = newGroups.find(g => g.id === newActiveGroupId)?.activeTabId ?? null
    set({ groups: newGroups, activeGroupId: newActiveGroupId, tabs: newTabs, activeTab: newActiveTab })
    _saveForge(get())
  },

  reorderTabInGroup: (groupId, fromIdx, toIdx) => {
    set(s => ({
      groups: s.groups.map(g => {
        if (g.id !== groupId) return g
        const tabIds = [...g.tabIds]
        const [moved] = tabIds.splice(fromIdx, 1)
        tabIds.splice(toIdx, 0, moved)
        return { ...g, tabIds }
      }),
    }))
    _saveForge(get())
  },

  openTabInOtherGroup: (tabId) => {
    const { groups, activeGroupId } = get()
    const otherGroup = groups.find(g => g.id !== activeGroupId)
    if (otherGroup) {
      set(s => ({
        groups: s.groups.map(g => g.id === otherGroup.id
          ? { ...g, tabIds: g.tabIds.includes(tabId) ? g.tabIds : [...g.tabIds, tabId], activeTabId: tabId }
          : g),
        activeGroupId: otherGroup.id,
        activeTab: tabId,
      }))
    } else {
      const newGroupId = `g${Date.now()}`
      set(s => ({
        groups: [...s.groups, { id: newGroupId, tabIds: [tabId], activeTabId: tabId }],
        activeGroupId: newGroupId,
        activeTab: tabId,
      }))
    }
    _saveForge(get())
  },

  moveTabToGroup: (tabId, fromGroupId, toGroupId) => {
    if (fromGroupId === toGroupId) return
    set(s => ({
      groups: s.groups.map(g => {
        if (g.id === fromGroupId) {
          const newTabIds = g.tabIds.filter(id => id !== tabId)
          return { ...g, tabIds: newTabIds, activeTabId: g.activeTabId === tabId ? (newTabIds.at(-1) ?? null) : g.activeTabId }
        }
        if (g.id === toGroupId) {
          return g.tabIds.includes(tabId) ? { ...g, activeTabId: tabId } : { ...g, tabIds: [...g.tabIds, tabId], activeTabId: tabId }
        }
        return g
      }),
      activeGroupId: toGroupId,
      activeTab: tabId,
    }))
    _saveForge(get())
  },

  closeOtherTabsInGroup: (tabId, groupId) => {
    const { tabs, groups } = get()
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    const idsToRemove = group.tabIds.filter(id => id !== tabId)
    const otherGroupTabIds = new Set(groups.filter(g => g.id !== groupId).flatMap(g => g.tabIds))
    const tabsToDelete = idsToRemove.filter(id => !otherGroupTabIds.has(id))
    set(s => ({
      tabs: s.tabs.filter(t => !tabsToDelete.includes(t.id)),
      groups: s.groups.map(g => g.id === groupId ? { ...g, tabIds: [tabId], activeTabId: tabId } : g),
      activeTab: tabId,
    }))
    _saveForge(get())
  },

  closeTabsToRight: (tabId, groupId) => {
    const { tabs, groups } = get()
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    const idx = group.tabIds.indexOf(tabId)
    if (idx < 0) return
    const idsToRemove = group.tabIds.slice(idx + 1)
    const otherGroupTabIds = new Set(groups.filter(g => g.id !== groupId).flatMap(g => g.tabIds))
    const tabsToDelete = idsToRemove.filter(id => !otherGroupTabIds.has(id))
    set(s => ({
      tabs: s.tabs.filter(t => !tabsToDelete.includes(t.id)),
      groups: s.groups.map(g => g.id === groupId ? { ...g, tabIds: g.tabIds.slice(0, idx + 1), activeTabId: tabId } : g),
      activeTab: tabId,
    }))
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

  // ── Reveal in Explorer tree ────────────────────────────────────────────────
  /** @type {RevealTarget|null} */
  revealTarget: null,
  /** @param {RevealTarget} target */
  setRevealTarget: (target) => set({ revealTarget: { ...target, _ts: Date.now() } }),
  clearRevealTarget: () => set({ revealTarget: null }),
}))
