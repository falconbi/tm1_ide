// "12 cubes · 9 processes · 2 dimensions" for the thread bar.
export default function reachText(b, capped) {
  if (!b) return ''
  const part = (n, one, many) => (n ? `${n} ${n === 1 ? one : many}` : null)
  const parts = [part(b.cubes, 'cube', 'cubes'), part(b.processes, 'process', 'processes'), part(b.dims, 'dimension', 'dimensions')].filter(Boolean)
  return parts.length ? `· ${parts.join(' · ')}${capped ? ' (capped)' : ''}` : ''
}
