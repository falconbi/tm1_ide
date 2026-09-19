'use strict'

const fs   = require('fs')
const path = require('path')
const { makeClient } = require('./client')
const bp = require('./baseline-paths')
const { baselinePathFor, LEGACY_BASELINE_PATH } = bp

// Back-compat export — the legacy single-file location. Prefer baselinePathFor(server).
const BASELINE_PATH = LEGACY_BASELINE_PATH

function _readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

// History of a server's baselines, oldest → newest, with HEAD marked.
function listBaselines(server) {
    const head     = bp.readHead(server)
    const headName = head ? path.basename(head) : null
    return bp.listBaselineFiles(server).map(f => {
        const meta = _readJson(path.join(bp.baselineDirFor(server), f))?._meta ?? {}
        return {
            file:          f,
            seeded_at:     meta.seeded_at     ?? null,
            seeded_by:     meta.seeded_by     ?? null,
            counts:        meta.counts        ?? null,
            last_entry_id: meta.last_entry_id ?? null,
            label:         meta.label         ?? null,
            is_head:       f === headName,
        }
    })
}

// Move HEAD to an existing historical baseline — reference-only, no re-fetch.
function setBaselineHead(server, file) {
    const full = path.join(bp.baselineDirFor(server), file)
    if (!fs.existsSync(full)) throw new Error(`No baseline "${file}" for server "${server}"`)
    bp.writeHead(server, full)
    return { server, head: file, _meta: _readJson(full)?._meta ?? {} }
}

/**
 * @param {string|null} overridePath  explicit file (package-bundled baseline, CLI --baseline) — wins
 * @param {string|null} server        resolve `.tm1baseline/<server>.json`, falling back to the
 *                                     legacy single file only when it was seeded from this server
 */
function loadBaseline(overridePath, server) {
    if (overridePath) return fs.existsSync(overridePath) ? _readJson(overridePath) : null
    if (server) {
        // append-only HEAD → legacy single file → legacy snapshot.json (same server)
        const current = bp.currentBaselinePath(server)
        if (current) return _readJson(current)
        const legacy = fs.existsSync(LEGACY_BASELINE_PATH) ? _readJson(LEGACY_BASELINE_PATH) : null
        return legacy && legacy._meta?.server === server ? legacy : null
    }
    return fs.existsSync(LEGACY_BASELINE_PATH) ? _readJson(LEGACY_BASELINE_PATH) : null
}

// For subset/view/attribute, `detail` is the parent dimension/cube — part of the
// object's identity. For dimension/cube/process/rules, `detail` is a free-text
// change note ("2 elements, 0 edges", "element Group") — NOT identity; keying on
// it splits one object into several rows (create + delete + element-add all
// survive), which then package as duplicates and phantom "missing"/"drift" rows.
const DETAIL_IS_IDENTITY = new Set(['subset', 'view', 'attribute'])

