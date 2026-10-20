/**
 * pivot-tree — the pure logic behind the pivot grid (HierarchyGrid) and the
 * View editor's hierarchies: which rows/columns show for a given drill-down
 * state, and building/pruning element trees. No React, relative imports only,
 * so node tests can run it. Moved here unchanged (Oct 2026) as step 1 of
 * docs/PIVOT_PLAN.md — known bugs are pinned in tests/pivot-tree.test.mjs.
 */

// ── Shared algorithms ─────────────────────────────────────────────────────────

export function allExpanded(nodes) {
    return new Set(Object.keys(nodes).filter(id => !nodes[id].isLeaf && nodes[id].children?.length))
}

export function computeVisibleNodes(roots, nodes, expanded, keepMode, totalsAtBottom = false) {
    const result = []
    function visit(nodeId) {
        const node = nodes[nodeId]
        if (!node) return
        const isOpen      = expanded.has(nodeId)
        const hasChildren = !node.isLeaf && node.children?.length > 0
        const showParent  = keepMode === 'replace' ? !(isOpen && hasChildren) : true
        if (!totalsAtBottom && showParent) result.push(nodeId)
        if (isOpen && hasChildren) for (const c of node.children) visit(c)
        if (totalsAtBottom  && showParent) result.push(nodeId)
    }
    for (const r of roots) visit(r)
    return result
}


/**
 * Recursively compute visible tuples with per-context inner-dim expansion.
 *   expandedSets[0]    = Set           (outer dim, global)
 *   expandedSets[i>0]  = Map<ctx, Set> (inner dims, per outer context)
 *                        missing key → allExpanded(h.nodes) default
 */
export function computeVisibleTuples(hierarchies, expandedSets, keepMode, totalsAtBottom = false) {
    function recurse(dimIdx, contextKey) {
        const h = hierarchies[dimIdx]
        if (!h) return [[]]

        let expanded
        if (dimIdx === 0) {
            expanded = expandedSets[0] ?? new Set()
        } else {
            const map = expandedSets[dimIdx]
            expanded  = (map instanceof Map ? (map.get(contextKey) ?? map.get('*') ?? allExpanded(h.nodes)) : null) ?? allExpanded(h.nodes)
        }

        const visible = computeVisibleNodes(h.roots, h.nodes, expanded, keepMode, totalsAtBottom)
        if (dimIdx === hierarchies.length - 1) return visible.map(id => [id])

        return visible.flatMap(id => {
            const ctx = contextKey ? `${contextKey}::${id}` : id
            return recurse(dimIdx + 1, ctx).map(child => [id, ...child])
        })
    }
    if (!hierarchies.length) return []
    return recurse(0, '')
}

// ── State initializers ────────────────────────────────────────────────────────

export function initExpandedSets(hierarchies) {
    return hierarchies.map((h, i) => i === 0 ? allExpanded(h.nodes ?? {}) : new Map())
}

// ── Cellset → HierarchyGrid transforms ───────────────────────────────────────

export function buildHierarchyFromElements(elements, name) {
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
    const childSet = new Set(elements.flatMap(e => e.Components ?? []))
    const roots    = elements.filter(e => !childSet.has(e.Name)).map(e => e.Name)
    const maxLevel = Math.max(0, ...elements.map(e => e.Level ?? 0))
    return { nodes, roots, maxLevel, name }
}

// Prune hierarchy to only members present in the cellset result.
// Consolidations only appear if they were actually returned by TM1.
// Children list is filtered to only present members; isLeaf recomputed.
export function constrainHierarchy(hierarchy, presentMembers) {
    if (!hierarchy || !presentMembers?.length) return hierarchy
    const presentSet = new Set(presentMembers)
    const { nodes: allNodes, name } = hierarchy

    const nodes = {}
    for (const id of presentMembers) {
        const node = allNodes[id]
        if (!node) continue
        const children = (node.children ?? []).filter(c => presentSet.has(c))
        nodes[id] = { ...node, children, isLeaf: children.length === 0 }
    }

    const childSet = new Set(Object.values(nodes).flatMap(n => n.children))
    const roots    = Object.keys(nodes).filter(id => !childSet.has(id))
    const maxLevel = Math.max(0, ...Object.values(nodes).map(n => n.level ?? 0))
    return { nodes, roots, maxLevel, name }
}



// ── Small rules used inline by HierarchyGrid ─────────────────────────────────

// Row-label indent in px — from TM1's level (counted up from the leaves).
export function rowIndent(level, maxLevel) {
    return Math.max(0, (maxLevel - level)) * 14
}

// Which column id belongs to which first-column-dimension node (single-dim headers).
export function buildColNodeMap(columnHierarchies, colByTupleKey) {
    if (!columnHierarchies.length) return {}
    const h0    = columnHierarchies[0]
    const nodes = h0?.nodes ?? {}
    const map   = {}
    for (const nodeId of Object.keys(nodes)) {
        const col = colByTupleKey[nodeId]
        if (col) map[col.id] = nodeId
    }
    return map
}

// Is this data column a leaf (not a total)? — looks at the first column dimension only.
export function columnIsLeaf(col, colNodeMap, columnHierarchies) {
    const nodeId  = colNodeMap[col.id]
    const colNode = nodeId ? columnHierarchies[0]?.nodes?.[nodeId] : null
    return !colNode || colNode.isLeaf || !colNode.children?.length
}

