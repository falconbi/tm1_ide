'use strict'

// ── Refresh DEV from PROD (dimensions first) ────────────────────────────────
// PROD changes; DEV must hold those changes before a deploy can safely replace
// PROD's model. This reads both servers live, works out what DEV is missing, and
// writes it to DEV — through the REST API, so TM1 Git writes DEV's file itself and
// no TM1 Git format is built by hand.
//
// Every write is recorded in the caller's OPEN change set (writeLog on the source
// server), which is what makes the release carry it and the approval cover it.
//
// The refresh MUST run while the change set is open: a closed set cannot record
// what was copied, so the deploy would ship objects nobody approved. Callers check
// that; this module refuses if there is no open session.
//
// Dimensions first. Attributes, hierarchies, chores and views/subsets follow in
// their own steps; each is a separate unit so they can be proved on their own.

const { makeClient } = require('./adapter-registry')
const { TM1Client } = require('./tm1-client')
const cl = require('./change-log')
const settings = require('./deploy-settings')
const { resolveBase, openBase, baseHierarchy, baseChore } = require('./deploy-base')
const { originOf } = require('./refresh-origins')
const { classifyDimension, summarise, applyDimension } = require('./refresh-dimension')

const TYPE = { N: 'Numeric', S: 'String', A: 'Alias', C: 'Consolidated' }

const elName = (e) => e?.Name ?? e?.name ?? null
const elType = (e) => {
    const t = e?.Type ?? e?.type
    return typeof t === 'string' ? (TYPE[t] ?? t) : t == null ? 'Numeric' : t
}

// Pure: what PROD has that DEV does not, and what DEV has that PROD does not.
//   elements: [{ name, type }]
//   edges:    [{ parent, child, weight }]
function diffDimension(prod, dev) {
    const pEls = new Map((prod.elements ?? []).map(e => [elName(e), elType(e)]))
    const dEls = new Map((dev.elements ?? []).map(e => [elName(e), elType(e)]))
    const addElements = [...pEls.entries()]
        .filter(([n]) => n && !dEls.has(n))
        .map(([name, type]) => ({ name, type }))
    const typeChanges = [...pEls.entries()]
        .filter(([n, t]) => n && dEls.has(n) && dEls.get(n) !== t)
        .map(([name, type]) => ({ name, from: dEls.get(name), to: type }))
    // Deletes are reported, never applied without an explicit tick.
    const removeElements = [...dEls.keys()].filter(n => n && !pEls.has(n))

    const key = (e) => `${e.ParentName ?? e.parent}::${e.ComponentName ?? e.child}`
    const pEdges = new Map((prod.edges ?? []).map(e => [key(e), e]))
    const dEdges = new Map((dev.edges ?? []).map(e => [key(e), e]))
    const addEdges = [...pEdges.entries()]
        .filter(([k]) => !dEdges.has(k))
        .map(([, e]) => ({ parent: e.ParentName ?? e.parent, child: e.ComponentName ?? e.child, weight: e.Weight ?? e.weight ?? 1 }))
    const removeEdges = [...dEdges.entries()]
        .filter(([k]) => !pEdges.has(k))
        .map(([, e]) => ({ parent: e.ParentName ?? e.parent, child: e.ComponentName ?? e.child }))
    // A MOVE is a child both sides have, with exactly one parent on each side, and a
    // different parent — archiving is the usual case. Anything else (a child with
    // several parents on one side) is an edge difference to add or report, never a
    // move: guessing there would delete a rollup DEV added.
    const parentsOf = (map, child) => [...map.values()]
        .filter(e => (e.ComponentName ?? e.child) === child)
        .map(e => ({ parent: e.ParentName ?? e.parent, weight: Number(e.Weight ?? e.weight ?? 1) }))
    const moves = []
    const bothChildren = new Set([...pEdges.values()].map(e => e.ComponentName ?? e.child))
    for (const child of bothChildren) {
        if (!dEdges.size && !pEdges.size) continue
        const onProd = parentsOf(pEdges, child)
        const onDev = parentsOf(dEdges, child)
        if (onProd.length !== 1 || onDev.length !== 1) continue
        if (onProd[0].parent === onDev[0].parent && onProd[0].weight === onDev[0].weight) continue
        moves.push({ child, toParent: onProd[0].parent, toWeight: onProd[0].weight, fromParent: onDev[0].parent, fromWeight: onDev[0].weight })
    }
    const differs = addElements.length || typeChanges.length || removeElements.length || addEdges.length || removeEdges.length || moves.length
    return { differs: !!differs, addElements, typeChanges, removeElements, addEdges, removeEdges, moves }
}

