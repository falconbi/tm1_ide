/**
 * Shared pivot · tree — the drill-down logic: element trees, which rows and
 * columns show for a given expand state, and the "is this a total?" rules.
 * Pure functions, no imports, so the IDE, the Lens toolkit and node tests all
 * run the same code. (Was inside the IDE's old HierarchyGrid / View editor; see
 * docs/lenses/PIVOT_PLAN.md for the bugs fixed here.)
 *
 * A hierarchy: { name, nodes: { [id]: { id, label, isLeaf, children, level, depth } },
 *                roots: [id], maxLevel, maxDepth }
 *   level = TM1's level (0 = leaf, counted up); depth = steps down from the top.
 *
 * Expand state per axis: expandedSets[0] = Set of open ids (outer dimension);
 * expandedSets[i>0] = Map<contextKey, Set> — the inner dimension's open ids under
 * each combination of outer members ('a::b'); '*' = the same under every one;
 * no entry = fully open.
 */

// depth of every node from the given roots (shortest path; a node under two parents gets the shallower)
function depths(nodes, roots) {
    const d = {}
    const queue = roots.map(r => [r, 0])
    while (queue.length) {
        const [id, k] = queue.shift()
        if (d[id] !== undefined && d[id] <= k) continue
        d[id] = k
        for (const c of nodes[id]?.children ?? []) if (nodes[c]) queue.push([c, k + 1])
    }
    return d
}

function finish(nodes, name) {
    const childSet = new Set(Object.values(nodes).flatMap(n => n.children))
    const roots    = Object.keys(nodes).filter(id => !childSet.has(id))
    const d        = depths(nodes, roots)
    for (const id of Object.keys(nodes)) nodes[id].depth = d[id] ?? 0
    const all = Object.values(nodes)
    return {
        nodes, roots, name,
        maxLevel: Math.max(0, ...all.map(n => n.level ?? 0)),
        maxDepth: Math.max(0, ...all.map(n => n.depth ?? 0)),
    }
}

// TM1 elements [{ Name, Type: 'N'|'S'|'C', Level, Components: [childName] }] → a hierarchy
export function buildHierarchy(elements, name) {
    if (!elements?.length) return null
    const nodes = {}
    for (const el of elements) {
        nodes[el.Name] = {
            id:       el.Name,
            label:    el.Name,
            level:    el.Level ?? 0,
            isLeaf:   el.Type !== 'C',
            children: el.Components ?? [],
        }
    }
    return finish(nodes, name)
}

// Keep only the members a query returned. A total stays a total even when its
// children were filtered out — so it is never offered for typing.
export function constrainHierarchy(hierarchy, presentMembers) {
    if (!hierarchy || !presentMembers?.length) return hierarchy
    const present = new Set(presentMembers)
    const nodes = {}
    for (const id of presentMembers) {
        const node = hierarchy.nodes[id]
        if (!node || nodes[id]) continue
        nodes[id] = { ...node, children: (node.children ?? []).filter(c => present.has(c)) }
    }
    // a total whose direct children were left out but whose lower levels are here (FY with the
    // quarters, not the halves): remember those, so the totals position still puts it before / after them
    for (const id of Object.keys(nodes)) {
        if (nodes[id].isLeaf) continue
        const skip = [], seen = new Set(), stack = (hierarchy.nodes[id].children ?? []).filter(c => !present.has(c))
        while (stack.length) {
            const c = stack.pop(); if (seen.has(c)) continue; seen.add(c)
            for (const g of hierarchy.nodes[c]?.children ?? []) present.has(g) ? skip.push(g) : stack.push(g)
        }
        if (skip.length) nodes[id].skipKids = [...new Set(skip)]
    }
    return finish(nodes, hierarchy.name)
}

// every non-leaf node with children — the "fully open" state
export function allExpanded(nodes) {
    return new Set(Object.keys(nodes).filter(id => !nodes[id].isLeaf && nodes[id].children?.length))
}

export function initExpandedSets(hierarchies) {
    return hierarchies.map((h, i) => i === 0 ? allExpanded(h.nodes ?? {}) : new Map())
}

// the open ids of dimension dimIdx under an outer context
export function expandedFor(hierarchies, expandedSets, dimIdx, contextKey) {
    if (dimIdx === 0) return expandedSets[0] ?? new Set()
    const map = expandedSets[dimIdx]
    return (map instanceof Map ? (map.get(contextKey) ?? map.get('*')) : null) ?? allExpanded(hierarchies[dimIdx]?.nodes ?? {})
}

// Visible ids of one dimension, in tree order. keepMode 'replace' shows an open
// parent's children instead of the parent; totalsAtBottom puts parents after children.
export function computeVisibleNodes(roots, nodes, expanded, keepMode, totalsAtBottom = false) {
    const result = []
    function visit(nodeId) {
        const node = nodes[nodeId]
        if (!node) return
        const isOpen      = expanded.has(nodeId)
        const hasChildren = !node.isLeaf && node.children?.length > 0
        const showParent  = keepMode === 'replace' ? !(isOpen && hasChildren) : true
        if (!totalsAtBottom && showParent) result.push(nodeId)
        if (isOpen && hasChildren) for (const c of placeTotals(node.children, nodes, totalsAtBottom)) visit(c)
        if (totalsAtBottom && showParent) result.push(nodeId)
    }
    for (const r of placeTotals(roots, nodes, totalsAtBottom)) visit(r)
    return result
}

