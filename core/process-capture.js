'use strict'

// ── Capture what a TI run changes on DEV (Part F.2) ─────────────────────────
// A TI run is not a whole-process save: it changes elements, parents, types and
// attribute values. Part F requires every one of those differences to be recorded
// in the run's change set with the BEFORE and AFTER value, so Build Release can
// carry it exactly and nothing else.
//
// What is captured:
//   * every model dimension the process names in a dimension/attribute write;
//   * elements added/removed/renamed, types changed;
//   * parents added/removed, weights changed;
//   * attribute definitions created/deleted and attribute values changed.
// Cube DATA is not captured and is never deployed — the run entry says so.
//
// A run on a server whose Git label is not DEV changes nothing about the rule (a
// TEST/PROD run needs no change set). An unknown label (not linked) is reported,
// not treated as DEV.

const cl = require('./change-log')
const { fetchProcesses, scanProcess } = require('./process-scan')
const { readDimensionAttributes } = require('./git-attrs')
const { makeClient } = require('./adapter-registry')
const { sanitize } = require('./git-repo')
const { readSubset, readView, canonSubset, canonView } = require('./refresh-covers')

const labelCache = new Map()   // server → { label, at }
const LABEL_TTL = 60_000

async function serverLabel(server, { token, gitUser, ideToken, client = null } = {}) {
    const hit = labelCache.get(server)
    if (hit && Date.now() - hit.at < LABEL_TTL) return hit
    let label
    try {
        const c = client ?? makeClient(server, ideToken)
        const st = await c.post('GitStatus', { Username: gitUser, Password: token })
        label = String(st?.Deployment ?? '').trim().toUpperCase() || null
    } catch { label = null }
    const out = { label, at: Date.now() }
    labelCache.set(server, out)
    return out
}

// A short per-dimension lock. Two runs that write the same dimension must not
// interleave their before/after reads — the second waits for the first capture.
const locks = new Map()
async function withDimensionLock(dim, fn) {
    const key = String(dim).toLowerCase()
    const prev = locks.get(key) ?? Promise.resolve()
    let release
    const next = new Promise(r => { release = r })
    locks.set(key, prev.then(() => next))
    await prev
    try { return await fn() }
    finally {
        release()
        // Let the map shrink when this was the last waiter.
        setTimeout(() => { if (locks.get(key) === next) locks.delete(key) }, 0).unref?.()
    }
}

function elName(e) { return e?.Name ?? e?.name ?? null }
function elType(e) {
    const t = String(e?.Type ?? e?.type ?? '').toLowerCase()
    if (t.startsWith('cons') || t === 'c') return 'Consolidated'
    if (t.startsWith('str') || t === 's') return 'String'
    return 'Numeric'
}
function edgeKey(e) { return `${e?.ParentName ?? e?.parent}::${e?.ComponentName ?? e?.child}` }
function edgeWeight(e) { return Number(e?.Weight ?? e?.weight ?? 1) }

async function snapshotDimension(client, dim) {
    // Every hierarchy of the dimension, not only the default: a TI can add a move,
    // a weight or an element to an alternate hierarchy, and a release applies each
    // record to its own hierarchy file (Part G.2). TM1's automatic 'Leaves' is not
    // a stored hierarchy and is skipped.
    const names = await client.getHierarchies(dim).catch(() => null)
    const list = (names ?? [dim]).filter(n => n && String(n).toLowerCase() !== 'leaves')
    if (!list.length) list.push(dim)
    const hierarchies = new Map()
    for (const hier of list) {
        const [elements, edges] = await Promise.all([
            client.getElements(dim, hier).catch(() => []),
            client.getEdges(dim, hier).catch(() => []),
        ])
        hierarchies.set(hier, {
            elements: new Map((elements ?? []).map(e => [elName(e), elType(e)]).filter(([n]) => n)),
            edges: new Map((edges ?? []).map(e => [edgeKey(e), edgeWeight(e)])),
        })
    }
    const attrs = await readDimensionAttributes(client, dim).catch(() => ({ text: null, attributes: [] }))
    const doc = attrs?.text ? (() => { try { return JSON.parse(attrs.text) } catch { return null } })() : null
    return {
        dim,
        hierarchies,
        attrs: doc,
        attrDefs: new Map((doc?.Attributes ?? []).map(a => [a.Name, a.Type])),
        attrValues: new Map((doc?.Elements ?? []).map(e => [e.Name, e.Values ?? {}])),
    }
}

