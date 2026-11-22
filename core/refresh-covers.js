'use strict'

// ── Refresh DEV from PROD: views and subsets ────────────────────────────────
// The last two object types a deploy ships (TM1 Git's pull plan applies neither, so
// the deploy applies them over REST from the release commit). A refresh has to work
// the same way round: read PROD live, write DEV over REST, and let TM1 Git export
// DEV's file for the change set — no export format built by hand.
//
// Two things make this different from dimensions:
//   * A view or a subset can exist on BOTH sides with different content. That is a
//     conflict, not a gap: "take the target's" and "keep DEV's" are both legitimate,
//     and there is no default — the same rule as a delete or a move. An object only
//     on the target is a gap and is brought across; one only on DEV stays (the
//     deploy carries it).
//   * A native view is a set of axis expressions. Comparing it means comparing those
//     expressions, and copying it means writing them back exactly — a custom filter
//     must not come back as "all members". So the placement reads keep the raw
//     expression, and an axis that cannot be read blocks the copy (never guessed).
//
// Subsets are applied before views: a view may be bound to a named subset.
//
// Alternate hierarchies are NOT covered here (their own step): a subset in a
// hierarchy DEV does not have is reported, not created.

const { makeClient } = require('./adapter-registry')
const { TM1Client } = require('./tm1-client')
const { odataKey } = require('./odata-key')
const cl = require('./change-log')
const { originOf, ORIGIN } = require('./refresh-origins')
const { baseSubset, baseView } = require('./deploy-base')

// One comparable string per definition, so a three-way compare is three strings.
const canonSubset = (x) => !x ? null : x.mode === 'mdx' ? `mdx:${x.expression}` : `static:${(x.members ?? []).join('|')}`
const canonView = (v) => !v ? null : v.mode === 'mdx'
    ? `mdx:${v.expression}`
    : `native:${JSON.stringify([v.rows ?? [], v.columns ?? [], v.titles ?? []])}|${v.suppressEmptyRows}|${v.suppressEmptyColumns}|${v.formatString ?? ''}`

// TM1 reflows MDX (line breaks, spacing) without changing meaning; comparing raw
// text would report a difference that isn't one.
function normMdx(text) {
    return String(text ?? '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
}

// ── Reading one object from a server ────────────────────────────────────────

// A subset is an MDX expression or an ordered element list. `memberSet: 'all'`
// (TM1SubsetAll) is an expression and is carried as text, not as 500 element rows.
async function readSubset(tm1, dim, name, hierarchy = dim) {
    const sub = await tm1.getSubset(dim, name, hierarchy).catch(() => null)
    if (!sub?.Name) return null
    const expr = String(sub.Expression ?? '').trim()
    if (expr) return { mode: 'mdx', expression: normMdx(expr), text: expr }
    const els = await tm1.getSubsetElements(dim, name, hierarchy).catch(() => [])
    return { mode: 'static', members: els.map(e => e?.name).filter(Boolean) }
}

// A view is an MDX expression or a set of axis placements. Placements keep their raw
// expression so a custom filter (TM1FILTERBYPATTERN, a hand-written set) is copied
// verbatim instead of collapsing to "all members".
async function readView(tm1, cube, name) {
    const raw = await tm1.getView(cube, name)
    if (!raw) return null
    if (String(raw['@odata.type'] ?? '').includes('MDXView')) {
        return { mode: 'mdx', expression: normMdx(raw.MDX ?? ''), text: raw.MDX ?? '' }
    }
    const axis = async (which) => {
        const r = await tm1.get(`Cubes('${odataKey(cube)}')/Views('${odataKey(name)}')/${which}?%24expand=Subset`).catch(() => ({ value: [] }))
        return Promise.all((r?.value ?? []).map(async (p) => {
            const expr = p?.Subset?.Expression ?? null
            const subset = p?.Subset?.Name || null
            let dimension = p?.DimensionName ?? p?.Name ?? null
            if (!dimension && expr) dimension = String(expr).match(/\[([^\]]+)\]/)?.[1] ?? null
            const members = (!subset && expr) ? (tm1._extractMembersFromExpression?.(expr) ?? []) : []
            return { dimension, subset, expression: subset ? null : (expr ? normMdx(expr) : null), members }
        }))
    }
    const [rows, columns, titles] = await Promise.all([axis('Rows'), axis('Columns'), axis('Titles')])
    // A named subset never reports its own dimension; resolve it from the cube so the
    // copy can bind it. Unknown → left null, and the copy refuses rather than guesses.
    const unresolved = [...rows, ...columns, ...titles].filter(a => !a.dimension && a.subset)
    if (unresolved.length) {
        const dims = ((await tm1.getCube(cube).catch(() => null))?.Dimensions ?? []).map(d => d?.Name ?? d)
        const cache = new Map()
        for (const a of unresolved) {
            if (!cache.has(a.subset)) {
                let found = null
                for (const d of dims) if (await tm1.getSubset(d, a.subset).catch(() => null)) { found = d; break }
                cache.set(a.subset, found)
            }
            a.dimension = cache.get(a.subset)
        }
    }
    return {
        mode: 'native',
        rows, columns, titles,
        suppressEmptyRows: !!raw.SuppressEmptyRows,
        suppressEmptyColumns: !!raw.SuppressEmptyColumns,
        formatString: raw.FormatString ?? null,
    }
}