// Deduplicate session entries — keep the latest entry per real object identity
function uniqueObjects(entries) {
    const map = new Map()
    for (const e of entries) {
        const key = DETAIL_IS_IDENTITY.has(e.object_type)
            ? `${e.object_type}::${e.object_name}::${e.detail ?? ''}`
            : `${e.object_type}::${e.object_name}`
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

    // after_state shape differs by writer: the IDE logs { text }, the MCP { rules }
    const loggedRaw = entry.after_state?.text ?? entry.after_state?.rules
    if (loggedRaw != null) {
        const logged = norm(loggedRaw)
        if (current !== logged) return outcome('DRIFT', entry, 'server rules differ from last IDE save', { logged, current })
    }

    // An object in the change set ships even if it currently matches the baseline
    // (the baseline may have been seeded AFTER the change, or the target has
    // drifted). Deploying identical rules is a safe no-op; silently dropping them
    // is not — WFP Phase 4 lost its rule changes exactly this way.
    if (norm(baseVal) === current) return outcome('MATCH', entry, 'identical to baseline — shipping anyway (in change set)', { baseline: baseVal, current })

    return outcome('MATCH', entry, 'changed from baseline', { baseline: baseVal, current })
}

async function diffProcess(entry, baseline, client) {
    const proc = await client.getProcess(entry.object_name).catch(() => null)

    if (entry.last_action === 'PROCESS_DELETED') {
        return proc
            ? outcome('DRIFT',   entry, 'process still exists after delete')
            : outcome('DELETED', entry, 'deleted from source — not packaged')
    }

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
            ? outcome('DRIFT',   entry, 'subset still exists after delete')
            : outcome('DELETED', entry, 'deleted from source — not packaged')
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
            ? outcome('DRIFT',   entry, 'view still exists after delete')
            : outcome('DELETED', entry, 'deleted from source — not packaged')
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
                return outcome('MATCH', entry, 'identical to baseline — shipping anyway (in change set)')
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
            ? outcome('DRIFT',   entry, 'dimension still exists after delete')
            : outcome('DELETED', entry, 'deleted from source — not packaged')
    }

    const baseDim = baseline?.dimensions?.[entry.object_name]
    if (!baseDim) return outcome('NEW', entry, 'not in baseline — new dimension')

    // Structural signature (same shape as scopedSnapshot): element Name:Type and
    // edge Parent>Child=Weight. Comparing names or counts alone misses re-parents,
    // weight changes, and type flips — the signature catches all of them.
    const [elements, edges] = await Promise.all([
        client.getElementsWithTree(entry.object_name, entry.object_name).catch(() => null),
        client.getEdges(entry.object_name, entry.object_name).catch(() => null),
    ])
    if (!elements) return outcome('MISSING', entry, 'dimension not found on server')

    const hier       = baseDim.hierarchies?.[entry.object_name] ?? {}
    const elemToken  = e => `${e?.Name ?? e?.name ?? ''}:${e?.Type ?? e?.type ?? '?'}`
    const edgeToken  = e => `${e?.ParentName ?? ''}>${e?.ComponentName ?? ''}=${e?.Weight ?? e?.weight ?? 1}`

    const baseElems   = (hier.elements ?? []).map(elemToken).filter(Boolean)
    const baseEdges   = (hier.edges ?? []).map(edgeToken).filter(Boolean)
    const currElems   = elements.map(elemToken).filter(Boolean)
    const currEdges   = (edges ?? []).map(edgeToken).filter(Boolean)
    const baseElemSet = new Set(baseElems)
    const currElemSet = new Set(currElems)
    const baseEdgeSet = new Set(baseEdges)
    const currEdgeSet = new Set(currEdges)

    const addedElems   = currElems.filter(t => !baseElemSet.has(t))
    const removedElems = baseElems.filter(t => !currElemSet.has(t))
    const addedEdges   = currEdges.filter(t => !baseEdgeSet.has(t))
    const removedEdges = baseEdges.filter(t => !currEdgeSet.has(t))

    if (!addedElems.length && !removedElems.length && !addedEdges.length && !removedEdges.length) {
        return outcome('MATCH', entry, 'structure identical to baseline')
    }

    const addedNames   = addedElems.map(t => t.split(':')[0])
    const removedNames = removedElems.map(t => t.split(':')[0])
    const nameList     = names => `(${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''})`

    const parts = []
    if (addedNames.length)   parts.push(`+${addedNames.length} element${addedNames.length !== 1 ? 's' : ''} ${nameList(addedNames)}`)
    if (removedNames.length) parts.push(`-${removedNames.length} element${removedNames.length !== 1 ? 's' : ''} ${nameList(removedNames)}`)
    if (addedEdges.length)   parts.push(`${addedEdges.length} edge${addedEdges.length !== 1 ? 's' : ''} added/re-parented`)
    if (removedEdges.length) parts.push(`${removedEdges.length} edge${removedEdges.length !== 1 ? 's' : ''} removed`)
    const note = parts.join(', ')

    return outcome('DRIFT', entry, `structure differs from baseline: ${note}`, {
        elementDelta: { added: addedNames, removed: removedNames },
        edgeDelta:    { added: addedEdges, removed: removedEdges },
    })
}

async function diffAttribute(entry, baseline, client) {
    const dim   = entry.detail
    const attrs = await client.getElementAttributes(dim).catch(() => null)

    if (entry.last_action === 'ATTRIBUTE_DELETED') {
        const gone = !attrs || !attrs.some(a => a.Name === entry.object_name)
        return gone
            ? outcome('DELETED', entry, `attribute removed from ${dim} — not packaged`)
            : outcome('DRIFT',   entry, `attribute still exists after delete on ${dim}`)
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
            ? outcome('DRIFT',   entry, 'cube still exists after delete')
            : outcome('DELETED', entry, 'deleted from source — not packaged')
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
    const baseline = loadBaseline(baselinePath, server)

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
        baseline_server:        baseline?._meta?.server        ?? null,
        baseline_seeded_at:     baseline?._meta?.seeded_at     ?? null,
        baseline_last_entry_id: baseline?._meta?.last_entry_id ?? null,
        has_baseline:           !!baseline,
        checked_at:         new Date().toISOString(),
        total:              results.length,
        match:              byOutcome('MATCH'),
        new:                byOutcome('NEW'),
        unchanged:          byOutcome('UNCHANGED'),
        drift:              byOutcome('DRIFT'),
        missing:            byOutcome('MISSING'),
        deleted:            byOutcome('DELETED'),
        error:              byOutcome('ERROR'),
        results,
    }
}