// Elements and edges only. No attributes, which are the expensive read. Used to
// watch every model dimension around a run, so a dimension whose name is built at
// run time is still diffed. A run that changes attributes on such a dimension is
// caught by the name sweep and the broad diff, not by this.
async function snapshotLight(client, dim) {
    const names = await client.getHierarchies(dim).catch(() => null)
    const list = (names ?? [dim]).filter(n => n && String(n).toLowerCase() !== 'leaves')
    if (!list.length) list.push(dim)
    const hierarchies = new Map()
    for (const hier of list) {
        const [elements, edges] = await Promise.all([
            client.getElements(dim, hier).catch(() => []),
            client.getEdges(dim, hier).catch(() => []),
        ])
        hierarchies.set(hier, {
            elements: new Map((elements ?? []).map(e => [elName(e), elType(e)]).filter(([n]) => n)),
            edges: new Map((edges ?? []).map(e => [edgeKey(e), edgeWeight(e)])),
        })
    }
    return { dim, hierarchies }
}

// ── Run-time-named objects (F.2) ────────────────────────────────────────────
// A TI that creates a subset/view/process/cube/chore/dimension with a name built
// at run time cannot be found by reading its text. Around every DEV run we read
// the name lists of every object (subsets per hierarchy, views per cube), so
// anything created or deleted is recorded; a subset/view also carries its content
// after the run.
//
// A name list cannot show that an EXISTING subset or view changed content, so the
// content of every subset and view on the dimensions and cubes the process names
// is compared too.

const hierList = async (client, dim) => {
    const names = await client.getHierarchies(dim).catch(() => null)
    const list = (names ?? [dim]).filter(n => n && String(n).toLowerCase() !== 'leaves')
    return list.length ? list : [dim]
}

// Every model object's names. Four flat sets plus nested maps for subsets
// (dimension → hierarchy → names) and views (cube → names).
async function snapshotNames(client) {
    const [dims, cubes, processes, chores] = await Promise.all([
        client.getModelDimensions().catch(() => []),
        client.getModelCubes().catch(() => []),
        client.getProcesses().catch(() => []),
        client.getChores().catch(() => []),
    ])
    const subsets = new Map()
    for (const dim of dims) {
        const byHier = new Map()
        for (const hier of await hierList(client, dim)) {
            const list = await client.getSubsets(dim, hier).catch(() => [])
            byHier.set(hier, new Set((list ?? []).map(s => s?.Name).filter(Boolean)))
        }
        subsets.set(dim, byHier)
    }
    const views = new Map()
    for (const cube of cubes) {
        const list = await client.getViews(cube).catch(() => [])
        views.set(cube, new Set((list ?? []).map(v => v?.name).filter(Boolean)))
    }
    return {
        dims: new Set(dims), cubes: new Set(cubes),
        processes: new Set(processes), chores: new Set(chores),
        subsets, views,
    }
}

const subsetKey = (dim, hier, name) => `${dim}::${hier}::${name}`
const viewKey = (cube, name) => `${cube}::${name}`

// Content of every subset and view on the dimensions/cubes the process names.
async function snapshotContent(client, { dims = new Set(), cubes = new Set() } = {}) {
    const subsets = new Map()
    for (const dim of dims) {
        for (const hier of await hierList(client, dim)) {
            const list = await client.getSubsets(dim, hier).catch(() => [])
            for (const s of list ?? []) {
                if (!s?.Name) continue
                const spec = await readSubset(client, dim, s.Name, hier).catch(() => null)
                subsets.set(subsetKey(dim, hier, s.Name), canonSubset(spec))
            }
        }
    }
    const views = new Map()
    for (const cube of cubes) {
        const list = await client.getViews(cube).catch(() => [])
        for (const v of list ?? []) {
            if (!v?.name) continue
            const spec = await readView(client, cube, v.name).catch(() => null)
            views.set(viewKey(cube, v.name), canonView(spec))
        }
    }
    return { subsets, views }
}