// Among siblings, put a total that skipped levels (see constrainHierarchy) before or after the
// lower-level members of it that sit beside it — order only; the members stay side by side.
function placeTotals(list, nodes, totalsAtBottom) {
    if (!list.some(id => nodes[id]?.skipKids)) return list
    let out = [...list]
    for (const id of list) {
        const kids = nodes[id]?.skipKids
        if (!kids) continue
        const rest = out.filter(x => x !== id), at = new Map(rest.map((x, i) => [x, i]))
        const idx = kids.map(k => at.get(k)).filter(i => i !== undefined)
        if (!idx.length) continue
        rest.splice(totalsAtBottom ? Math.max(...idx) + 1 : Math.min(...idx), 0, id)
        out = rest
    }
    return out
}

// Every prefix of the tuples that have data ('a', 'a::b', …) — lets the walk
// below skip combinations TM1 returned nothing for.
export function tuplePrefixes(tupleKeys) {
    const set = new Set()
    for (const key of tupleKeys) {
        const parts = key.split('::')
        for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('::'))
    }
    return set
}

// Visible tuples (arrays of ids, outer → inner) in tree order, with each inner
// dimension's drill-down remembered per outer context. present (optional, from
// tuplePrefixes) prunes to combinations that exist — without it every
// combination is listed (large for several big dimensions).
export function computeVisibleTuples(hierarchies, expandedSets, keepMode, totalsAtBottom = false, present = null) {
    if (!hierarchies.length) return []
    function recurse(dimIdx, contextKey) {
        const h = hierarchies[dimIdx]
        if (!h) return [[]]
        const expanded = expandedFor(hierarchies, expandedSets, dimIdx, contextKey)
        let visible = computeVisibleNodes(h.roots, h.nodes, expanded, keepMode, totalsAtBottom)
        if (present) visible = visible.filter(id => present.has(contextKey ? `${contextKey}::${id}` : id))
        if (dimIdx === hierarchies.length - 1) return visible.map(id => [id])
        return visible.flatMap(id => {
            const ctx = contextKey ? `${contextKey}::${id}` : id
            return recurse(dimIdx + 1, ctx).map(child => [id, ...child])
        })
    }
    return recurse(0, '')
}

// Every id below nodeId in the tree.
function descendantsOf(nodes, nodeId) {
    const out = new Set(), stack = [...(nodes[nodeId]?.children ?? [])]
    while (stack.length) { const id = stack.pop(); if (out.has(id)) continue; out.add(id); stack.push(...(nodes[id]?.children ?? [])) }
    return out
}

// Open the given nodes ONE level: each opens, and everything below it closes — so a total that was
// collapsed with open branches underneath comes back one level deep, not with all its old levels.
function openOneLevel(set, nodes, ids) {
    for (const id of ids) { set.add(id); for (const d of descendantsOf(nodes, id)) set.delete(d) }
    return set
}

// Open the given nodes and every level below them ("Expand all levels below").
function openAllBelow(set, nodes, ids) {
    for (const id of ids) { set.add(id); for (const d of descendantsOf(nodes, id)) set.add(d) }
    return set
}

// Change one dimension's open set under a context (returns new expand state). An inner dimension
// keeps a set per outer member, starting from the '*' set or, failing that, everything open.
function changeSet(hierarchies, expandedSets, dimIdx, contextKey, fn) {
    const next = [...expandedSets]
    const nodes = hierarchies[dimIdx]?.nodes ?? {}
    if (dimIdx === 0) next[0] = fn(new Set(next[0]), nodes)
    else {
        const map = new Map(next[dimIdx] instanceof Map ? next[dimIdx] : [])
        map.set(contextKey, fn(new Set(map.get(contextKey) ?? map.get('*') ?? allExpanded(nodes)), nodes))
        next[dimIdx] = map
    }
    return next
}

// Toggle one node open/closed under a context. Opening shows one level.
export function toggleExpanded(hierarchies, expandedSets, dimIdx, nodeId, contextKey) {
    return changeSet(hierarchies, expandedSets, dimIdx, contextKey,
        (s, nodes) => (s.has(nodeId) ? (s.delete(nodeId), s) : openOneLevel(s, nodes, [nodeId])))
}

// Open several nodes one level each, under a context ("Expand this level for all").
export function expandOneLevel(hierarchies, expandedSets, dimIdx, ids, contextKey) {
    return changeSet(hierarchies, expandedSets, dimIdx, contextKey, (s, nodes) => openOneLevel(s, nodes, ids))
}

// Open nodes and everything below them, under a context ("Expand all levels below").
export function expandBelow(hierarchies, expandedSets, dimIdx, ids, contextKey) {
    return changeSet(hierarchies, expandedSets, dimIdx, contextKey, (s, nodes) => openAllBelow(s, nodes, ids))
}

// Open or close a whole dimension everywhere
export function setAllExpanded(hierarchies, expandedSets, dimIdx, open) {
    const next = [...expandedSets]
    if (dimIdx === 0) next[0] = open ? allExpanded(hierarchies[0]?.nodes ?? {}) : new Set()
    else next[dimIdx] = open ? new Map() : new Map([['*', new Set()]])
    return next
}

// Is a tuple all leaves? (members not in their hierarchy count as leaves)
export function tupleIsLeaf(tuple, hierarchies) {
    return tuple.every((id, i) => { const n = hierarchies[i]?.nodes?.[id]; return !n || n.isLeaf || !n.children?.length })
}

// Row-label indent in px: one step per level down the tree
export function indentFor(node, step = 14) {
    return (node?.depth ?? 0) * step
}

// For each tuple, which positions differ from the tuple before (repeated outer labels are hidden)
export function changedFlags(tuples) {
    let prev = null
    return tuples.map(t => { const c = t.map((id, i) => prev === null || prev[i] !== id); prev = t; return c })
}
