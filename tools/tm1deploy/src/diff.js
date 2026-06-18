'use strict'

const fs   = require('fs')
const path = require('path')
const { makeClient } = require('./client')

const BASELINE_PATH = path.resolve(__dirname, '../../../.tm1baseline/snapshot.json')

function loadBaseline(overridePath) {
    const p = overridePath ?? BASELINE_PATH
    if (!fs.existsSync(p)) return null
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

// Deduplicate session entries — keep the latest action per (type, name, detail)
function uniqueObjects(entries) {
    const map = new Map()
    for (const e of entries) {
        const key = `${e.object_type}::${e.object_name}::${e.detail ?? ''}`
        const existing = map.get(key)
        if (!existing || e.timestamp > existing.timestamp) map.set(key, e)
    }
    return Array.from(map.values())
}

function norm(s) { return (s ?? '').replace(/\r\n/g, '\n').trim() }

function normAxes(vws) {
    const axis = (placements) => (placements ?? []).map(p => ({
        dim:    p.dimension,
        subset: p.subset    ?? null,
        expr:   p.members   ? [...p.members].sort().join(',') : null,
        all:    p.memberSet ?? null,
    }))
    return {
        rows:   axis(vws._rows),
        cols:   axis(vws._columns),
        titles: (vws._titles ?? []).map(t => ({ dim: t.dimension, member: t.member ?? null })),
    }
}

function axesDiffNote(base, current) {
    const notes = []
    const axisNote = (label, bAxis, cAxis) => {
        const bStr = JSON.stringify(bAxis)
        const cStr = JSON.stringify(cAxis)
        if (bStr === cStr) return
        const bDims = bAxis.map(a => a.dim)
        const cDims = cAxis.map(a => a.dim)
        if (JSON.stringify(bDims) !== JSON.stringify(cDims)) {
            notes.push(`${label} dimensions changed: [${bDims.join(', ')}] → [${cDims.join(', ')}]`)
        } else {
            const changed = cAxis.filter((a, i) => JSON.stringify(a) !== JSON.stringify(bAxis[i])).map(a => a.dim)
            if (changed.length) notes.push(`${label} subset changed: ${changed.join(', ')}`)
        }
    }
    axisNote('Rows',    base.rows,   current.rows)
    axisNote('Columns', base.cols,   current.cols)
    const bTitles = JSON.stringify(base.titles)
    const cTitles = JSON.stringify(current.titles)
    if (bTitles !== cTitles) notes.push('Title selection changed')
    return notes.join('; ') || 'view structure changed'
}

// ── Per-type diff logic ────────────────────────────────────────────────────────

async function diffRules(entry, baseline, client) {
    const cube = await client.getCube(entry.object_name).catch(() => null)
    if (!cube) return outcome('MISSING', entry, 'cube not found on server')

    const current  = norm(cube.Rules)
    const baseVal  = baseline?.cubes?.[entry.object_name]?.rules ?? null
    const inBase   = baseVal !== null

    if (!inBase) return outcome('NEW', entry, 'not in baseline — new cube', { current })

    if (entry.after_state) {
        const logged = norm(entry.after_state.text)
        if (current !== logged) return outcome('DRIFT', entry, 'server rules differ from last IDE save', { logged, current })
    }

    if (norm(baseVal) === current) return outcome('UNCHANGED', entry, 'rules unchanged from baseline — no delta to package', { current })

    return outcome('MATCH', entry, 'changed from baseline', { baseline: baseVal, current })
}

async function diffProcess(entry, baseline, client) {
    const proc = await client.getProcess(entry.object_name).catch(() => null)
    if (!proc) return outcome('MISSING', entry, 'process not found on server')

    const inBase = !!(baseline?.processes?.[entry.object_name])

    if (!inBase) return outcome('NEW', entry, 'not in baseline — new process')

    if (entry.after_state) {
        const currentCode = norm([
            proc.PrologProcedure                             ?? '',
            proc.MetaDataProcedure ?? proc.MetadataProcedure ?? '',
            proc.DataProcedure                               ?? '',
            proc.EpilogProcedure                             ?? '',
        ].join('\n'))
        const loggedCode = norm([
            entry.after_state.prolog   ?? '',
            entry.after_state.metadata ?? '',
            entry.after_state.data     ?? '',
            entry.after_state.epilog   ?? '',
        ].join('\n'))
        if (currentCode !== loggedCode) return outcome('DRIFT', entry, 'server process differs from last IDE save')
    }

    return outcome('MATCH', entry, 'changed from baseline')
}

async function diffSubset(entry, baseline, client) {
    // detail = dimension name
    const dim    = entry.detail
    const subset = await client.getSubset(dim, entry.object_name).catch(() => null)

    if (entry.last_action === 'SUBSET_DELETED') {
        return subset
            ? outcome('DRIFT',  entry, 'subset still exists after delete')
            : outcome('MATCH',  entry, 'deleted')
    }

    if (!subset) return outcome('MISSING', entry, `subset not found in dimension ${dim}`)

    const inBase = !!(baseline?.subsets?.[dim]?.[dim]?.[entry.object_name])
    if (!inBase) return outcome('NEW', entry, `not in baseline — new subset in ${dim}`)

    if (entry.after_state?.expression != null) {
        const logged  = norm(entry.after_state.expression)
        const current = norm(subset.Expression ?? '')
        if (logged !== current) return outcome('DRIFT', entry, 'subset expression differs from last IDE save')
    }

    return outcome('MATCH', entry, `changed from baseline in ${dim}`)
}

async function diffView(entry, baseline, client) {
    const cube = entry.detail
    const view = await client.getView(cube, entry.object_name).catch(() => null)

    if (entry.last_action === 'VIEW_DELETED') {
        return view
            ? outcome('DRIFT', entry, 'view still exists after delete')
            : outcome('MATCH', entry, 'deleted')
    }

    if (!view) return outcome('MISSING', entry, `view not found in cube ${cube}`)

    const inBase    = !!(baseline?.views?.[cube]?.[entry.object_name])
    if (!inBase) return outcome('NEW', entry, `not in baseline — new view in ${cube}`)

    const baseView = baseline.views[cube][entry.object_name]

    // MDX view — compare MDX strings
    if (baseView.type === 'mdx') {
        if (entry.after_state?.type === 'mdx' && entry.after_state?.mdx) {
            const logged  = norm(entry.after_state.mdx)
            const current = norm(view.MDX ?? '')
            if (logged !== current) return outcome('DRIFT', entry, 'view MDX differs from last IDE save')
        }
        return outcome('MATCH', entry, `MDX changed from baseline in ${cube}`)
    }

    // Native view — compare normalized axes
    if (baseView.type === 'native' && baseView.axes) {
        const vws = await client.getViewWithSubsets(cube, entry.object_name).catch(() => null)
        if (vws) {
            const currentAxes = normAxes(vws)
            if (JSON.stringify(baseView.axes) === JSON.stringify(currentAxes)) {
                return outcome('UNCHANGED', entry, 'native view unchanged from baseline — no delta to package')
            }
            const note = axesDiffNote(baseView.axes, currentAxes)
            return outcome('MATCH', entry, `native view changed: ${note}`)
        }
    }

    return outcome('MATCH', entry, `changed from baseline in ${cube}`)
}

async function diffDimension(entry, baseline, client) {
    if (entry.last_action === 'DIMENSION_DELETED') {
        const exists = await client.getDimension(entry.object_name).catch(() => null)
        return exists
            ? outcome('DRIFT',  entry, 'dimension still exists after delete')
            : outcome('MATCH',  entry, 'deleted')
    }

    const elements = await client.getElements(entry.object_name).catch(() => null)
    if (!elements) return outcome('MISSING', entry, 'dimension not found on server')

    const baseDim      = baseline?.dimensions?.[entry.object_name]
    if (!baseDim)      return outcome('NEW', entry, 'not in baseline — new dimension')

    const baseCount    = baseDim.hierarchies?.[entry.object_name]?.elements?.length ?? 0
    const currentCount = elements.length
    const delta        = currentCount - baseCount
    const deltaStr     = delta === 0 ? 'element count unchanged' : `${delta > 0 ? '+' : ''}${delta} elements from baseline`

    return outcome('MATCH', entry, deltaStr)
}

async function diffAttribute(entry, baseline, client) {
    const dim   = entry.detail
    const attrs = await client.getElementAttributes(dim).catch(() => null)

    if (entry.last_action === 'ATTRIBUTE_DELETED') {
        const gone = !attrs || !attrs.some(a => a.Name === entry.object_name)
        return gone
            ? outcome('MATCH', entry, `attribute removed from ${dim}`)
            : outcome('DRIFT', entry, `attribute still exists after delete on ${dim}`)
    }

    if (!attrs) return outcome('MISSING', entry, `could not read attributes for ${dim}`)

    const exists = attrs.some(a => a.Name === entry.object_name)
    if (!exists)  return outcome('MISSING', entry, `attribute not found on ${dim}`)

    const inBase = !!(baseline?.dimensions?.[dim]?.hierarchies?.[dim]?.attributes?.some?.(a => a.Name === entry.object_name))
    if (!inBase)  return outcome('NEW', entry, `not in baseline — new attribute on ${dim}`)

    return outcome('MATCH', entry, `attribute exists on ${dim}`)
}

async function diffCube(entry, baseline, client) {
    if (entry.last_action === 'CUBE_DELETED') {
        const c = await client.getCube(entry.object_name).catch(() => null)
        return c
            ? outcome('DRIFT', entry, 'cube still exists after delete')
            : outcome('MATCH', entry, 'deleted')
    }

    const cube = await client.getCube(entry.object_name).catch(() => null)
    if (!cube) return outcome('MISSING', entry, 'cube not found on server')

    const inBase = !!(baseline?.cubes?.[entry.object_name])
    if (!inBase)  return outcome('NEW', entry, 'not in baseline — new cube')

    return outcome('MATCH', entry, 'cube exists')
}

// ── Result helper ──────────────────────────────────────────────────────────────

function outcome(result, entry, note, extra = {}) {
    return {
        outcome:     result,         // MATCH | NEW | DRIFT | MISSING | UNCHANGED
        object_type: entry.object_type,
        object_name: entry.object_name,
        detail:      entry.detail ?? null,
        last_action: entry.last_action ?? entry.action,
        last_logged: entry.timestamp,
        note,
        ...extra,
    }
}

// ── Main diff ─────────────────────────────────────────────────────────────────

async function diff(server, sessionEntries, baselinePath, ideToken) {
    const client   = makeClient(server, ideToken)
    const baseline = loadBaseline(baselinePath)

    // Annotate each entry with its last_action for deduplication
    const objects = uniqueObjects(sessionEntries.map(e => ({ ...e, last_action: e.action })))

    console.log(`  Comparing ${objects.length} objects against server + baseline…`)

    // Actions that don't represent deployable object changes
    const SKIP_ACTIONS = new Set(['VIEW_SET_DEFAULT', 'ROLLED_BACK'])

    const results = (await Promise.all(objects.map(async entry => {
        if (SKIP_ACTIONS.has(entry.last_action)) return null
        try {
            switch (entry.object_type) {
                case 'rules':     return await diffRules(entry, baseline, client)
                case 'process':   return await diffProcess(entry, baseline, client)
                case 'subset':    return await diffSubset(entry, baseline, client)
                case 'view':      return await diffView(entry, baseline, client)
                case 'dimension': return await diffDimension(entry, baseline, client)
                case 'attribute': return await diffAttribute(entry, baseline, client)
                case 'cube':      return await diffCube(entry, baseline, client)
                default:          return null
            }
        } catch (e) {
            return outcome('ERROR', entry, e.message)
        }
    }))).filter(Boolean)

    const byOutcome = g => results.filter(r => r.outcome === g)

    return {
        server,
        baseline_server:    baseline?._meta?.server     ?? null,
        baseline_seeded_at: baseline?._meta?.seeded_at  ?? null,
        has_baseline:       !!baseline,
        checked_at:         new Date().toISOString(),
        total:              results.length,
        match:              byOutcome('MATCH'),
        new:                byOutcome('NEW'),
        unchanged:          byOutcome('UNCHANGED'),
        drift:              byOutcome('DRIFT'),
        missing:            byOutcome('MISSING'),
        error:              byOutcome('ERROR'),
        results,
    }
}

module.exports = { diff, loadBaseline, BASELINE_PATH }