// ── Comparing ───────────────────────────────────────────────────────────────

const axisKey = (a) => [a.dimension ?? '', a.subset ?? '', a.expression ?? '', (a.members ?? []).join(',')].join('|')
const sameAxis = (a = [], b = []) => a.length === b.length && a.every((x, i) => axisKey(x) === axisKey(b[i]))

// Pure: what differs between the target's subset and DEV's. `parts` names the
// difference in words the plan can show; empty means identical.
function diffSubsetSpec(prod, dev) {
    if (!prod && !dev) return { differs: false, parts: [] }
    if (!prod) return { differs: false, parts: [], onTarget: false }
    if (!dev) return { differs: true, parts: ['missing on DEV'], adding: true }
    if (prod.mode !== dev.mode) return { differs: true, parts: [`${dev.mode} on DEV, ${prod.mode} on PROD`] }
    if (prod.mode === 'mdx') {
        return prod.expression === dev.expression
            ? { differs: false, parts: [] }
            : { differs: true, parts: ['expression'] }
    }
    return sameAxis(prod.members ?? [], dev.members ?? [])
        ? { differs: false, parts: [] }
        : { differs: true, parts: [`members (${(dev.members ?? []).length} → ${(prod.members ?? []).length})`] }
}

function diffViewSpec(prod, dev) {
    if (!prod && !dev) return { differs: false, parts: [] }
    if (!prod) return { differs: false, parts: [], onTarget: false }
    if (!dev) return { differs: true, parts: ['missing on DEV'], adding: true }
    if (prod.mode !== dev.mode) return { differs: true, parts: [`${dev.mode} on DEV, ${prod.mode} on PROD`] }
    const parts = []
    if (prod.mode === 'mdx') {
        if (prod.expression !== dev.expression) parts.push('expression')
        return { differs: parts.length > 0, parts }
    }
    if (!sameAxis(prod.rows, dev.rows)) parts.push('rows')
    if (!sameAxis(prod.columns, dev.columns)) parts.push('columns')
    if (!sameAxis(prod.titles, dev.titles)) parts.push('titles')
    if (prod.suppressEmptyRows !== dev.suppressEmptyRows) parts.push('suppress empty rows')
    if (prod.suppressEmptyColumns !== dev.suppressEmptyColumns) parts.push('suppress empty columns')
    if (String(prod.formatString ?? '') !== String(dev.formatString ?? '')) parts.push('format')
    return { differs: parts.length > 0, parts }
}

// An axis we could not read: no subset and no expression. Copying it would write
// "all members" where the target has something else. A TITLE needs one more check:
// a title bound to a named subset has no expression, and the API omits its Selected
// member — writing the dimension's default would CHANGE the target's selection
// rather than copy it, so that is refused too rather than guessed.
function unreadableAxes(view) {
    const bad = []
    for (const [which, axes] of [['rows', view.rows], ['columns', view.columns], ['titles', view.titles]]) {
        for (const a of axes ?? []) {
            if (!a.subset && !a.expression) bad.push(`${which} (${a.dimension ?? 'unknown dimension'})`)
            else if (which === 'titles' && a.subset && !(a.members ?? []).length) bad.push(`title selection (named subset ${a.subset})`)
        }
    }
    return bad
}

// A named subset a view is bound to, so a taken view can be reported when one of its
// subsets was kept (the view lands with DEV's subset, which is the choice made — said
// out loud rather than left to be discovered).
function subsetsUsedBy(view) {
    const names = new Set()
    for (const a of [...(view?.rows ?? []), ...(view?.columns ?? []), ...(view?.titles ?? [])]) {
        if (a?.subset) names.add(a.subset)
    }
    return [...names]
}

// ── Planning ────────────────────────────────────────────────────────────────

