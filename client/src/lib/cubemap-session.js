// Per-tab Cube Map session (player step, phase focus, camera). The editor unmounts when
// another tab is opened — this keeps the map where you left it when you come back.
const sessions = new Map()

export const saveCubemapSession = (tabId, state) => { if (tabId) sessions.set(tabId, state) }
export const getCubemapSession = (tabId) => (tabId ? sessions.get(tabId) : undefined)
export const clearCubemapSession = (tabId) => { if (tabId) sessions.delete(tabId) }
