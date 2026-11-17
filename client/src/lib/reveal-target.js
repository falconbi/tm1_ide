// What "Show in tree" should reveal for the active tab, or null when the tab
// has no Explorer target.
/**
 * @param {import('@/store').Tab} tab
 * @returns {import('@/store').RevealTarget|null}
 */
export function getRevealTarget(tab) {
  if (!tab) return null
  if (tab.type === 'rules')     return { type: 'rules',     server: tab.server, cube: tab.cube }
  if (tab.type === 'process')   return { type: 'process',   server: tab.server, name: tab.name }
  if (tab.type === 'subset')    return { type: 'subset',    server: tab.server, dimension: tab.dimension, hierarchy: tab.hierarchy, subsetName: tab.subsetName }
  if (tab.type === 'dimension') return { type: 'dimension', server: tab.server, dimension: tab.dimension }
  if (tab.type === 'cubeview' || tab.type === 'view') {
    if (tab.viewName) return { type: 'view', server: tab.server, cube: tab.cube, viewName: tab.viewName }
    return { type: 'cube', server: tab.server, cube: tab.cube }
  }
  return null
}