function diffNames(before, after) {
    const out = []
    for (const [type, action] of [
        ['dims', 'DIMENSION'], ['cubes', 'CUBE'], ['processes', 'PROCESS'], ['chores', 'CHORE'],
    ]) {
        for (const name of after[type] ?? []) if (!before[type].has(name)) out.push({ type: action.toLowerCase(), name, action: 'created' })
        for (const name of before[type] ?? []) if (!after[type].has(name)) out.push({ type: action.toLowerCase(), name, action: 'deleted' })
    }
    for (const [dim, hiers] of after.subsets ?? []) {
        const beforeHiers = before.subsets.get(dim) ?? new Map()
        for (const [hier, names] of hiers) {
            const beforeNames = beforeHiers.get(hier) ?? new Set()
            for (const name of names) if (!beforeNames.has(name)) out.push({ type: 'subset', name, dimension: dim, hierarchy: hier, action: 'created' })
            for (const name of beforeNames) if (!names.has(name)) out.push({ type: 'subset', name, dimension: dim, hierarchy: hier, action: 'deleted' })
        }
    }
    for (const [cube, names] of after.views ?? []) {
        const beforeNames = before.views.get(cube) ?? new Set()
        for (const name of names) if (!beforeNames.has(name)) out.push({ type: 'view', name, cube, action: 'created' })
        for (const name of beforeNames) if (!names.has(name)) out.push({ type: 'view', name, cube, action: 'deleted' })
    }
    return out
}

// Only entries present on both sides: a created/deleted one is already recorded
// by diffNames (and its content, for a subset/view, with it).
function diffContent(before, after) {
    const out = []
    for (const [key, value] of after.subsets ?? []) {
        if (!before.subsets.has(key) || before.subsets.get(key) === value) continue
        const [dimension, hierarchy, name] = key.split('::')
        out.push({ type: 'subset', name, dimension, hierarchy, before: before.subsets.get(key), after: value })
    }
    for (const [key, value] of after.views ?? []) {
        if (!before.views.has(key) || before.views.get(key) === value) continue
        const [cube, name] = key.split('::')
        out.push({ type: 'view', name, cube, before: before.views.get(key), after: value })
    }
    return out
}

// A created subset/view may sit on a dimension/cube the process did not name in a
// way the scanner could resolve. Its name is known from the list, so read its
// content directly — a created object always carries its content after the run.
async function addCreatedContent(client, nameDiff, contentAfter) {
    for (const c of nameDiff) {
        if (c.action !== 'created') continue
        if (c.type === 'subset') {
            const key = subsetKey(c.dimension, c.hierarchy, c.name)
            if (contentAfter.subsets.has(key)) continue
            const spec = await readSubset(client, c.dimension, c.name, c.hierarchy).catch(() => null)
            contentAfter.subsets.set(key, canonSubset(spec))
        } else if (c.type === 'view') {
            const key = viewKey(c.cube, c.name)
            if (contentAfter.views.has(key)) continue
            const spec = await readView(client, c.cube, c.name).catch(() => null)
            contentAfter.views.set(key, canonView(spec))
        }
    }
    return contentAfter
}

// Write the run's object-list and content changes into its change set. Pure apart
// from writeLog, like recordDimensionDiff, so a test never touches the DB.
function recordObjectDiff(server, nameDiff, contentDiff, afterContent, { user, writeLog = cl.writeLog } = {}) {
    const written = []
    const record = (action, objectType, objectName, detail, beforeState, afterState) => {
        writeLog({ server, action, objectType, objectName, detail, beforeState, afterState, user })
        written.push(action)
    }
    for (const c of nameDiff) {
        const action = c.action === 'created' ? 'CREATED' : 'DELETED'
        if (c.type === 'subset') {
            const before = c.action === 'deleted' ? { dimension: c.dimension, hierarchy: c.hierarchy } : null
            const after = c.action === 'created'
                ? { dimension: c.dimension, hierarchy: c.hierarchy, content: afterContent.subsets.get(subsetKey(c.dimension, c.hierarchy, c.name)) }
                : null
            record(c.action === 'created' ? 'SUBSET_SAVED' : 'SUBSET_DELETED', 'subset', c.name, c.dimension, before, after)
            continue
        }
        if (c.type === 'view') {
            const before = c.action === 'deleted' ? { cube: c.cube } : null
            const after = c.action === 'created'
                ? { cube: c.cube, content: afterContent.views.get(viewKey(c.cube, c.name)) }
                : null
            record(c.action === 'created' ? 'VIEW_SAVED' : 'VIEW_DELETED', 'view', c.name, c.cube, before, after)
            continue
        }
        const objectType = c.type
        record(`${objectType.toUpperCase()}_${action}`, objectType, c.name, null, null, c.action === 'created' ? { createdBy: 'process run' } : null)
    }
    for (const c of contentDiff) {
        if (c.type === 'subset') {
            record('SUBSET_SAVED', 'subset', c.name, c.dimension,
                { dimension: c.dimension, hierarchy: c.hierarchy, content: c.before },
                { dimension: c.dimension, hierarchy: c.hierarchy, content: c.after })
        } else {
            record('VIEW_SAVED', 'view', c.name, c.cube,
                { cube: c.cube, content: c.before }, { cube: c.cube, content: c.after })
        }
    }
    return written
}

