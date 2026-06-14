/**
 * Build a TM1 MDX SELECT statement from an axis configuration.
 *
 * @param {Object} config
 * @param {string} config.cube - Cube name
 * @param {Array}  config.rows - DimensionPlacement[] for rows axis
 * @param {Array}  config.columns - DimensionPlacement[] for columns axis
 * @param {Array}  config.pages - DimensionPlacement[] for slicer/WHERE
 * @param {'none'|'rows'|'columns'|'all'} [config.suppressZeros='rows'] - NON EMPTY on axes
 *
 * @typedef {Object} DimensionPlacement
 * @property {string} dimension - Dimension name
 * @property {string} [subset]  - Named subset (uses TM1SubsetToSet)
 * @property {string} [member]  - Single member (for pages axis)
 */
function buildAxisSet({ dimension: dim, subset, member, members, memberSet: mset, customExpr }) {
    if (customExpr) return customExpr
    if (mset === 'leaf') return `{TM1FILTERBYLEVEL({[${dim}].[${dim}].Members}, 0)}`
    if (mset === 'root') return `{[${dim}].[${dim}].DefaultMember}`
    if (mset === 'all')  return `{TM1SUBSETALL([${dim}].[${dim}])}`
    if (members?.length > 1) return `{${members.map(m => `[${dim}].[${dim}].[${m}]`).join(', ')}}`
    if (member || members?.length === 1) return `{[${dim}].[${dim}].[${member ?? members[0]}]}`
    if (subset) return `TM1SubsetToSet([${dim}].[${dim}], "${subset}", "public")`
    return `{[${dim}].[${dim}].Members}`
}

function nestCrossJoin(sets) {
    if (sets.length === 1) return sets[0]
    // TM1 CrossJoin takes exactly 2 args — nest left-to-right for 3+
    return sets.slice(2).reduce(
        (acc, s) => `CrossJoin(${acc}, ${s})`,
        `CrossJoin(${sets[0]}, ${sets[1]})`
    )
}

function axisExpression(placements, mode) {
    if (!placements.length) return null
    const sets = placements.map(buildAxisSet)
    const joined = nestCrossJoin(sets)
    return mode ? `NON EMPTY ${joined}` : joined
}

export function buildMDX({ cube, rows = [], columns = [], pages = [], bench = [], suppressZeros = 'rows' }) {
    const supRows = suppressZeros === 'rows' || suppressZeros === 'all'
    const supCols = suppressZeros === 'columns' || suppressZeros === 'all'
    const colExpr = axisExpression(columns, supCols) ?? '{}'
    const rowExpr = axisExpression(rows,    supRows)

    const axes = [`${colExpr} ON COLUMNS`]
    if (rowExpr) axes.push(`${rowExpr} ON ROWS`)

    let mdx = `SELECT ${axes.join(',\n       ')}\nFROM [${cube}]`

    const pageSlicers = pages
        .filter(({ member, members }) => member || members?.length)
        .map(({ dimension: dim, member, members }) =>
            members?.length > 1
                ? `{${members.map(m => `[${dim}].[${dim}].[${m}]`).join(', ')}}`
                : `[${dim}].[${dim}].[${member ?? members?.[0]}]`)

    // Bench dims always appear in WHERE — with their saved member or DefaultMember
    const benchSlicers = bench.map(({ dimension: dim, member, members }) =>
        (member || members?.length)
            ? (members?.length > 1
                ? `{${members.map(m => `[${dim}].[${dim}].[${m}]`).join(', ')}}`
                : `[${dim}].[${dim}].[${member ?? members?.[0]}]`)
            : `[${dim}].[${dim}].DefaultMember`)

    const allSlicers = [...pageSlicers, ...benchSlicers]
    if (allSlicers.length) {
        mdx += `\nWHERE (${allSlicers.join(', ')})`
    }

    return mdx
}
