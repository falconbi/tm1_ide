// MDX functions the visual builder cannot represent — triggers MDX-only lock
const COMPLEX_MDX_PATTERNS = [
    ['STRTOMEMBER',    /\bSTRTOMEMBER\b/i],
    ['DRILLDOWNMEMBER',/\bDRILLDOWNMEMBER\b/i],
    ['DRILLUPMEMBER',  /\bDRILLUPMEMBER\b/i],
    ['SUBSET',         /\bSUBSET\s*\(/i],
    ['GENERATE',       /\bGENERATE\s*\(/i],
    ['FILTER',         /\bFILTER\s*\(/i],
    ['ORDER',          /\bORDER\s*\(/i],
    ['TOPCOUNT',       /\bTOPCOUNT\b/i],
    ['BOTTOMCOUNT',    /\bBOTTOMCOUNT\b/i],
    ['.PROPERTIES',    /\.PROPERTIES\s*\(/i],
    ['HIERARCHIZE',    /\bHIERARCHIZE\b/i],
]

export function detectComplexMDX(mdx) {
    if (!mdx) return null
    const found = COMPLEX_MDX_PATTERNS.filter(([, re]) => re.test(mdx)).map(([name]) => name)
    return found.length ? found : null
}

// Convert ViewEditor axis state → GuidedMDXBuilder dimConfig format
export function viewerAxesToBuilderConfig(axes) {
    const toExpr = (dim, d, isFilter) => {
        if (d.memberSet === 'leaf') return `{TM1FILTERBYLEVEL({[${dim}].[${dim}].Members}, 0)}`
        if (d.memberSet === 'root') return `{[${dim}].[${dim}].DefaultMember}`
        if (d.memberSet === 'all')  return `{TM1SUBSETALL([${dim}].[${dim}])}`
        if (d.subset)               return `TM1SubsetToSet([${dim}].[${dim}], "${d.subset}", "public")`
        if (d.members?.length > 1)  return `{${d.members.map(m => `[${dim}].[${dim}].[${m}]`).join(', ')}}`
        if (d.member)               return isFilter ? d.member : `{[${dim}].[${dim}].[${d.member}]}`
        return ''
    }
    const config = {}
    for (const d of axes.rows)    config[d.dimension] = { axis: 'rows',    subsetExpression: toExpr(d.dimension, d, false) }
    for (const d of axes.columns) config[d.dimension] = { axis: 'columns', subsetExpression: toExpr(d.dimension, d, false) }
    for (const d of axes.pages)   config[d.dimension] = { axis: 'filter',  subsetExpression: toExpr(d.dimension, d, true) }
    return config
}