// ── Drift check — has the TARGET changed since the baseline was seeded? ────────
// Compares each packaged object's current state on the target against the baseline.
// Objects not in baseline (outcome=NEW) are skipped — can't drift without a record.

async function checkObjectDrift(obj, baseline, client) {
    switch (obj.type) {
        case 'rules': {
            const b = baseline.cubes?.[obj.name]
            if (!b) return null
            const cube = await client.getCube(obj.name).catch(() => null)
            if (!cube) return null  // doesn't exist on target — not a drift issue
            const targetRules = (cube.Rules ?? '').trim()
            const baseRules   = (b.rules ?? '').trim()
            if (targetRules === baseRules) return { drifted: false }
            return { drifted: true, note: 'Rules changed on target since baseline' }
        }
        case 'process': {
            const b = baseline.processes?.[obj.name]
            if (!b) return null
            const p = await client.getProcess(obj.name).catch(() => null)
            if (!p) return { drifted: true, note: 'Process deleted from target since baseline' }
            const sig = x => [x?.PrologProcedure, x?.MetaDataProcedure ?? x?.MetadataProcedure, x?.DataProcedure, x?.EpilogProcedure].join('\x00')
            if (sig(p) === sig(b)) return { drifted: false }
            return { drifted: true, note: 'Process code changed on target since baseline' }
        }
        case 'dimension': {
            const b = baseline.dimensions?.[obj.name]
            if (!b) return null
            const bEls = b.hierarchies?.[obj.name]?.elements ?? null
            if (!bEls) return null
            const tEls = await client.getElements(obj.name).catch(() => null)
            if (!tEls) return null  // new on target — not drift
            const bNames = new Set(bEls.map(e => (e.name ?? e.Name ?? '').toLowerCase()))
            const tNames = new Set(tEls.map(e => (e.Name ?? '').toLowerCase()))
            const added   = [...tNames].filter(n => !bNames.has(n))
            const removed = [...bNames].filter(n => !tNames.has(n))
            if (!added.length && !removed.length) return { drifted: false }
            const parts = []
            if (added.length)   parts.push(`+${added.length} element(s) added`)
            if (removed.length) parts.push(`-${removed.length} element(s) removed`)
            return { drifted: true, note: parts.join(', ') + ' on target since baseline' }
        }
        case 'subset': {
            const dim = obj.detail
            if (!dim) return null
            const b = baseline.subsets?.[dim]?.[dim]?.[obj.name]
            if (!b) return null
            const sub = await client.getSubset(dim, obj.name).catch(() => null)
            if (!sub) return { drifted: true, note: 'Subset deleted from target since baseline' }
            // getSubset only $selects Name,Expression — for a static subset the
            // members come from getSubsetElements, else tSig is always '' (false drift).
            const tEls = sub.Expression
                ? []
                : await client.getSubsetElements(dim, obj.name)
                    .then(a => a.map(e => e.name ?? e.Name ?? e))
                    .catch(() => [])
            const tSig = sub.Expression ?? tEls.sort().join(',')
            const bSig = b.expression   ?? (b.elements ?? []).sort().join(',')
            if (tSig === bSig) return { drifted: false }
            return { drifted: true, note: 'Subset definition changed on target since baseline' }
        }
        case 'view': {
            const cube = obj.detail
            if (!cube) return null
            const b = baseline.views?.[cube]?.[obj.name]
            if (!b) return null
            const v = await client.getView(cube, obj.name).catch(() => null)
            if (!v) return { drifted: true, note: 'View deleted from target since baseline' }
            // MDX — compare the query text.
            if (b.type === 'mdx' || b.MDX) {
                if (norm(v.MDX ?? '') === norm(b.MDX ?? '')) return { drifted: false }
                return { drifted: true, note: 'View MDX changed on target since baseline' }
            }
            // Native — compare normalized axes (the baseline stores normAxes(vws),
            // NOT the raw getView entity — comparing raw JSON always "drifts").
            const vws = await client.getViewWithSubsets(cube, obj.name).catch(() => null)
            if (vws && b.axes) {
                if (JSON.stringify(normAxes(vws)) === JSON.stringify(b.axes)) return { drifted: false }
                return { drifted: true, note: `View axes changed on target since baseline: ${axesDiffNote(b.axes, normAxes(vws))}` }
            }
            return { drifted: false }  // can't read comparably — don't cry drift
        }
        case 'cube': {
            const b = baseline.cubes?.[obj.name]
            if (!b) return null
            const cube = await client.getCube(obj.name).catch(() => null)
            if (!cube) return null  // new on target
            const tDims = (cube.Dimensions ?? []).map(d => d.Name ?? d).sort().join(',')
            const bDims = (b.dimensions ?? []).sort().join(',')
            if (tDims === bDims) return { drifted: false }
            return { drifted: true, note: 'Cube dimension list changed on target since baseline' }
        }
        case 'attribute': {
            const dim = obj.detail
            if (!dim) return null
            const bDim  = baseline.dimensions?.[dim]
            const bAttr = (bDim?.hierarchies?.[dim]?.attributes ?? [])
                .find(a => a.Name?.toLowerCase() === obj.name.toLowerCase())
            if (!bAttr) return null
            const attrs = await client.getElementAttributes(dim).catch(() => [])
            const tAttr = attrs.find(a => a.Name?.toLowerCase() === obj.name.toLowerCase())
            if (!tAttr) return { drifted: true, note: 'Attribute deleted from target since baseline' }
            if (tAttr.Type !== bAttr.Type) return { drifted: true, note: `Attribute type changed: ${bAttr.Type} → ${tAttr.Type}` }
            return { drifted: false }
        }
        case 'picklist-cube': {
            const b = baseline.picklist_cubes?.[obj.name]
            if (!b) return null
            const pkCubeName = `}Picklist_${obj.name}`
            const pkCube = await client.getCube(pkCubeName).catch(() => null)
            if (!pkCube) return { drifted: true, note: 'Picklist cube deleted from target since baseline' }
            const dims  = (pkCube.Dimensions ?? []).map(d => d.Name ?? d).filter(d => d !== '}Picklist')
            const { fetchPicklistCells } = require('./snapshot')
            const cells = await fetchPicklistCells(client, pkCubeName, dims)
            if (JSON.stringify(cells) === JSON.stringify(b.cells ?? {})) return { drifted: false }
            return { drifted: true, note: 'Picklist cube cells changed on target since baseline' }
        }
        default:
            return null
    }
}

