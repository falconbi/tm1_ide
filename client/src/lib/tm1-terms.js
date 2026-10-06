// Turn a repo file path (as exported by TM1 Git) into a TM1-language label,
// so a user reads "Default subset of WFP Period" not "…/WFP Period.subsets/Default.json".
export function humanizeFile(file) {
  const f = String(file ?? '')
  let m
  if ((m = f.match(/^dimensions\/(.+)\.hierarchies\/(.+)\.subsets\/(.+)\.json$/))) return `${m[3]} subset of ${m[1]}`
  if ((m = f.match(/^processes\/(.+)\.(json|ti)$/))) return `Process ${m[1]}`
  if ((m = f.match(/^dimensions\/(.+)\.hierarchies\/(.+)\.json$/)) || (m = f.match(/^dimensions\/(.+)\.json$/))) return `Dimension ${m[1]}`
  if ((m = f.match(/^cubes\/(.+)\.views\/(.+)\.json$/))) return `View ${m[2]} (${m[1]})`
  if ((m = f.match(/^cubes\/(.+)\.rules$/))) return `Rules of ${m[1]}`
  if ((m = f.match(/^cubes\/(.+)\.json$/))) return `Cube ${m[1]}`
  return f.replace(/\.json$/, '').replace(/\.ti$/, '')
}

// A human note for a drift entry given the file and the diff ("36 elements removed").
export function driftNote(file, diff) {
  const label = humanizeFile(file)
  const m = diff ? diff.match(/^-(\d+)(?:\s+)?(?:elements?|lines?|members?)/i) : null
  if (m) return `${label}: ${m[1]} removed`
  return label
}