// Per-tab Rules editor UI state (open side panels), so switching to a cube from
// the lineage panel and coming back doesn't close it.
const sessions = new Map()

export const getRulesSession = (tabId) => (tabId ? sessions.get(tabId) : undefined)
export const saveRulesSession = (tabId, state) => { if (tabId) sessions.set(tabId, state) }
