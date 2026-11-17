// Rows pasted or uploaded into the structure grid: name, type, parent, weight.
// A blank line is dropped, a missing type is a leaf, and a missing or bad
// weight is 1.
export function parseTabDelimited(text) {
  return text.trim().split(/\r?\n/).map(line => {
    const cols = line.split('\t')
    return { name: cols[0]?.trim() ?? '', type: cols[1]?.trim() || 'N', parent: cols[2]?.trim() ?? '', weight: parseFloat(cols[3]) || 1 }
  }).filter(r => r.name)
}