async function driftCheck(packageDir, targetServer, ideToken) {
    const manifestPath = path.join(packageDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) throw new Error('No manifest.json found')

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    // The target's own baseline first (this is "has the target moved since we
    // last synced it"), falling back to the one bundled in the package for the
    // handoff case where the deployer has no baseline of their own.
    const baseline = loadBaseline(null, targetServer)
        ?? loadBaseline(path.join(packageDir, 'baseline.json'))

    if (!baseline) {
        return {
            has_baseline:    false,
            skipped:         true,
            reason:          'No baseline found — drift check skipped',
            target_aligned:  true,   // treat as aligned so deploy can proceed
            drifted:         [],
            clean:           [],
            checked:         0,
        }
    }

    const client  = makeClient(targetServer, ideToken)
    const objects = manifest.objects ?? []

    const drifted = []
    const clean   = []
    const skippedObjs = []

    await Promise.all(objects.map(async obj => {
        try {
            const result = await checkObjectDrift(obj, baseline, client)
            if (result === null) { skippedObjs.push(obj); return }
            if (result.drifted) drifted.push({ type: obj.type, name: obj.name, detail: obj.detail ?? null, note: result.note })
            else                clean.push(obj)
        } catch (e) {
            skippedObjs.push({ ...obj, skipReason: e.message })
        }
    }))

    return {
        has_baseline:    true,
        skipped:         false,
        target_aligned:  drifted.length === 0,
        checked:         clean.length + drifted.length,
        drifted,
        clean,
        skipped_objects: skippedObjs,
        checked_at:      new Date().toISOString(),
    }
}

module.exports = { diff, driftCheck, loadBaseline, listBaselines, setBaselineHead, baselinePathFor, BASELINE_PATH }
