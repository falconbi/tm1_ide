'use strict'

// Parse a TM1 cellset + view definition into the IDE's native axis config.
// No HTTP, no client: the route supplies both TM1 responses.
function extractMembersFromExpression(expr) {
    if (!expr) return null
    const trimmed = expr.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
    const matches = [...trimmed.matchAll(/\[[^\]]+\]\.\[[^\]]+\]\.\[([^\]]+)\]/g)]
    return matches.length > 0 ? matches.map(m => m[1]) : null
}

function buildViewAxes(data, viewDef) {
    const parseDim = uniqueName => uniqueName?.match(/^\[([^\]]+)\]/)?.[1] ?? null
    const axisConfig = data.Axes.map(ax => ({
        ordinal: ax.Ordinal,
        dimensions: [...new Set((ax.Tuples?.[0]?.Members ?? []).map(m => parseDim(m.UniqueName)).filter(Boolean))],
        selectedMembers: ax.Ordinal === 2
            ? (ax.Tuples?.[0]?.Members ?? []).map(m => ({ dimension: parseDim(m.UniqueName), member: m.Name }))
            : [],
    }))
    const extractAxis = placement => {
        const expr = (placement.Subset?.Expression ?? '').trim()
        const hasNamedSubset = !!(placement.SubsetName ?? (placement.Subset?.Name || null))
        return {
            dimension: placement.DimensionName ?? placement.Name,
            subset: placement.SubsetName ?? (placement.Subset?.Name || null),
            memberSet: !hasNamedSubset && /^TM1SubsetAll\(/i.test(expr) ? 'all'
                : !hasNamedSubset && /^TM1FILTERBYLEVEL\s*\(/i.test(expr) ? 'leaf'
                : null,
            members: !hasNamedSubset ? extractMembersFromExpression(expr) : null,
        }
    }
    const extractTitle = t => ({ dimension: t.DimensionName ?? t.Name, member: t.Selection?.Name ?? null })
    const rawNative = viewDef ? {
        rows: (viewDef.Rows ?? []).length > 0 ? (viewDef.Rows ?? []).map(extractAxis) : (viewDef._rows ?? []),
        columns: (viewDef.Columns ?? []).length > 0 ? (viewDef.Columns ?? []).map(extractAxis) : (viewDef._columns ?? []),
        titles: (viewDef.Titles ?? []).length > 0 ? (viewDef.Titles ?? []).map(extractTitle) : (viewDef._titles ?? []),
        suppressEmptyRows: !!viewDef.SuppressEmptyRows,
        suppressEmptyColumns: !!viewDef.SuppressEmptyColumns,
    } : null
    let nativeConfig = rawNative
    if (rawNative && axisConfig.length) {
        const dimInfo = {}
        for (const d of [...rawNative.rows, ...rawNative.columns, ...rawNative.titles])
            if (d.dimension) dimInfo[d.dimension] = { subset: d.subset ?? null, memberSet: d.memberSet ?? null, members: d.members ?? null }
        const colAxis = axisConfig.find(a => a.ordinal === 0)
        const rowAxis = axisConfig.find(a => a.ordinal === 1)
        const filterAxis = axisConfig.find(a => a.ordinal === 2)
        nativeConfig = {
            columns: (colAxis?.dimensions ?? []).map(d => ({ dimension: d, subset: dimInfo[d]?.subset ?? null, memberSet: dimInfo[d]?.memberSet ?? null, members: dimInfo[d]?.members ?? null })),
            rows: (rowAxis?.dimensions ?? []).map(d => ({ dimension: d, subset: dimInfo[d]?.subset ?? null, memberSet: dimInfo[d]?.memberSet ?? null, members: dimInfo[d]?.members ?? null })),
            titles: (filterAxis?.selectedMembers ?? rawNative.titles ?? []).map(t => ({
                dimension: t.dimension,
                member: t.member ?? rawNative.titles?.find(n => n.dimension === t.dimension)?.member ?? null,
            })),
            suppressEmptyRows: rawNative.suppressEmptyRows,
            suppressEmptyColumns: rawNative.suppressEmptyColumns,
        }
    }
    const mdx = (viewDef && viewDef['@odata.type']?.includes('MDXView')) ? (viewDef.MDX || null) : null
    return { axisConfig, viewType: data.ViewType, nativeConfig, mdx }
}

module.exports = { buildViewAxes, extractMembersFromExpression }