// What a process may write, from its own text. Names resolved from literals and
// simple variable assignments; a name built at run time is not guessed.
async function writeTargets(client, processName) {
    const all = await fetchProcesses(client)
    const proc = (all ?? []).find(p => String(p?.Name).toLowerCase() === String(processName).toLowerCase())
        ?? await client.getProcess(processName).catch(() => null)
    if (!proc) return { dims: new Set(), cubes: [], process: null }
    const modelDims = typeof client.getModelDimensions === 'function'
        ? await client.getModelDimensions().catch(() => null) : null
    const dims = modelDims ?? (await client.getDimensions().catch(() => []))
    const dimNames = new Set((dims ?? []).map(d => d?.Name ?? d).filter(Boolean))
    const cubes = (await client.getCubes().catch(() => [])).map(c => c?.Name ?? c).filter(Boolean)
    const facts = scanProcess(proc, { dimNames, cubeNames: new Set(cubes), cubeDims: {} })
    const out = new Set((facts.dimWrites ?? []).map(d => d.dim))
    for (const a of facts.attrWrites ?? []) if (a.dim) out.add(a.dim)
    for (const s of facts.subsetOps ?? []) if (s.dim) out.add(s.dim)
    const cubeWrites = new Set((facts.writes ?? []).map(w => w.cube))
    for (const v of facts.viewOps ?? []) if (v.cube) cubeWrites.add(v.cube)
    for (const r of facts.reads ?? []) if (r.cube) cubeWrites.add(r.cube)
    return { dims: out, cubes: [...cubeWrites], process: proc, facts }
}

// Start a capture. Returns { complete() } — call complete() after the run,
// whatever its outcome, so a partially applied run is still recorded.
async function beginCapture(server, client, processName, { user } = {}) {
    const targets = await writeTargets(client, processName)
    const dims = [...targets.dims].sort()
    const scope = { dims: new Set(targets.dims), cubes: new Set(targets.cubes) }
    const timing = {}

    // Object names and the content of the named dimensions'/cubes' subsets and
    // views, before the run. Timed so the cost of the extra reads is visible.
    let namesBefore = null
    let contentBefore = null
    try {
        const t0 = Date.now()
        namesBefore = await snapshotNames(client)
        timing.namesMs = Date.now() - t0
        const t1 = Date.now()
        contentBefore = await snapshotContent(client, scope)
        timing.contentMs = Date.now() - t1
    } catch (e) {
        timing.error = sanitize(e.message, '')
    }

    const before = new Map()
    for (const dim of dims) {
        await withDimensionLock(dim, async () => {
            before.set(dim, await snapshotDimension(client, dim))
        })
    }

    // The named dimensions are not the whole story: a TI can build a name at run
    // time and write to a dimension its text never mentions. Read every other model
    // dimension lightly, so those changes are recorded too instead of appearing at
    // close as an unowned file difference. 35 dimensions cost ~0.1 s.
    const sweep = []
    const lightBefore = new Map()
    try {
        const modelDims = (typeof client.getModelDimensions === 'function'
            ? await client.getModelDimensions().catch(() => null)
            : null) ?? (await client.getDimensions().catch(() => []))
        const scoped = new Set(dims)
        const t = Date.now()
        for (const d of (modelDims ?? []).map(x => x?.Name ?? x).filter(Boolean)) {
            if (scoped.has(d)) continue
            sweep.push(d)
            lightBefore.set(d, await snapshotLight(client, d))
        }
        timing.sweepBeforeMs = Date.now() - t
    } catch (e) {
        timing.sweepError = sanitize(e.message, '')
    }
    let done = false
    return {
        dims,
        process: targets.process,
        timing,
        async complete() {
            if (done) return { recorded: false }
            done = true
            const recorded = []
            for (const dim of dims) {
                try {
                    const b = before.get(dim)
                    const a = await withDimensionLock(dim, () => snapshotDimension(client, dim))
                    recorded.push(...recordDimensionDiff(server, dim, b, a, { user }))
                } catch (e) {
                    cl.writeLog({
                        server, action: 'PROCESS_CAPTURE_ERROR', objectType: 'dimension', objectName: dim,
                        detail: `could not capture the run's changes: ${sanitize(e.message, '')}`, user,
                    })
                }
            }

            // Dimensions the process text did not name. A change here is the case
            // that used to leave an object unowned: the run built the target name.
            const swept = []
            if (sweep.length) {
                const t = Date.now()
                for (const dim of sweep) {
                    try {
                        const b = lightBefore.get(dim)
                        const a = await withDimensionLock(dim, () => snapshotLight(client, dim))
                        const recs = recordDimensionDiff(server, dim, b, a, { user, attributes: false })
                        if (recs.length) { swept.push(dim); recorded.push(...recs) }
                    } catch (e) {
                        cl.writeLog({
                            server, action: 'PROCESS_CAPTURE_ERROR', objectType: 'dimension', objectName: dim,
                            detail: `could not capture the run's changes (dimension not named in the process): ${sanitize(e.message, '')}`, user,
                        })
                    }
                }
                timing.sweepAfterMs = Date.now() - t
                timing.sweptDimensions = swept.length
            }

            // Objects the run created or deleted with a run-time name, and the
            // content of the named dimensions'/cubes' existing subsets and views.
            if (namesBefore && contentBefore) {
                try {
                    const t2 = Date.now()
                    const namesAfter = await snapshotNames(client)
                    timing.afterNamesMs = Date.now() - t2
                    const t3 = Date.now()
                    const contentAfter = await snapshotContent(client, scope)
                    timing.afterContentMs = Date.now() - t3
                    const nameDiff = diffNames(namesBefore, namesAfter)
                    const contentDiff = diffContent(contentBefore, contentAfter)
                    await addCreatedContent(client, nameDiff, contentAfter)
                    if (nameDiff.length || contentDiff.length) {
                        recorded.push(...recordObjectDiff(server, nameDiff, contentDiff, contentAfter, { user }))
                    }
                    timing.objectChanges = nameDiff.length + contentDiff.length
                } catch (e) {
                    cl.writeLog({
                        server, action: 'PROCESS_CAPTURE_ERROR', objectType: 'object', objectName: processName,
                        detail: `could not capture the run's created/changed objects: ${sanitize(e.message, '')}`, user,
                    })
                }
            }

            return { recorded, cubeDataNotDeployed: [...new Set(targets.cubes)].sort(), swept, timing }
        },
    }
}