async function readAttributes(tm1, dim) {
    try { return await tm1.getElementAttributes(dim) } catch { return [] }
}

async function readDimension(tm1, dim, hierarchy = dim) {
    const elements = await tm1.getElements(dim, hierarchy).catch(() => [])
    const edges = await tm1.getEdges(dim, hierarchy).catch(() => [])
    return { elements, edges }
}

// The APPLY side must not read leniently: a failed read comes back as an empty
// dimension, which looks exactly like "nothing to refresh" — a hidden failure. Here
// the error is raised, so the caller reports it.
async function readDimensionStrict(tm1, dim, hierarchy = dim) {
    const [elements, edges] = await Promise.all([tm1.getElements(dim, hierarchy), tm1.getEdges(dim, hierarchy)])
    return { elements, edges }
}

// Read both servers and return one entry per dimension that differs. Control
// objects (}…) are skipped: they are not model changes a deploy ships.
async function planRefresh(source, target, { ideToken, baseCommit = null } = {}) {
    const dev = new TM1Client(source, makeClient(source, ideToken))
    const prod = new TM1Client(target, makeClient(target, ideToken))
    const dims = (await dev.getModelDimensions()).map(d => d?.Name ?? d).filter(Boolean)
    const approved = (await settings.get(target, { ideToken }).catch(() => ({})))?.attributeValues ?? {}

    // The baseline: what the target was last given. Without it nothing can be
    // ticked (apply refuses), and every difference is shown as "unknown".
    let base
    let reader = null
    try {
        if (baseCommit) {
            const rb = await resolveBase(target, { ideToken })
            const repoUrl = rb.repoUrl ?? null
            if (repoUrl) {
                reader = openBase(repoUrl, baseCommit)
                base = { ok: true, commit: baseCommit, source: 'override', override: true, branch: rb.branch ?? null, local: rb.local ?? null }
            } else base = { ok: false, reason: rb.reason }
        } else {
            base = await resolveBase(target, { ideToken })
            if (base.ok) reader = openBase(base.repoUrl, base.commit)
        }
    } catch (e) { base = { ok: false, reason: e.message } }

    const items = []
    for (const dim of dims) {
        const [a, b] = await Promise.all([
            readDimension(prod, dim),
            readDimension(dev, dim),
        ])
        if (!a.elements.length && !a.edges.length) continue
        const d = diffDimension(a, b)                      // the two-way detail, for "differs"
        const c = classifyDimension(reader ? baseHierarchy(reader, dim, dim) : null, a, b)
        const offered = c.addElements.length || c.addEdges.length || c.moves.length || c.removeElements.length ||
            c.removeEdges.length || c.weightChanges.length || c.typeChanges.length || c.typeConflicts.length || c.moveConflicts.length

        // Attribute definitions: a dimension can be identical in elements and still
        // be missing an attribute PROD has.
        let attributes = { add: [], onlyDev: [], typeChanges: [], confirmedValues: [], valueElements: 0 }
        try {
            const [pa, da] = await Promise.all([prod.getElementAttributes(dim), dev.getElementAttributes(dim)])
            const defs = diffAttributeDefinitions(pa, da)
            // Only the attributes an admin confirmed PROD's load maintains may have
            // their VALUES copied (A3). Never wholesale.
            const confirmed = new Set(approved[dim] ?? [])
            const prodNames = new Set((a.elements ?? []).map(elName).filter(Boolean))
            const devNames = new Set((b.elements ?? []).map(elName).filter(Boolean))
            let valueElements = 0
            for (const n of prodNames) if (devNames.has(n)) valueElements++
            attributes = {
                ...defs,
                confirmedValues: [...confirmed].filter(x => [...defs.add.map(a => a.name), ...((da ?? []).map(a => a.Name))].includes(x)),
                valueElements,
                // No baseline exists for attributes (control cubes are not exported),
                // so a missing definition is reported, never preselected.
                noBase: true,
                warning: defs.add.length
                    ? 'Attributes are not in TM1 Git, so there is no baseline to say who removed one. Nothing is selected; tick an attribute to create it on DEV.'
                    : null,
            }
        } catch { /* no attribute access — carry on with elements */ }

        if (!offered && !attributes.add.length && !attributes.typeChanges.length) continue
        // Giving a leaf element children turns it into a consolidation, and TM1
        // clears the values stored against it. PROD already made that choice; on
        // DEV it is still a destructive step that must be named before it happens.
        const devType = new Map((b.elements ?? []).map(e => [elName(e), elType(e)]))
        const prodType = new Map((a.elements ?? []).map(e => [elName(e), elType(e)]))
        const parents = new Set([...d.addEdges.map(e => e.parent), ...d.moves.map(m => m.toParent)])
        const typeRisk = [...parents]
            .filter(p => p && devType.get(p) === 'Numeric' && prodType.get(p) === 'Consolidated')
            .map(p => ({ element: p, from: 'Numeric', to: 'Consolidated' }))
        items.push({
            dimension: dim,
            differs: d.differs,
            ...c,
            // What the person needs to see, one line per kind (2,295 grey rows in a
            // list help nobody) — the UI expands a count into the elements.
            summary: summarise(c),
            typeRisk,
            attributes,
            baseKnown: !!reader,
            origin: c.unknown ? 'unknown' : null,
        })
    }
    // Chores: schedule only. The flag is the deploy's business (A5), and DEV's
    // chore is left off regardless.
    const chores = []
    try {
        const [pn, dn] = await Promise.all([prod.getChores(), dev.getChores()])
        const names = new Set([...(pn ?? []), ...(dn ?? [])])
        for (const name of names) {
            let pc = null, dc = null
            try { pc = await prod.getChore(name) } catch { pc = null }
            try { dc = await dev.getChore(name) } catch { dc = null }
            if (!pc && !dc) continue
            const d = diffChore(pc ?? {}, dc ?? {})
            // Three-way on the schedule: only a PROD-side change is offered. A
            // schedule DEV changed alone is DEV's (it ships); both changed
            // differently is a conflict with no default.
            const bc = reader ? baseChore(reader, name) : null
            const sched = (x) => x ? `${x?.StartTime ?? ''}|${x?.Frequency ?? ''}|${x?.ExecutionMode ?? ''}` : null
            const origin = reader
                ? originOf(sched(bc), pc ? sched(pc) : null, dc ? sched(dc) : null,
                    { value: { base: sched(bc), prod: sched(pc), dev: sched(dc) } })
                : 'unknown'
            const offer = origin === 'target-changed' || origin === 'target-added' || origin === 'conflict' || origin === 'dev-added'
            if (!offer && !d.devMustStayOff) continue
            chores.push({ name, onTarget: !!pc, onDev: !!dc, origin, choice: origin === 'conflict' || origin === 'unknown' ? null : 'take', ...d })
        }
    } catch { /* no chore access — carry on with dimensions */ }

    // Views and subsets are the last two object types a deploy ships, and their
    // refresh is its own unit: present on both sides with different content is a
    // CONFLICT that needs a choice (no default), only on the target is a gap.
    let coverage = { subsets: [], views: [], hierarchies: [] }
    try {
        const { planCovers } = require('./refresh-covers')
        const c = await planCovers(source, target, { ideToken, reader })
        coverage = { ...coverage, subsets: c.subsets, views: c.views, coversSkipped: c.skipped }
    } catch { /* no view/subset access — dimensions and chores still planned */ }
    // Alternate hierarchies: a gap is created, a difference on both sides is a choice.
    try {
        const { planHierarchies } = require('./refresh-hierarchy')
        coverage.hierarchies = await planHierarchies(source, target, { ideToken, reader })
    } catch { /* no hierarchy access — the rest still planned */ }

    return {
        source, target,
        base: { ok: !!reader, commit: base.commit ?? null, source: base.source ?? null, override: !!base.override, reason: base.reason ?? null, branch: base.branch ?? null, local: base.local ?? null },
        dimensions: items, chores, ...coverage,
    }
}

