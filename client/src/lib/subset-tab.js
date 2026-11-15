/**
 * Subset tabs are per (server, dimension, hierarchy, name). A subset name can be
 * reused in another hierarchy, so the default hierarchy keeps the old id shape and
 * an alternate hierarchy adds its name before the subset name.
 */
export function subsetTabId(server, dimension, hierarchy, name, stamp) {
  const h = hierarchy ?? dimension
  return `subset:${server}:${dimension}${h !== dimension ? `:${h}` : ''}:${name ?? `new:${stamp ?? Date.now()}`}`
}

export function subsetLocateId(dimension, hierarchy, name) {
  const h = hierarchy ?? dimension
  return `subset:${dimension}${h !== dimension ? `:${h}` : ''}:${name}`
}
