const VIEW_SESSIONS_KEY = 'tm1-view-sessions'
export function loadViewSessions() { try { return JSON.parse(localStorage.getItem(VIEW_SESSIONS_KEY) || '[]') } catch { return [] } }
export function saveViewSessionEntry(entry) {
    const list = loadViewSessions().filter(s => s.name !== entry.name)
    list.unshift({ ...entry, time: Date.now() })
    localStorage.setItem(VIEW_SESSIONS_KEY, JSON.stringify(list.slice(0, 30)))
}
