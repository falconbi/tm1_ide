// The conflict banner decision, kept pure so it can be tested without React.
// history is newest first; baselineId is the change log row this editor started from.
export function conflictEntry(history, username, baselineId) {
    const latest = history?.[0]
    if (!username || !latest) return null
    if (!latest.user || latest.user === username) return null
    if (latest.id === baselineId) return null
    return latest
}