// Diff two snapshots and write one log entry per change, in a form Build Release
// can replay. Pure apart from writeLog.
//
// `writeLog` lets a caller supply its own recorder (the MCP build tools do, so a
// change lands through their one logging path and a test never touches the DB).
// `attributes: false` records only elements/edges/hierarchies — used where the
// caller already records attribute changes itself.
function recordDimensionDiff(server, dim, b, a, { user, writeLog = cl.writeLog, attributes = true } = {}) {
    if (!b || !a) return []
    const written = []
    const record = (action, objectName, detail, beforeState, afterState) => {
        writeLog({ server, action, objectType: 'dimension', objectName, detail, beforeState, afterState, user })
        written.push(action)
    }
    const firstParent = (hier, name) => {
        for (const [k, weight] of hier.edges) {
            const [parent, child] = k.split('::')
            if (child === name) return { parent, weight }
        }
        return null
    }
    const hierarchyMap = (snap) => {
        if (snap?.hierarchies instanceof Map) return snap.hierarchies
        // A caller-built snapshot (older tests) has only the default hierarchy.
        return new Map([[dim, { elements: snap?.elements ?? new Map(), edges: snap?.edges ?? new Map() }]])
    }
    const bH = hierarchyMap(b)
    const aH = hierarchyMap(a)

    // A hierarchy the run created or removed is a record of its own: Build Release
    // carries its file and its link (created) or removes both (deleted).
    for (const hier of aH.keys()) {
        if (!bH.has(hier)) record('HIERARCHY_CREATED', dim, hier, null, { dimension: dim, hierarchy: hier })
    }
    for (const hier of bH.keys()) {
        if (!aH.has(hier)) record('HIERARCHY_DELETED', dim, hier, { dimension: dim, hierarchy: hier }, null)
    }

    for (const hier of new Set([...bH.keys(), ...aH.keys()])) {
        const before = bH.get(hier) ?? { elements: new Map(), edges: new Map() }
        const after = aH.get(hier) ?? { elements: new Map(), edges: new Map() }
        const where = hier

        // Elements: added, removed, type changes.
        for (const [name, type] of after.elements) {
            if (!before.elements.has(name)) {
                const place = firstParent(after, name)
                record('ELEMENT_ADDED', dim, `${name}${place ? ` under ${place.parent}` : ''} in ${where}`,
                    null, { element: name, type, parent: place?.parent ?? null, weight: place?.weight ?? 1, hierarchy: hier })
            } else if (before.elements.get(name) !== type) {
                record('ELEMENT_TYPE_CHANGED', dim, `${name}: ${before.elements.get(name)} → ${type} in ${where}`,
                    { element: name, type: before.elements.get(name), hierarchy: hier }, { element: name, type, hierarchy: hier })
            }
        }
        for (const [name, type] of before.elements) {
            if (!after.elements.has(name)) {
                const place = firstParent(before, name)
                record('ELEMENT_DELETED', dim, name, { element: name, type, parent: place?.parent ?? null, weight: place?.weight ?? null, hierarchy: hier }, null)
            }
        }

        // Edges: added, removed, weight changes.
        for (const [key, weight] of after.edges) {
            const [parent, child] = key.split('::')
            if (!before.edges.has(key)) {
                record('ELEMENT_LINKED', dim, `${child} under ${parent} in ${where}`, null, { element: child, parent, weight, hierarchy: hier })
            } else if (before.edges.get(key) !== weight) {
                record('EDGE_WEIGHT_CHANGED', dim, `${child} under ${parent}: ${before.edges.get(key)} → ${weight} in ${where}`,
                    { element: child, parent, weight: before.edges.get(key), hierarchy: hier }, { element: child, parent, weight, hierarchy: hier })
            }
        }
        for (const [key, weight] of before.edges) {
            if (!after.edges.has(key)) {
                const [parent, child] = key.split('::')
                record('EDGE_REMOVED', dim, `${parent} · removed ${child} in ${where}`, { element: child, parent, weight, hierarchy: hier }, null)
            }
        }
    }

    if (!attributes) return written

    // Attribute definitions.
    for (const [name, type] of a.attrDefs) {
        if (!b.attrDefs.has(name)) {
            writeLog({ server, action: 'ATTRIBUTE_CREATED', objectType: 'attribute', objectName: name, detail: dim, afterState: { type }, user })
            written.push('ATTRIBUTE_CREATED')
        } else if (String(b.attrDefs.get(name)).toLowerCase() !== String(type).toLowerCase()) {
            writeLog({ server, action: 'ATTRIBUTE_TYPE_CHANGED', objectType: 'attribute', objectName: name, detail: dim, beforeState: { type: b.attrDefs.get(name) }, afterState: { type }, user })
            written.push('ATTRIBUTE_TYPE_CHANGED')
        }
    }
    for (const [name] of b.attrDefs) {
        if (!a.attrDefs.has(name)) {
            writeLog({ server, action: 'ATTRIBUTE_DELETED', objectType: 'attribute', objectName: name, detail: dim, beforeState: { type: b.attrDefs.get(name) }, user })
            written.push('ATTRIBUTE_DELETED')
        }
    }

    // Attribute values.
    const attrs = [...a.attrDefs.keys()].filter(n => b.attrDefs.has(n))
    for (const [element, afterVals] of a.attrValues) {
        const beforeVals = b.attrValues.get(element) ?? {}
        for (const attribute of attrs) {
            const before = beforeVals[attribute]
            const after = afterVals[attribute]
            if (String(before ?? '') === String(after ?? '')) continue
            writeLog({
                server, action: 'ATTRIBUTE_VALUE_SET', objectType: 'attribute-value',
                objectName: `${dim}:${element}:${attribute}`,
                detail: { dimension: dim, hierarchy: dim, element, attribute, before: before ?? null, after: after ?? null },
                user,
            })
            written.push('ATTRIBUTE_VALUE_SET')
        }
    }
    return written
}

// Part F.1: DEV needs an open change set; TEST/PROD do not; an unknown label (not
// linked) must not be treated as DEV.
function requiresChangeSet(label, hasOpenSession) {
    const l = String(label ?? '').trim().toUpperCase()
    if (l !== 'DEV') return { required: false, reason: l ? `${l} runs need no change set` : 'the server\'s Git label is unknown' }
    if (hasOpenSession) return { required: false, reason: 'an open change set records this run' }
    return { required: true, reason: 'DEV: open a change set before running a process — the run\'s changes must be recorded so they can be deployed' }
}

module.exports = { serverLabel, beginCapture, recordDimensionDiff, recordObjectDiff, withDimensionLock, snapshotDimension, snapshotNames, snapshotContent, diffNames, diffContent, writeTargets, requiresChangeSet }
