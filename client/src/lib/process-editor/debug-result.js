// A debug run's warnings become rows in the Issues panel.
export function debugIssues(res) {
  return (res?.warnings ?? []).map(w => ({
    severity: 'warning',
    section: w.section,
    line: w.line,
    message: w.msg || `Unknown function "${w.name}"`,
  }))
}

// Watches whose variable is not in the process: instrumenting one makes TI abort
// before a capture point can report, so the run warns instead. Names are
// case-insensitive, as in TM1.
export function unknownWatches(watches = [], availableVars = []) {
  const known = new Set((availableVars ?? []).map(v => String(v?.name ?? '').toLowerCase()))
  return (watches ?? []).filter(w => !known.has(String(w?.name ?? '').toLowerCase()))
}