// Names of the files a baseline holds under a prefix — so an object that exists
// only in the baseline is seen (PROD may have deleted it since).
function namesInBase(reader, prefix) {
    try {
        return (reader.list ? reader.list(prefix) : [])
            .filter(f => f.endsWith('.json'))
            .map(f => f.slice(prefix.length).replace(/\.json$/i, ''))
    } catch { return [] }
}
const subsetNamesInBase = (reader, dim, hier) => namesInBase(reader, `dimensions/${dim}.hierarchies/${hier}.subsets/`)
const viewNamesInBase = (reader, cube) => namesInBase(reader, `cubes/${cube}.views/`)

async function planCovers(source, target, { ideToken, reader = null } = {}) {
    const dev = new TM1Client(source, makeClient(source, ideToken))
    const prod = new TM1Client(target, makeClient(target, ideToken))
    const subsets = []
    const views = []
    const skipped = []

    // Subsets: every hierarchy BOTH servers have. A hierarchy only PROD has belongs
    // to the alternate-hierarchy step — named here, never created.
    for (const dim of (await prod.getModelDimensions().catch(() => [])).map(d => d?.Name ?? d).filter(Boolean)) {
        const prodHiers = ((await prod.get(`Dimensions('${odataKey(dim)}')/Hierarchies`, { $select: 'Name' }).catch(() => null))?.value ?? []).map(h => h?.Name).filter(Boolean)
        const devHiers = new Set(((await dev.get(`Dimensions('${odataKey(dim)}')/Hierarchies`, { $select: 'Name' }).catch(() => null))?.value ?? []).map(h => h?.Name).filter(Boolean))
        for (const hier of prodHiers) {
            const prodNames = ((await prod.get(`Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(hier)}')/Subsets`, { $select: 'Name,Expression' }).catch(() => null))?.value ?? [])
                .filter(s => s?.Name && !String(s.Name).startsWith('}')).map(s => s.Name)
            if (!prodNames.length) continue
            if (!devHiers.has(hier)) {
                skipped.push({ what: `subsets in ${dim}/${hier}`, why: `hierarchy ${hier} is not on ${source} — the alternate-hierarchy step brings it` })
                continue
            }
            const devNames = new Set(((await dev.get(`Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(hier)}')/Subsets`, { $select: 'Name' }).catch(() => null))?.value ?? []).map(s => s?.Name).filter(Boolean))
            const baseNames = reader ? subsetNamesInBase(reader, dim, hier) : null
            const all = new Set([...prodNames, ...devNames, ...(baseNames ?? [])])
            for (const name of all) {
                const [p, d] = await Promise.all([
                    prodNames.includes(name) ? readSubset(prod, dim, name, hier) : Promise.resolve(null),
                    devNames.has(name) ? readSubset(dev, dim, name, hier) : Promise.resolve(null),
                ])
                const b = baseNames === null ? undefined : (baseNames.includes(name) ? canonSubset(baseSubset(reader, dim, hier, name)) : null)
                if (!p && !d) continue
                const origin = b === undefined
                    ? ORIGIN.UNKNOWN
                    : originOf(b, canonSubset(p), canonSubset(d), { value: { base: b, prod: canonSubset(p), dev: canonSubset(d) } })
                if (origin === ORIGIN.UNCHANGED || origin === ORIGIN.BOTH || origin === ORIGIN.DEV_ADDED || origin === ORIGIN.DEV_CHANGED || origin === ORIGIN.DEV_REMOVED) continue
                const deleting = origin === ORIGIN.TARGET_REMOVED
                subsets.push({
                    type: 'subset', name, dimension: dim, hierarchy: hier, origin,
                    onTarget: !!p, onDev: !!d,
                    mode: (p ?? d)?.mode ?? null,
                    n: (p ?? d)?.mode === 'static' ? ((p ?? d)?.members ?? []).length : null,
                    adding: origin === ORIGIN.TARGET_ADDED,
                    removing: deleting,
                    differs: true,
                    parts: [origin === ORIGIN.TARGET_ADDED ? 'new on the target since the last deploy'
                        : deleting ? 'removed on the target since the last deploy'
                        : origin === ORIGIN.CONFLICT ? 'changed on both sides' : 'changed on the target since the last deploy'],
                    choice: origin === ORIGIN.TARGET_ADDED || origin === ORIGIN.TARGET_CHANGED ? 'take' : null,
                })
            }
        }
    }

    // Views: model cubes both servers have (a cube only PROD has is a dimension-level
    // gap — it cannot be refreshed without creating the cube, which no refresh does).
    const devCubes = new Set((await dev.getModelCubes().catch(() => [])).map(c => c?.Name ?? c).filter(Boolean))
    for (const cube of (await prod.getModelCubes().catch(() => [])).map(c => c?.Name ?? c).filter(Boolean)) {
        if (!devCubes.has(cube)) {
            skipped.push({ what: `views in ${cube}`, why: `cube ${cube} is not on ${source} — a refresh does not create cubes` })
            continue
        }
        const [pv, dv] = await Promise.all([prod.getViews(cube).catch(() => []), dev.getViews(cube).catch(() => [])])
        const prodNames = (pv ?? []).map(v => v.name)
        const devNames = new Set((dv ?? []).map(v => v.name))
        const baseNames = reader ? viewNamesInBase(reader, cube) : null
        const all = new Set([...prodNames, ...devNames, ...(baseNames ?? [])])
        for (const name of all) {
            const [p, d] = await Promise.all([
                prodNames.includes(name) ? readView(prod, cube, name) : Promise.resolve(null),
                devNames.has(name) ? readView(dev, cube, name) : Promise.resolve(null),
            ])
            const b = baseNames === null ? undefined : (baseNames.includes(name) ? canonView(baseView(reader, cube, name)) : null)
            if (!p && !d) continue
            const origin = b === undefined
                ? ORIGIN.UNKNOWN
                : originOf(b, canonView(p), canonView(d), { value: { base: b, prod: canonView(p), dev: canonView(d) } })
            if (origin === ORIGIN.UNCHANGED || origin === ORIGIN.BOTH || origin === ORIGIN.DEV_ADDED || origin === ORIGIN.DEV_CHANGED || origin === ORIGIN.DEV_REMOVED) continue
            const deleting = origin === ORIGIN.TARGET_REMOVED
            views.push({
                type: 'view', name, cube, origin,
                onTarget: !!p, onDev: !!d,
                mode: (p ?? d)?.mode ?? null,
                usesSubsets: subsetsUsedBy(p ?? d),
                unreadable: (p ?? d)?.mode === 'native' ? unreadableAxes(p ?? d) : [],
                adding: origin === ORIGIN.TARGET_ADDED,
                removing: deleting,
                differs: true,
                parts: [origin === ORIGIN.TARGET_ADDED ? 'new on the target since the last deploy'
                    : deleting ? 'removed on the target since the last deploy'
                    : origin === ORIGIN.CONFLICT ? 'changed on both sides' : 'changed on the target since the last deploy'],
                choice: origin === ORIGIN.TARGET_ADDED || origin === ORIGIN.TARGET_CHANGED ? 'take' : null,
            })
        }
    }

    return { source, target, subsets, views, skipped }
}

