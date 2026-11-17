// Scan the rule text for `#Region name` comment lines. Regions are listed in
// file order; nesting and a missing `#EndRegion` do not change the scan.
const REGION_RE = /^#Region\b\s*(.*)$/i

export function scanRegions(lines) {
  const regions = []
  lines.forEach((text, i) => {
    const match = String(text).trim().match(REGION_RE)
    if (match) regions.push({ line: i + 1, name: match[1].trim() || 'Region' })
  })
  return regions
}
