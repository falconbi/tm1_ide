// Parse the server debug log into structured events.
// Element names: "vCount" (Epilog final), "vCount__Prolog__10" (breakpoint)
export function parseDebugLog(log) {
  if (!log) return []
  const events = []
  for (const line of log.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('__DBG_DONE')) continue
    const m = trimmed.match(/^__DBG_VAR:(.+)=(.*)$/)
    if (!m) continue
    const rawName = m[1]
    const value   = (m[2] ?? '').trim()
    // Check for breakpoint encoding: name__Section__line
    const bpMatch = rawName.match(/^(.+?)__(\w+)__(\d+)$/)
    if (bpMatch) {
      events.push({ type: 'breakpoint', section: bpMatch[2], line: +bpMatch[3] })
      events.push({ type: 'watch', name: bpMatch[1], section: bpMatch[2], line: +bpMatch[3], value })
    } else {
      events.push({ type: 'watch', name: rawName, section: 'Epilog', line: null, value })
    }
  }
  return events
}
