/**
 * Shared pivot · mdx — a layout (what is on rows, columns and filters) → TM1 MDX.
 * Pure, no imports. (Was the IDE's core/mdxBuilder.js; now with names escaped.)
 *
 * A placement: { dimension, hierarchy?, member?, members?, memberSet?: 'all'|'leaf'|'root',
 *                subset?, customExpr? }
 */

// [ and ] in names: a ] inside a name is written ]]
const q = s => String(s).replace(/]/g, ']]')
// a hierarchy-qualified member/set prefix: [Dim].[Hier]
const dh = p => `[${q(p.dimension)}].[${q(p.hierarchy || p.dimension)}]`
const mem = (p, m) => `${dh(p)}.[${q(m)}]`
// a string literal for TM1 functions: " inside is written ""
const str = s => '"' + String(s).replace(/"/g, '""') + '"'

export function axisSet(p) {
    if (p.customExpr) return p.customExpr
    if (p.memberSet === 'leaf') return `{TM1FILTERBYLEVEL({${dh(p)}.Members}, 0)}`
    if (p.memberSet === 'root') return `{${dh(p)}.DefaultMember}`
    if (p.memberSet === 'all')  return `{TM1SUBSETALL(${dh(p)})}`
    if (p.members?.length > 1) return `{${p.members.map(m => mem(p, m)).join(', ')}}`
    if (p.member || p.members?.length === 1) return `{${mem(p, p.member ?? p.members[0])}}`
    if (p.subset) return `TM1SubsetToSet(${dh(p)}, ${str(p.subset)}, ${str(p.subsetScope || 'public')})`
    return `{${dh(p)}.Members}`
}

function crossJoin(sets) {
    if (sets.length === 1) return sets[0]
    // TM1's CrossJoin takes two sets — nest left to right for three or more
    return sets.slice(2).reduce((acc, s) => `CrossJoin(${acc}, ${s})`, `CrossJoin(${sets[0]}, ${sets[1]})`)
}

function axis(placements, nonEmpty) {
    if (!placements.length) return null
    const joined = crossJoin(placements.map(axisSet))
    return nonEmpty ? `NON EMPTY ${joined}` : joined
}

// one filter (WHERE) entry; a filter with several members becomes a set
function slicer(p) {
    if (p.members?.length > 1) return `{${p.members.map(m => mem(p, m)).join(', ')}}`
    if (p.member || p.members?.length === 1) return mem(p, p.member ?? p.members[0])
    return `${dh(p)}.DefaultMember`
}

// suppressZeros: 'none' | 'rows' (default) | 'columns' | 'all'.
// pages: filters with a chosen member; bench: dimensions not placed anywhere
// (their chosen member, or the default member).
export function buildMDX({ cube, rows = [], columns = [], pages = [], bench = [], suppressZeros = 'rows' }) {
    const supRows = suppressZeros === 'rows' || suppressZeros === 'all'
    const supCols = suppressZeros === 'columns' || suppressZeros === 'all'
    const parts = [`${axis(columns, supCols) ?? '{}'} ON COLUMNS`]
    const rowExpr = axis(rows, supRows)
    if (rowExpr) parts.push(`${rowExpr} ON ROWS`)
    let mdx = `SELECT ${parts.join(',\n       ')}\nFROM [${q(cube)}]`
    const where = [...pages.filter(p => p.member || p.members?.length), ...bench].map(slicer)
    if (where.length) mdx += `\nWHERE (${where.join(', ')})`
    return mdx
}

// Drill-down beyond a query: widen one placement's set, step by step (the grid's onDrill).
//   steps: [{ scope: 'children' | 'all' | 'leaves' | 'keep' | 'remove', member, members? }]
//   children — the member's children (or each of members'); all — everything below it;
//   leaves — its leaves in place of it; keep — only it; remove — everything but it.
export function widenPlacement(p, steps) {
    if (!steps?.length) return p
    let set = axisSet(p)
    for (const st of steps) {
        const m = mem(p, st.member)
        if (st.scope === 'children') set = `{${set}, ${(st.members?.length ? st.members : [st.member]).map(x => `${mem(p, x)}.Children`).join(', ')}}`
        else if (st.scope === 'all') set = `{${set}, DESCENDANTS(${m})}`
        else if (st.scope === 'leaves') set = `{EXCEPT(${set}, {${m}}), TM1FILTERBYLEVEL(DESCENDANTS(${m}), 0)}`
        else if (st.scope === 'keep') set = `{${m}}`
        else if (st.scope === 'remove') set = `EXCEPT(${set}, {${m}})`
    }
    return { ...p, customExpr: `DISTINCT(${set})` }
}

