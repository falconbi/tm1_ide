import { create } from 'zustand'

let _forgeTimer = null
const _saveForge = (state) => {
  clearTimeout(_forgeTimer)
  _forgeTimer = setTimeout(() => {
    fetch('/api/forge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: state.server, tabs: state.tabs, activeTab: state.activeTab }),
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
      const r = await fetch('/api/forge')
      const forge = await r.json()
      const patch = {}
      if (forge.server) patch.server = forge.server
      if (forge.tabs?.length) { patch.tabs = forge.tabs; patch.activeTab = forge.activeTab ?? null }
      patch.forgeLoaded = true
      set(patch)
    } catch { set({ forgeLoaded: true }) }
  },

  // ── Server ──────────────────────────────────────────────────────────────────
  server: null,
  setServer: (server) => { set({ server }); _saveForge({ ...get(), server }) },

  // ── Tabs (open editors) ──────────────────────────────────────────────────────
  tabs: [],
  activeTab: null,

  openTab: (tab) => {
    const existing = get().tabs.find(t => t.id === tab.id)
    if (existing) {
      set(s => ({
        tabs: s.tabs.map(t => t.id === tab.id
          ? { ...t, scrollToLine: tab.scrollToLine ?? null, scrollToSection: tab.scrollToSection ?? null }
          : t),
        activeTab: tab.id,
      }))
    } else {
      set(s => ({ tabs: [...s.tabs, tab], activeTab: tab.id }))
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
    const tabs = get().tabs.filter(t => t.id !== id)
    const activeTab = get().activeTab === id
      ? (tabs.at(-1)?.id ?? null)
      : get().activeTab
    set({ tabs, activeTab })
    _saveForge({ ...get(), tabs, activeTab })
  },

  setActiveTab: (id) => { set({ activeTab: id }); _saveForge({ ...get(), activeTab: id }) },

  closeAllTabs: () => { set({ tabs: [], activeTab: null }); _saveForge({ ...get(), tabs: [], activeTab: null }) },

  initTabContent: (id, content) => {
    set(s => ({
      tabs: s.tabs.map(t => t.id === id ? { ...t, content } : t),
    }))
  },

  updateTabContent: (id, content) => {
    set(s => ({
      tabs: s.tabs.map(t => t.id === id ? { ...t, content, dirty: true } : t),
    }))
  },

  markTabSaved: (id) => {
    set(s => ({
      tabs: s.tabs.map(t => t.id === id ? { ...t, dirty: false } : t),
    }))
  },

  subsetVersions: {},
  bumpSubsetVersion: (server, dim) => set(s => ({
    subsetVersions: { ...s.subsetVersions, [`${server}::${dim}`]: (s.subsetVersions[`${server}::${dim}`] ?? 0) + 1 },
  })),

  // ── Reveal in Explorer tree ────────────────────────────────────────────────
  revealTarget: null,
  setRevealTarget: (target) => set({ revealTarget: { ...target, _ts: Date.now() } }),
  clearRevealTarget: () => set({ revealTarget: null }),
}))
