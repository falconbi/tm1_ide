// Build a tree using Components (explicit children) when available
export function buildElementTree(elements) {
    const byName = Object.fromEntries(elements.map(el => [el.Name, { ...el, children: [] }]))
    const hasComponents = elements.some(el => el.Components?.length)

    if (hasComponents) {
        const childSet = new Set()
        for (const el of elements) {
            for (const childName of (el.Components ?? [])) {
                if (byName[childName]) {
                    byName[el.Name].children.push(byName[childName])
                    childSet.add(childName)
                }
            }
        }
        return Object.values(byName).filter(n => !childSet.has(n.Name))
    }

    const maxLevel = Math.max(0, ...elements.map(el => el.Level ?? 0))
    if (maxLevel === 0) return elements.map(el => ({ ...el, children: [] }))

    const sorted = [...elements].sort((a, b) => (b.Level ?? 0) - (a.Level ?? 0))
    const roots = []
    for (const el of sorted) {
        byName[el.Name].children = []
        if ((el.Level ?? 0) === maxLevel) roots.push(byName[el.Name])
    }
    return roots
}
