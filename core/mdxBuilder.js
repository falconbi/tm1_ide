'use strict'

/**
 * Build a TM1 MDX SELECT statement from an axis configuration.
 *
 * axisConfig: {
 *   cube:    string,
 *   rows:    DimensionPlacement[],
 *   columns: DimensionPlacement[],
 *   pages:   DimensionPlacement[],   // slicer / WHERE clause
 *   suppressZeros: boolean,
 * }
 *
 * DimensionPlacement: {
 *   dimension: string,
 *   subset?:   string,   // null = all members via .Members
 *   member?:   string,   // for pages axis — single member selection
 * }
 */

function memberSet(placement) {
    const { dimension: dim, subset, member } = placement
    if (member) return `{[${dim}].[${dim}].[${member}]}`
    if (subset)  return `{[${dim}].[${dim}].[${subset}]}`  // named subset
    return `{[${dim}].[${dim}].Members}`
}

function axisExpression(placements, suppress) {
    if (!placements.length) return null
    const sets = placements.map(memberSet)
    const joined = sets.length === 1 ? sets[0] : `CrossJoin(${sets.join(', ')})`
    return suppress ? `NON EMPTY ${joined}` : joined
}

function buildMDX({ cube, rows = [], columns = [], pages = [], suppressZeros = true }) {
    if (!columns.length && !rows.length) throw new Error('At least one dimension required on rows or columns')

    const colExpr = axisExpression(columns, suppressZeros) ?? '{}'
    const rowExpr = axisExpression(rows,    suppressZeros)

    const axes = [`${colExpr} ON COLUMNS`]
    if (rowExpr) axes.push(`${rowExpr} ON ROWS`)

    let mdx = `SELECT ${axes.join(',\n       ')}\nFROM [${cube}]`

    if (pages.length) {
        const slicers = pages.map(p => {
            const { dimension: dim, member } = p
            return `[${dim}].[${dim}].[${member ?? dim}]`
        })
        mdx += `\nWHERE (${slicers.join(', ')})`
    }

    return mdx
}

module.exports = { buildMDX }
