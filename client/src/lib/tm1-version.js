// TM1 server-version helpers — used to gate function-catalog completions and
// validation by compat ('both' | 'v11' | 'v12').
//
// Version strings from GET /Configuration/ProductVersion look like
// "11.8.00100.42" (V11 / PA 2.0) or "12.0.00000.0" (TM1 Database 12 / PA 3+).

export function parseTM1Version(value) {
  const s = String(value ?? '').trim()
  const m = /^(\d+)/.exec(s)
  const major = m ? parseInt(m[1], 10) : null
  return {
    raw: s,
    major,
    known: major != null,
    isV11: major >= 11 && major < 12,
    isV12: major >= 12,
  }
}

// "V12 · 12.5.8" / "V11 · 11.8.01300" — the release, not just the major version:
// 12.x ships roughly monthly and features arrive mid-line (maintenance mode: 12.6).
export function serverLabel(value) {
  const { raw, known, major } = parseTM1Version(value)
  if (!known) return 'unknown'
  return `V${major} · ${raw.split('.').slice(0, 3).join('.')}`
}

// A function with this compat is available on a server of this version.
export function compatAvailable(compat, version) {
  if (!compat || compat === 'both') return true
  const { known, isV12 } = parseTM1Version(version)
  if (!known) return true // unknown version — don't gate
  if (compat === 'v12') return isV12
  if (compat === 'v11') return !isV12
  return true
}

// Warning message when a function's compat conflicts with the connected server.
export function compatWarning(compat, version) {
  if (!compat || compat === 'both') return null
  const { known, isV12 } = parseTM1Version(version)
  if (!known) return null
  if (compat === 'v12' && !isV12)
    return `only available on TM1 Database 12 (PA 3+) — this server is ${serverLabel(version)}`
  if (compat === 'v11' && isV12)
    return 'removed in TM1 Database 12 (PA 3) — V11 classic only'
  return null
}

// Server features that only exist on some versions — the one place the UI asks
// "does this server have X?" so every feature shows, hides or explains itself the
// same way. Checked per server (a migration can mean V11 PROD next to a V12 DEV).
// Unknown version → everything on, and the call itself reports what's missing.
export function serverCapabilities(version) {
  const { known, isV12 } = parseTM1Version(version)
  const v12 = !known || isV12
  return {
    jobs:    v12,  // Jobs (background work) — V12 REST only
    metrics: v12,  // Metrics() — V12 database API; Server Admin's Status tab (maintenance mode, 12.6+, lives there too)
  }
}
