/**
 * Build a TM1 MDX SELECT statement from an axis configuration.
 *
 * @param {Object} config
 * @param {string} config.cube - Cube name
 * @param {Array}  config.rows - DimensionPlacement[] for rows axis
 * @param {Array}  config.columns - DimensionPlacement[] for columns axis
 * @param {Array}  config.pages - DimensionPlacement[] for slicer/WHERE
 * @param {boolean} [config.suppressZeros=true] - NON EMPTY on axes
 *
 * @typedef {Object} DimensionPlacement
 * @property {string} dimension - Dimension name
 * @property {string} [subset]  - Named subset (uses TM1SubsetToSet)
 * @property {string} [member]  - Single member (for pages axis)
 */
function buildAxisSet({ dimension: dim, subset, member, members, memberSet: mset }) {
    if (mset === 'leaf') return `{TM1FILTERBYLEVEL({[${dim}].[${dim}].Members}, 0)}`
    if (mset === 'root') return `{[${dim}].[${dim}].DefaultMember}`
    if (members?.length > 1) return `{${members.map(m => `[${dim}].[${dim}].[${m}]`).join(', ')}}`
    if (member || members?.length === 1) return `{[${dim}].[${dim}].[${member ?? members[0]}]}`
    if (subset) return `TM1SubsetToSet([${dim}].[${dim}], "${subset}", "public")`
    return `{[${dim}].[${dim}].Members}`
}

function axisExpression(placements, suppress) {
    if (!placements.length) return null
    const sets = placements.map(buildAxisSet)
    const joined = sets.length === 1 ? sets[0] : `CrossJoin(${sets.join(', ')})`
    return suppress ? `NON EMPTY ${joined}` : joined
}

export function buildMDX({ cube, rows = [], columns = [], pages = [], suppressZeros = true }) {
    const colExpr = axisExpression(columns, suppressZeros) ?? '{}'
    const rowExpr = axisExpression(rows,    suppressZeros)

    const axes = [`${colExpr} ON COLUMNS`]
    if (rowExpr) axes.push(`${rowExpr} ON ROWS`)

    let mdx = `SELECT ${axes.join(',\n       ')}\nFROM [${cube}]`

    const validSlicers = pages
        .filter(({ member, members }) => member || members?.length)
        .map(({ dimension: dim, member, members }) =>
            members?.length > 1
                ? `{${members.map(m => `[${dim}].[${dim}].[${m}]`).join(', ')}}`
                : `[${dim}].[${dim}].[${member ?? members?.[0]}]`)
    if (validSlicers.length) {
        mdx += `\nWHERE (${validSlicers.join(', ')})`
    }

    return mdx
}
