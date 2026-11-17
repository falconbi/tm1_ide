// A view entry is a dimension in one of its hierarchies: 'WFP Position', or 'WFP Position › By Location'
// for an ALT H (Alternate Hierarchy) — both can be on the grid at once (they share the same leaves).
const entryKey = p => (p?.hierarchy && p.hierarchy !== p.dimension) ? `${p.dimension} › ${p.hierarchy}` : p?.dimension

export default entryKey