// Apply the ticked dimensions to DEV and record each one in the open change set.
//   accept: [{ dimension, includeDeletes }] — one tick per dimension. Everything
//           PROD has (elements, edges, moves) is brought across; deletes are the
//           only separate decision, because removing an element on DEV is how the
//           next deploy would remove it on PROD.
//
// A dimension is applied whole on purpose: adding an edge without its move, or an
// element without the edge that places it, leaves DEV in a state neither server
// has. Partial application is not offered.
// ── Attributes ──────────────────────────────────────────────────────────────
// Two different things, refreshed differently:
//   definitions  — the attribute itself (name + type). PROD having one DEV lacks is
//                  a real gap: a rule or a view reads it. Copied.
//   values       — the data in it. Only for attributes whose owner has confirmed
//                  PROD's load maintains them (A3), never wholesale: on a loaded
//                  dimension, copying every value would overwrite what PROD wrote.
//
// Pure: definitions in, difference out. The value side needs a per-element read and
// is decided by the confirmed list, so it is not part of this.
function diffAttributeDefinitions(prodDefs = [], devDefs = []) {
    const norm = (t) => {
        const x = String(t ?? '').toUpperCase()
        if (x === 'C' || x === 'CONSOLIDATED') return 'C'
        if (x === 'N' || x === 'NUMERIC') return 'N'
        return 'S'   // String is TM1's default for attributes
    }
    const prod = new Map((prodDefs ?? []).filter(a => a?.Name).map(a => [a.Name, norm(a.Type)]))
    const dev = new Map((devDefs ?? []).filter(a => a?.Name).map(a => [a.Name, norm(a.Type)]))
    const add = [...prod.entries()].filter(([n]) => !dev.has(n)).map(([name, type]) => ({ name, type }))
    const onlyDev = [...dev.keys()].filter(n => !prod.has(n))
    const typeChanges = [...prod.entries()]
        .filter(([n, t]) => dev.has(n) && dev.get(n) !== t)
        .map(([name, to]) => ({ name, from: dev.get(name), to }))
    return { add, onlyDev, typeChanges, differs: add.length > 0 || typeChanges.length > 0 }
}

