// Parse the server debug log into structured events.
// Format blocks: __DBG_BP:line:section\n__DBG_VAR:name__Section__line=value\n
// ATTRS may strip trailing newlines, so blocks can concatenate:
//   ...=value__DBG_BP:nextLine:nextSection\n...
// Split on both \n and __DBG_BP: boundaries to handle either case.
export function parseDebugLog(log) {
  if (!log) return []
  const events = []
  // Split on __DBG_BP: to isolate capture blocks, then on \n within each block
  const blocks = log.split(/(?=\n?__DBG_BP:)/)
  for (const block of blocks) {
    const lines = block.split('\n')
    let bpSection = null, bpLine = null
    for (const rawLine of lines) {
      const trimmed = rawLine.trim()
      if (!trimmed || trimmed.startsWith('__DBG_DONE')) continue
      // BP marker: __DBG_BP:line:section
      const bpMatch = trimmed.match(/^__DBG_BP:(\d+):(\w+)/)
      if (bpMatch) { bpLine = +bpMatch[1]; bpSection = bpMatch[2]; continue }
      // Watch line: __DBG_VAR:name__Section__line=value
      let m = trimmed.match(/^__DBG_VAR:(.+)=(.+)$/)
      if (m) {
        const rawName = m[1]
        const value   = (m[2] ?? '').trim()
        // Strip trailing BP markers from concatenated blocks
        const cleanValue = value.replace(/__DBG_BP:.*$/, '').trim()
        const bp = rawName.match(/^(.+?)__(\w+)__(\d+)$/)
        if (bp) {
          events.push({ type: 'breakpoint', section: bp[2], line: +bp[3] })
          events.push({ type: 'watch', name: bp[1], section: bp[2], line: +bp[3], value: cleanValue })
        } else {
          events.push({ type: 'watch', name: rawName, section: bpSection || 'Epilog', line: bpLine, value: cleanValue })
        }
        continue
      }
      // Try greedier pattern (value may contain = signs): __DBG_VAR:name=value
      m = trimmed.match(/^__DBG_VAR:(.+?)=(.+)$/)
      if (m) {
        const rawName = m[1]
        const value   = (m[2] ?? '').replace(/__DBG_BP:.*$/, '').trim()
        const bp = rawName.match(/^(.+?)__(\w+)__(\d+)$/)
        if (bp) {
          events.push({ type: 'breakpoint', section: bp[2], line: +bp[3] })
          events.push({ type: 'watch', name: bp[1], section: bp[2], line: +bp[3], value })
        } else {
          events.push({ type: 'watch', name: rawName, section: bpSection || 'Epilog', line: bpLine, value })
        }
      }
    }
  }
  return events
}
