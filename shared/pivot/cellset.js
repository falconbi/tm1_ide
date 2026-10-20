/**
 * Shared pivot · cellset — a TM1 cellset (from an MDX query) → pivot data.
 * Each cell keeps its real value AND its display text, whether TM1 lets you
 * type into it, and what kind it is — the shared colour scheme reads that:
 *   kind 'total' (a consolidation) · 'calc' (a rule) · 'input'
 *
 * Result: { columns: [{ id, label, members }], rows: [[member names]],
 *           data: { 'a::b': { [colId]: { v, d, u, kind, fmt?, colour? } } } }
 * Pure; only the format helpers.
 */
import { stripTm1TypePrefix, applyTm1Format } from './format.js'

export const tupleKey = names => names.join('::')

// '[Region].[Region].[North]' → 'Region'
export function dimOf(uniqueName) {
    return uniqueName?.match(/^\[([^\]]+)\]/)?.[1] ?? ''
}
// last bracketed part, with ]] read back as ]
export function elementOf(uniqueName, fallback) {
    const m = uniqueName?.match(/\.\[((?:[^\]]|\]\])*)\]$/)
    return m ? m[1].replace(/\]\]/g, ']') : fallback
}

// a format attribute for one member: formatMap = { dim: { element: '#,##0.00' } }
function formatOf(dim, elem, formatMap) {
    if (!elem) return null
    if (formatMap[dim]?.[elem]) return formatMap[dim][elem]
    for (const d of Object.keys(formatMap)) { const f = formatMap[d]?.[elem]; if (typeof f === 'string' && f) return f }
    return null
}

const isEmpty = v => v == null || v === 0 || (typeof v === 'string' && (v.trim() === '' || Number(v.trim()) === 0))

// options: formatMap, pageMembers (filter members, used for formats too),
// suppressZeros 'none' | 'rows' | 'columns' | 'all' (client-side, on top of NON EMPTY),
// useFormat (default true)
export function cellsetToPivot(cellset, { formatMap = {}, pageMembers = [], suppressZeros = 'none', useFormat = true } = {}) {
    const colAxis = cellset?.Axes?.find(a => a.Ordinal === 0) ?? cellset?.Axes?.[0]
    if (!colAxis) return null
    const rowAxis = cellset.Axes.find(a => a.Ordinal === 1) ?? cellset.Axes[1]
    const colTuples = colAxis.Tuples ?? []
    const rowTuples = rowAxis?.Tuples ?? [{ Members: [] }]
    const cells = new Map((cellset.Cells ?? []).map((c, i) => [c.Ordinal ?? i, c]))
    const nCols = colTuples.length
    const members = t => (t?.Members ?? []).map(m => ({ name: m.Name, dim: dimOf(m.UniqueName), elem: elementOf(m.UniqueName, m.Name) }))

    let columns = colTuples.map((t, i) => {
        const ms = members(t)
        return { id: `c${i}`, label: ms.map(m => m.name).join(' / '), members: ms.map(m => m.name), _ms: ms }
    })
    const supRows = suppressZeros === 'rows' || suppressZeros === 'all'
    const supCols = suppressZeros === 'columns' || suppressZeros === 'all'
    const data = {}, rows = [], colHasData = {}

    rowTuples.forEach((t, ri) => {
        const rms = members(t)
        const key = tupleKey(rms.map(m => m.name))
        const rowCells = columns.map((_, ci) => cells.get(ri * nCols + ci))
        if (supRows && rowCells.every(c => isEmpty(c?.Value))) return
        if (!data[key]) { data[key] = {}; rows.push(rms.map(m => m.name)) }
        columns.forEach((col, ci) => {
            const c = rowCells[ci]
            if (!isEmpty(c?.Value)) colHasData[col.id] = true
            let fmt = null
            for (const m of [...rms, ...col._ms]) { fmt = formatOf(m.dim, m.elem, formatMap); if (fmt) break }
            if (!fmt) for (const p of pageMembers) { fmt = formatOf('', p, formatMap); if (fmt) break }
            const fv = c?.FormattedValue
            // TM1 can send Value null with FormattedValue "0.00" for a zero — read the number back
            const v = c?.Value != null ? c.Value
                : (fv != null && fv !== '' && !Number.isNaN(Number(stripTm1TypePrefix(fv))) ? Number(stripTm1TypePrefix(fv)) : null)
            let d
            if (fmt && v != null && useFormat) d = applyTm1Format(v, fmt)
            else if (useFormat && fv != null && fv !== '') d = stripTm1TypePrefix(fv)
            else d = v == null ? '' : String(v)
            const cell = { v, d, u: c?.Updateable ?? 1, kind: c?.Consolidated ? 'total' : c?.RuleDerived ? 'calc' : 'input' }
            if (fmt) { cell.fmt = fmt; if (fmt.startsWith('@')) { const colour = fmt.slice(1).trim(); if (colour) cell.colour = colour } }
            data[key][col.id] = cell
        })
    })

    if (supCols && rows.length) {
        const empty = new Set(columns.filter(c => !colHasData[c.id]).map(c => c.id))
        if (empty.size) {
            for (const k of Object.keys(data)) for (const id of empty) delete data[k][id]
            columns = columns.filter(c => !empty.has(c.id))
        }
    }
    return { columns: columns.map(({ _ms, ...c }) => c), rows, data }
}

// the distinct members of each position across tuples — for pruning trees to what came back
export function membersByPosition(tuples) {
    const out = []
    for (const t of tuples) t.forEach((m, i) => { (out[i] = out[i] || new Set()).add(m) })
    return out.map(s => [...s])
}