// ── Applying ────────────────────────────────────────────────────────────────

async function writeSubset(tm1, item, spec) {
    if (spec.mode === 'mdx') return tm1.saveSubset(item.dimension, item.name, spec.text, item.hierarchy ?? item.dimension)
    return tm1.saveStaticSubset(item.dimension, item.name, spec.members ?? [], item.hierarchy ?? item.dimension)
}

async function writeView(tm1, item, spec) {
    if (spec.mode === 'mdx') return tm1.saveView(item.cube, item.name, spec.text)
    const axis = (a) => ({
        dimension: a.dimension,
        ...(a.subset ? { subset: a.subset } : { customExpr: a.expression }),
    })
    return tm1.saveNativeView(item.cube, item.name, {
        rows: (spec.rows ?? []).map(axis),
        columns: (spec.columns ?? []).map(axis),
        // A title must carry its selected member: the placement's expression IS that
        // selection, so it is copied rather than replaced by the default member.
        titles: (spec.titles ?? []).map(a => ({ ...axis(a), member: a.members?.[0] })),
        suppressEmptyRows: spec.suppressEmptyRows,
        suppressEmptyColumns: spec.suppressEmptyColumns,
        formatString: spec.formatString ?? undefined,
    })
}

// Apply the chosen views/subsets to DEV. `covers` is [{ type, name, dimension|cube,
// hierarchy, choice }]; only choice 'take' writes — 'keep' records the decision and
// leaves DEV alone (the deploy then carries DEV's version to the target).
//
// Called by applyRefresh AFTER its undecided guard, so every conflict here has a
// choice. Anything that fails is an ERROR with TM1's message — never a "skip".
async function applyCovers(dev, prod, { covers = [], source, target, user, log = cl.writeLog, plan = null } = {}) {
    const changed = []
    const errors = []
    const decisions = []

    // What the real baseline says, for validation: a choice that is not in this
    // plan came from a stale screen and must not be applied.
    const known = new Map([...(plan?.subsets ?? []), ...(plan?.views ?? [])]
        .map(x => [`${x.type}:${x.name}:${x.dimension ?? x.cube}`, x]))

    const wanted = [...covers].sort((a, b) => (a.type === 'subset' ? 0 : 1) - (b.type === 'subset' ? 0 : 1))
    for (const c of wanted) {
        const label = c.type === 'subset' ? `subset ${c.name} (${c.dimension})` : `view ${c.name} (${c.cube})`
        const key = `${c.type}:${c.name}:${c.dimension ?? c.cube}`
        if (plan && !known.has(key)) {
            errors.push({ what: label, why: 'not in the plan against the current baseline — rebuild the plan' })
            continue
        }
        const item = known.get(key)
        if (item?.removing) {
            // PROD removed it since the last deploy: "delete on DEV too?" or keep.
            if (c.choice === 'delete') {
                try {
                    if (c.type === 'subset') await dev.deleteSubset(c.dimension, c.name, c.hierarchy ?? c.dimension)
                    else await dev.deleteView(c.cube, c.name)
                    changed.push({ label, text: 'deleted on DEV too (the target removed it since the last deploy)' })
                    try { log({ server: source, action: c.type === 'subset' ? 'SUBSET_DELETED' : 'VIEW_DELETED', objectType: c.type, objectName: c.name, detail: c.dimension ?? c.cube, user }) } catch { /* evidence only */ }
                } catch (e) { errors.push({ what: label, why: e.message }) }
            } else if (c.choice === 'keep') {
                const text = `kept ${source}'s ${c.type} — the next deploy puts it back on the target`
                decisions.push({ label, choice: 'keep', text })
                try { log({ server: source, action: 'REFRESH_DECISION', objectType: 'decision', objectName: label, detail: text, user, afterState: { kind: c.type, choice: 'keep', parent: c.dimension ?? c.cube } }) } catch { /* evidence only */ }
            } else {
                errors.push({ what: label, why: 'no choice made — the target removed it: delete it on DEV too, or keep it' })
            }
            continue
        }
        if (!['take', 'keep'].includes(c.choice)) {
            errors.push({ what: label, why: 'no choice made — say whether DEV takes the target\'s version or keeps its own' })
            continue
        }
        if (c.choice === 'keep') {
            const text = keepNote(c, source)
            decisions.push({ label, choice: 'keep', text })
            try {
                // A decision is not an object change: object_type 'decision' keeps it
                // out of every object the release counts.
                log({
                    server: source, action: 'REFRESH_DECISION', objectType: 'decision', objectName: label,
                    detail: text, user, afterState: { kind: c.type, choice: 'keep', parent: c.dimension ?? c.cube },
                })
            } catch { /* the decision stands; the log is evidence */ }
            continue
        }
        try {
            if (c.type === 'subset') {
                const spec = await readSubset(prod, c.dimension, c.name, c.hierarchy ?? c.dimension)
                if (!spec) throw new Error('not on the target any more')
                await writeSubset(dev, { ...c, hierarchy: c.hierarchy ?? c.dimension }, spec)
                changed.push({ label, text: `took the target's ${spec.mode === 'mdx' ? 'expression' : `${(spec.members ?? []).length} members`}` })
            } else {
                const spec = await readView(prod, c.cube, c.name)
                if (!spec) throw new Error('not on the target any more')
                const bad = spec.mode === 'native' ? unreadableAxes(spec) : []
                if (bad.length) {
                    // Writing "all members" over a filter would be worse than failing.
                    throw new Error(`could not read ${bad.join(', ')} on the target — nothing written: a copy would guess, and guessing changes the target's own filters`)
                }
                await writeView(dev, c, spec)
                changed.push({ label, text: `took the target's ${spec.mode === 'mdx' ? 'MDX' : 'axes'}` })
            }
            try {
                log({
                    server: source,
                    action: c.type === 'subset' ? 'SUBSET_SAVED' : 'VIEW_SAVED',
                    objectType: c.type, objectName: c.name, detail: c.dimension ?? c.cube,
                    afterState: { refreshedFrom: target ?? null }, user,
                })
            } catch { /* the write stands; the log is evidence */ }
        } catch (e) {
            errors.push({ what: label, why: e.message })
        }
    }
    return { changed, errors, decisions }
}

// The decision text for a "keep": what it means for the next deploy.
const keepNote = (c, source) => `kept ${source}'s ${c.type} — the next deploy carries it to the target`

module.exports = {
    planCovers, applyCovers,
    readSubset, readView, writeSubset, writeView,
    diffSubsetSpec, diffViewSpec, unreadableAxes, subsetsUsedBy, normMdx,
}