// Which attributes PROD's own processes write, read from their text. This is a
// SUGGESTION for the admin to confirm — never applied on its own. Only literal
// arguments can be read; a process that passes variables falls back to nothing,
// which is honest: a guess is worse than a gap.
function suggestAttributeWrites(processes = []) {
    const out = new Map()   // dimension → Set(attribute)
    const call = /(AttrPutS|AttrPutN|ElementAttrPutS|ElementAttrPutN)\s*\(([^)]*)\)/g
    const lit = /^\s*(['"])(.*?)\1\s*$/
    for (const p of processes ?? []) {
        const text = String(p?.PrologProcedure ?? p?.text ?? '')
        let m
        while ((m = call.exec(text))) {
            const args = m[2].split(',').map(a => a.trim())
            // AttrPut*(value, dim, element, attr [, …])
            const dim = (args[1] ?? '').match(lit)?.[2]
            const attr = (args[3] ?? '').match(lit)?.[2]
            if (!dim || !attr) continue
            if (!out.has(dim)) out.set(dim, new Set())
            out.get(dim).add(attr)
        }
    }
    return Object.fromEntries([...out].map(([d, set]) => [d, [...set].sort()]))
}

// ── Chores ──────────────────────────────────────────────────────────────────
// Operations own WHEN a chore runs and whether it is on. A refresh copies the
// target's schedule onto DEV so the deploy does not move it back, but DEV's chore
// is left OFF: a dev server running a chore at production times is an incident, not
// a convenience. The on/off flag itself travels with the deploy, restored around
// the pull (A5), not with the refresh.
function diffChore(prodChore, devChore) {
    const fields = []
    for (const f of ['StartTime', 'Frequency', 'ExecutionMode']) {
        if (String(prodChore?.[f] ?? '') !== String(devChore?.[f] ?? '')) fields.push(f)
    }
    return {
        scheduleDiffers: fields.length > 0,
        fields,
        targetActive: !!prodChore?.Active,
        devActive: !!devChore?.Active,
        devMustStayOff: !!devChore?.Active,
    }
}

// Which type changes actually need a PATCH, and which are already settled by the
// edges. Ordering matters in TM1: a leaf only becomes a consolidation once it has
// a component, so patching Type=Consolidated before the edge fails with "element
// has no components". An element the move or edge just made a rollup therefore
// needs no patch at all.
//
// Pure, so the rule is testable without a server.
function typeChangesToApply(diff, want = {}) {
    const gainsComponents = new Set([
        ...(diff?.moves ?? []).filter(m => want?.moves?.[m.child] !== 'keep').map(m => m.toParent),
        ...(diff?.addEdges ?? []).map(e => e.parent),
    ])
    const patch = []
    const skip = []
    for (const t of diff?.typeChanges ?? []) {
        if (t.to === 'Consolidated' && gainsComponents.has(t.name)) continue   // the edge did it
        if (!want?.allowTypeChanges) { skip.push({ ...t, why: 'not allowed' }); continue }
        patch.push(t)
    }
    return { patch, skip }
}

// A decision is part of the record: it goes into the open change set, so Review
// and the deploy report can show who chose what.
function recordDecision(server, dimension, text, { kind, element, choice, user }) {
    try {
        cl.writeLog({
            server, action: 'REFRESH_DECISION', objectType: 'dimension', objectName: dimension,
            detail: text, user,
            afterState: { kind, element, choice },
        })
    } catch { /* the decision still applied; the log is evidence, not the action */ }
}

// Every delete and every move PROD made must be decided before the refresh can
// apply. There is no default: an undecided delete left alone would be silently
// restored on PROD by the next deploy, and an undecided move silently put back.
// Pure, so the rule is testable without a server.
//
//   want.deletes: { [element]: 'delete' | 'keep' }
//   want.moves:   { [child]:   'take'   | 'keep' }
function undecidedDecisions(diff, want = {}) {
    const open = []
    for (const el of diff?.removeElements ?? []) {
        const choice = want?.deletes?.[el]
        if (choice !== 'delete' && choice !== 'keep') open.push({ dimension: want?.dimension ?? null, kind: 'delete', element: el })
    }
    for (const m of diff?.moves ?? []) {
        const choice = want?.moves?.[m.child]
        if (choice !== 'take' && choice !== 'keep') open.push({ dimension: want?.dimension ?? null, kind: 'move', element: m.child })
    }
    return open
}

// Attribute work for ONE dimension: create the definitions the target has and DEV
// lacks, take a type only when chosen, and copy VALUES for the confirmed list only.
// Returns three separate lists, because "not chosen" and "failed" are different
// things and must never be reported as the same.
async function applyAttributeChanges(dev, prod, dim, { attributeTypes = {}, confirmed = [], devElements = [], creates = [] } = {}) {
    const changed = []
    const errors = []
    const decisions = []
    let defs
    try {
        const [pa, da] = await Promise.all([prod.getElementAttributes(dim), dev.getElementAttributes(dim)])
        defs = { ...diffAttributeDefinitions(pa, da), pa, da }
    } catch (e) {
        return { changed, errors: [{ dimension: dim, what: 'attributes', why: e.message }], decisions }
    }
    const tm1Type = (t) => (t === 'N' ? 'Numeric' : 'String')

    for (const a of defs.add) {
        // Attributes are not in TM1 Git, so there is no baseline to say who removed
        // one. Creating every missing definition could resurrect one DEV deleted on
        // purpose, so only an explicitly ticked attribute is created.
        if (!creates.includes(a.name)) continue
        try {
            await dev.createElementAttribute(dim, a.name, tm1Type(a.type))
            changed.push(`attribute ${a.name}`)
        } catch (e) {
            errors.push({ dimension: dim, what: `attribute ${a.name}`, why: e.message })
        }
    }
    for (const t of defs.typeChanges) {
        if (attributeTypes?.[t.name] === 'keep') { decisions.push({ kind: 'attribute', element: t.name, choice: 'keep' }); continue }
        try {
            await dev.deleteElementAttribute(dim, t.name).catch(() => {})
            await dev.createElementAttribute(dim, t.name, tm1Type(t.to))
            changed.push(`attribute ${t.name}: type ${t.from} → ${t.to}`)
            decisions.push({ kind: 'attribute', element: t.name, choice: 'take' })
        } catch (e) {
            errors.push({ dimension: dim, what: `attribute ${t.name} type`, why: e.message })
        }
    }
    if (confirmed.length) {
        const types = new Map([...(defs.da ?? []), ...(defs.pa ?? [])].map(a => [a.Name, String(a.Type ?? 'S').toUpperCase().startsWith('N') ? 'N' : 'S']))
        const devNames = new Set(devElements)
        let copied = 0
        for (const el of devNames) {
            const vals = await prod.getElementAttributeValues(dim, el).catch(() => null)
            if (!vals) continue
            for (const attr of confirmed) {
                if (!(attr in vals)) continue
                try { await dev.writeElementAttribute(dim, el, attr, vals[attr], types.get(attr) ?? 'S'); copied++ }
                catch (e) { errors.push({ dimension: dim, what: `value of ${attr} on ${el}`, why: e.message }) }
            }
        }
        if (copied) changed.push(`values for ${confirmed.join(', ')} (${copied} cells)`)
    }
    return { changed, errors, decisions }
}

async function applyRefresh(source, target, { ideToken, session, accept = [], chores = [], covers = [], hierarchies = [], user } = {}) {
    if (!session) throw Object.assign(new Error('Refused: open a change set first — a refresh must be recorded in one.'), { refused: true })
    const sess = cl.getSession(session)
    if (!sess) throw Object.assign(new Error(`Refused: no change set ${session}.`), { refused: true })
    if (sess.server !== source) throw Object.assign(new Error(`Refused: change set "${sess.name}" belongs to ${sess.server}, not ${source}.`), { refused: true })
    if (sess.closed_at) throw Object.assign(new Error(`Refused: change set "${sess.name}" is closed. Reopen it to bring ${target}'s changes into ${source}.`), { refused: true })

    const dev = new TM1Client(source, makeClient(source, ideToken))
    const prod = new TM1Client(target, makeClient(target, ideToken))
    const applied = []
    const skipped = []
    const errors = []

    // The baseline. Apply ALWAYS recomputes against the real one: a screen built
    // with ?base=, or a plan left open while someone else deployed, can never
    // authorise a write here.
    const baseInfo = await resolveBase(target, { ideToken }).catch(e => ({ ok: false, reason: e.message }))
    if (!baseInfo.ok) {
        throw Object.assign(new Error(
            `Refused: no baseline for ${target} — ${baseInfo.reason} Refresh cannot write without knowing what PROD changed since the last deploy.`
        ), { refused: true, baseMissing: true })
    }
    const reader = openBase(baseInfo.repoUrl, baseInfo.commit)

    // Classify every accepted dimension against the baseline. Anything the plan
    // did not offer (DEV removed it, DEV changed it) is not written, and a choice
    // that is not in this classification is refused as a stale plan.
    const undecided = []
    const stale = []
    const planned = []
    for (const want of accept) {
        const dim = want.dimension
        const [p, d] = await Promise.all([readDimensionStrict(prod, dim), readDimensionStrict(dev, dim)])
        const c = classifyDimension(baseHierarchy(reader, dim, dim), p, d)
        planned.push({ want, c, p, d })
        for (const e of c.removeElements) if (!['delete', 'keep'].includes(want.deletes?.[e.name])) undecided.push({ dimension: dim, kind: 'delete', element: e.name })
        for (const e of c.removeEdges) { const k = `${e.parent}::${e.child}`; if (!['delete', 'keep'].includes(want.deletes?.[k])) undecided.push({ dimension: dim, kind: 'edge', element: k }) }
        for (const m of c.moveConflicts) if (!['take', 'keep'].includes(want.moves?.[m.child])) undecided.push({ dimension: dim, kind: 'move', element: m.child })
        const knownRemove = (n) => c.removeElements.some(e => e.name === n) || c.removeEdges.some(e => `${e.parent}::${e.child}` === n)
        for (const n of Object.keys(want.deletes ?? {})) if (!knownRemove(n)) stale.push(`${dim}: delete ${n}`)
        const knownMove = (n) => [...c.moves, ...c.moveConflicts].some(m => m.child === n)
        for (const n of Object.keys(want.moves ?? {})) if (!knownMove(n)) stale.push(`${dim}: move ${n}`)
    }
    if (stale.length) {
        throw Object.assign(new Error(
            `Refused: this is not the plan against ${target}'s current baseline — ${stale.join(', ')}. ` +
            `Someone deployed since it was built (or it used a different base). Rebuild the plan and decide again.`
        ), { refused: true, stale })
    }
    // An attribute whose type differs is a decision too: taking PROD's type clears
    // the values stored in it.
    for (const { want } of planned) {
        try {
            const [pa, da] = await Promise.all([readAttributes(prod, want.dimension), readAttributes(dev, want.dimension)])
            for (const t of diffAttributeDefinitions(pa, da).typeChanges) {
                if (!['take','keep'].includes(want.attributeTypes?.[t.name])) {
                    undecided.push({ dimension: want.dimension, kind: 'attribute', element: t.name })
                }
            }
        } catch { /* no attribute access: nothing to decide */ }
    }
    if (undecided.length) {
        const names = undecided.map(u => `${u.kind} ${u.element} (${u.dimension})`)
        throw Object.assign(new Error(
            `Refused: decide these before refreshing — ${names.join(', ')}. ` +
            `A delete is "delete on DEV too" or "keep it and restore it on PROD"; a move is "take PROD's" or "keep DEV's"; ` +
            `an attribute type is "take PROD's type" (its values are cleared) or "keep DEV's".`
        ), { refused: true, undecided })
    }

    // Views and subsets: an object on BOTH sides with different content is a
    // conflict, not a gap. "Take the target's" and "keep DEV's" are both legitimate
    // and there is no default — the same rule as a delete or a move. Checked before
    // any write, so a refresh is never half-done.
    let coverPlan = { subsets: [], views: [], skipped: [] }
    try {
        const { planCovers } = require('./refresh-covers')
        coverPlan = await planCovers(source, target, { ideToken, reader })
    } catch { /* no access: the apply below reports it rather than guessing */ }
    const coverageKey = (x) => `${x.type}:${x.name}:${x.dimension ?? x.cube}`
    const chosen = new Map((Array.isArray(covers) ? covers : []).map(c => [coverageKey(c), c.choice]))
    const coverChoiceOk = (x) => (x.removing ? ['delete', 'keep'] : ['take', 'keep']).includes(chosen.get(coverageKey(x)))
    const undecidedCovers = [...(coverPlan.subsets ?? []), ...(coverPlan.views ?? [])]
        .filter(x => x.differs && !x.adding && !coverChoiceOk(x))
    if (undecidedCovers.length) {
        const names = undecidedCovers.map(u => `${u.type} ${u.name} (${u.dimension ?? u.cube})`)
        throw Object.assign(new Error(
            `Refused: decide these before refreshing — ${names.join(', ')}. ` +
            `Each exists on both servers with different content: "take the target's" or "keep ${source}'s" (the next deploy then carries it).`
        ), {
            refused: true,
            undecided: undecidedCovers.map(u => ({ kind: u.type, element: u.name, dimension: u.dimension ?? u.cube })),
        })
    }
    for (const s of coverPlan.skipped ?? []) skipped.push({ dimension: s.what, what: 'not refreshed', why: s.why })

    // Alternate hierarchies: same rule as views and subsets — a hierarchy on both
    // sides with a different shape needs a choice, and there is no default.
    let hierarchyPlan = []
    try {
        const { planHierarchies } = require('./refresh-hierarchy')
        hierarchyPlan = await planHierarchies(source, target, { ideToken, reader })
    } catch { /* reported by the apply below if it cannot run */ }
    const hKey = (x) => `hierarchy:${x.name}:${x.dimension}`
    const hChosen = new Map((Array.isArray(hierarchies) ? hierarchies : []).map(h => [hKey(h), h.choice]))
    const hierChoiceOk = (x) => (x.removing ? ['delete', 'keep'] : ['take', 'keep']).includes(hChosen.get(hKey(x)))
    const undecidedHiers = hierarchyPlan.filter(x => x.differs && !x.adding && !hierChoiceOk(x))
    if (undecidedHiers.length) {
        const names = undecidedHiers.map(u => `hierarchy ${u.name} (${u.dimension})`)
        throw Object.assign(new Error(
            `Refused: decide these before refreshing — ${names.join(', ')}. ` +
            `Each exists on both servers with a different shape: "take the target's" or "keep ${source}'s" (the next deploy then carries it).`
        ), { refused: true, undecided: undecidedHiers.map(u => ({ kind: 'hierarchy', element: u.name, dimension: u.dimension })) })
    }

    for (const { want, c, p, d } of planned) {
        const dim = want.dimension
        try {
            const changed = []

            // A move or edge can turn a leaf on DEV into a consolidation, clearing the
            // values stored against it. Never do that silently.
            const devType = new Map((d.elements ?? []).map(e => [elName(e), elType(e)]))
            const prodType = new Map((p.elements ?? []).map(e => [elName(e), elType(e)]))
            const parents = new Set([...c.addEdges.map(e => e.parent), ...c.moves.map(m => m.toParent)])
            const risky = [...parents].filter(x => x && devType.get(x) === 'Numeric' && prodType.get(x) === 'Consolidated')
            if (risky.length && !want.allowTypeChanges) {
                throw Object.assign(new Error(
                    `Refused: refreshing ${dim} would turn ${risky.join(', ')} into consolidation${risky.length === 1 ? '' : 's'} on ${source}, ` +
                    `and TM1 clears the values stored against ${risky.length === 1 ? 'it' : 'them'}. ` +
                    `Tick "allow element type changes" if that is intended, or make the change in the model.`
                ), { refused: true })
            }
            for (const t of c.typeChanges) {
                if (!want.allowTypeChanges) {
                    skipped.push({ dimension: dim, what: `type of ${t.name} (${t.from} → ${t.to})`, why: 'tick "allow element type changes" — the values stored against it are cleared' })
                }
            }

            // The writes: only what the classification offered (target-side changes).
            const dimRes = await applyDimension(dev, prod, baseHierarchy(reader, dim, dim), dim, want, {
                source, user,
                record: (text, meta) => recordDecision(source, dim, text, { ...meta, user }),
            })
            changed.push(...dimRes.changed)
            errors.push(...dimRes.errors)

            // Attributes, in their own function so a failure is an ERROR, not a "skip":
            // not chosen and failed must never read the same.
            const wantConfirmed = want.confirmedAttributes ?? []
            const attrRes = await applyAttributeChanges(dev, prod, dim, {
                attributeTypes: want.attributeTypes ?? {},
                creates: want.attributeCreates ?? [],
                confirmed: wantConfirmed,
                devElements: (d.elements ?? []).map(elName).filter(Boolean),
            })
            changed.push(...attrRes.changed)
            errors.push(...attrRes.errors)
            for (const dec of attrRes.decisions) {
                recordDecision(source, dim, `attribute ${dec.element}: ${dec.choice === 'take' ? "took the target's type (its values are cleared)" : `${source}'s type kept`}`, { ...dec, user })
            }

            if (changed.length) {
                cl.writeLog({ server: source, action: 'DIMENSION_UPDATED', objectType: 'dimension', objectName: dim, detail: changed.join('; '), user })
                applied.push({ dimension: dim, applied: changed })
            }
        } catch (e) {
            // A dimension that could not be refreshed is an ERROR with TM1's message,
            // never a silent omission or a "skip".
            errors.push({ dimension: dim, what: 'not refreshed', why: e.message })
        }
    }
// Chores: copy the target's SCHEDULE onto DEV; never its flag. A DEV chore that
// is on is switched off and that is recorded — it is a safety action, not a
// preference.
    for (const c of chores) {
        if (!c?.name || c.takeSchedule === false) continue
        const pc = await prod.getChore(c.name).catch(() => null)
        const dc = await dev.getChore(c.name).catch(() => null)
        if (!pc || !dc) { skipped.push({ dimension: c.name, what: 'chore', why: !pc ? 'not on the target' : 'not on DEV' }); continue }
        const d = diffChore(pc, dc)
        const patch = {}
        if (d.fields.includes('StartTime')) patch.StartTime = pc.StartTime
        if (d.fields.includes('Frequency')) patch.Frequency = pc.Frequency
        if (d.fields.includes('ExecutionMode')) patch.ExecutionMode = pc.ExecutionMode
        if (dc.Active) patch.Active = false
        if (!Object.keys(patch).length) continue
        await dev.updateChore(c.name, patch)
        const detail = [
            d.fields.length ? `schedule from target: ${d.fields.join(', ')}` : null,
            dc.Active ? 'switched OFF on DEV (a chore on a dev server is an incident)' : null,
        ].filter(Boolean).join('; ')
        applied.push({ dimension: `chore ${c.name}`, applied: detail })
        recordDecision(source, `chore ${c.name}`, detail, { kind: 'chore', element: c.name, choice: 'schedule', user })
        cl.writeLog({ server: source, action: 'CHORE_UPDATED', objectType: 'chore', objectName: c.name, detail, user })
    }

    // Views and subsets last, subsets before views (a view may bind a named subset).
    try {
        const { applyCovers } = require('./refresh-covers')
        const cov = await applyCovers(dev, prod, { covers, source, target, user, plan: coverPlan })
        for (const c of cov.changed) applied.push({ dimension: c.label, applied: c.text })
        for (const d of cov.decisions) applied.push({ dimension: d.label, applied: d.text })
        for (const e of cov.errors) errors.push({ dimension: e.what, what: 'not applied', why: e.why })
    } catch (e) {
        // The covers unit failed as a whole (no access, a broken client): an error,
        // never a silent omission.
        errors.push({ dimension: 'views and subsets', what: 'not applied', why: e.message })
    }

    // Alternate hierarchies last: a subset or a view can depend on one existing.
    try {
        const { applyHierarchies } = require('./refresh-hierarchy')
        const h = await applyHierarchies(dev, prod, { hierarchies, source, target, user, plan: hierarchyPlan })
        for (const c of h.changed) applied.push({ dimension: c.label, applied: c.text })
        for (const d of h.decisions) applied.push({ dimension: d.label, applied: d.text })
        for (const e of h.errors) errors.push({ dimension: e.what, what: 'not applied', why: e.why })
    } catch (e) {
        errors.push({ dimension: 'alternate hierarchies', what: 'not applied', why: e.message })
    }

    return { ok: true, source, target, applied, skipped, errors }
}

module.exports = { diffDimension, undecidedDecisions, typeChangesToApply, diffAttributeDefinitions, diffChore, suggestAttributeWrites, applyAttributeChanges, planRefresh, applyRefresh }
