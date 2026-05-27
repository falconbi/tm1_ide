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
function memberSet({ dimension: dim, subset, member }) {
    if (member) return `{[${dim}].[${dim}].[${member}]}`
    if (subset) return `TM1SubsetToSet([${dim}], "${subset}")`
    return `{[${dim}].[${dim}].Members}`
}

function axisExpression(placements, suppress) {
    if (!placements.length) return null
    const sets = placements.map(memberSet)
    const joined = sets.length === 1 ? sets[0] : `CrossJoin(${sets.join(', ')})`
    return suppress ? `NON EMPTY ${joined}` : joined
}

export function buildMDX({ cube, rows = [], columns = [], pages = [], suppressZeros = true }) {
    const colExpr = axisExpression(columns, suppressZeros) ?? '{}'
    const rowExpr = axisExpression(rows,    suppressZeros)

    const axes = [`${colExpr} ON COLUMNS`]
    if (rowExpr) axes.push(`${rowExpr} ON ROWS`)

    let mdx = `SELECT ${axes.join(',\n       ')}\nFROM [${cube}]`

    if (pages.length) {
        const slicers = pages.map(({ dimension: dim, member }) =>
            `[${dim}].[${dim}].[${member ?? dim}]`)
        mdx += `\nWHERE (${slicers.join(', ')})`
    }

    return mdx
}
