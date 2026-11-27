'use strict'

// ── Sync DEV from PROD (Part E) ─────────────────────────────────────────────
// Separate from a deploy, and never a deploy itself. Keeps DEV close to PROD on a
// long project: PROD's own changes (elements, parents, hierarchies, attribute
// definitions/values, subsets, views, chore schedules) are written onto DEV in a
// change set of kind `sync`, which owns nothing and is never deployed.
//
// Default is "take PROD's". The admin may untick any item to skip it this time;
// it appears again at the next sync. A failed write stops the sync and lists what
// was and was not written.

const cl = require('./change-log')
const { planRefresh, applyRefresh } = require('./refresh-dev')
const { makeClient } = require('./adapter-registry')
const { TM1Client } = require('./tm1-client')
const { closeChangeSet } = require('./change-set-service')
const { finalizeDevClose, changedAttributeValues, docsFromFiles, readAttrsAtCommit } = require('./close-check')

// One key per item, used by the screen's untick list.
const dimKey = (d) => `dimension:${d}`
const coverKey = (c) => `${c.type}:${c.name}:${c.dimension ?? c.cube}`
const hierKey = (h) => `hierarchy:${h.name}:${h.dimension}`
const choreKey = (c) => `chore:${c.name}`

// Pure: the plan, minus what the admin unticked, in the shapes applyRefresh wants.
function syncSelection(plan, { untick = [] } = {}) {
    const skip = new Set(untick ?? [])
    const accept = []
    for (const d of plan.dimensions ?? []) {
        if (d.offered === false || skip.has(dimKey(d.dimension))) continue
        const deletes = {}
        for (const el of d.removeElements ?? []) deletes[el] = 'delete'
        for (const e of d.removeEdges ?? []) deletes[`${e.parent}::${e.child}`] = 'delete'
        const moves = {}
        for (const m of d.moves ?? []) moves[m.child] = 'take'
        const attributeTypes = {}
        for (const t of d.attributes?.typeChanges ?? []) attributeTypes[t.name] = 'take'
        accept.push({
            dimension: d.dimension,
            allowTypeChanges: true,
            deletes, moves, attributeTypes,
            attributeCreates: (d.attributes?.add ?? []).map(a => a.name),
            confirmedAttributes: [],
        })
    }
    const chores = (plan.chores ?? [])
        .filter(c => !skip.has(choreKey(c)))
        .map(c => ({ name: c.name, takeSchedule: true }))
    const covers = [...(plan.subsets ?? []), ...(plan.views ?? [])]
        .filter(c => !skip.has(coverKey(c)))
        .map(c => ({
            type: c.type, name: c.name, dimension: c.dimension, cube: c.cube, hierarchy: c.hierarchy,
            choice: c.removing ? 'delete' : 'take',
        }))
    const hierarchies = (plan.hierarchies ?? [])
        .filter(h => !skip.has(hierKey(h)))
        .map(h => ({ dimension: h.dimension, name: h.name, choice: h.removing ? 'delete' : 'take' }))
    return { accept, chores, covers, hierarchies }
}

// A developer whose DEV change PROD's value replaces is told, on their change set.
// The note names the item, PROD's value, their old value and this sync change set.
// The change set list shows the description; the IDE has no separate notification
// store, so this note is the notification.
function clashNote(clash, { target, syncName }) {
    return `Sync from ${target} replaced your ${clash.item} (sync change set "${syncName}"): PROD's value ${clash.prodValue ?? '(none)'}; your old value ${clash.devValue ?? '(none)'}.`
}

function notifyClashOwners(clashes, { target, syncName, log = cl } = {}) {
    const noted = []
    for (const c of clashes ?? []) {
        const id = c?.changeSet?.id
        if (!id) continue
        const sess = log.getSession(id)
        if (!sess) continue
        const note = clashNote(c, { target, syncName })
        if (String(sess.description ?? '').includes(note)) continue
        log.updateSessionDescription(id, sess.description ? `${sess.description}\n${note}` : note)
        noted.push({ id, name: c.changeSet.name, note })
    }
    return noted
}

// Attribute VALUES PROD changed since its last deploy. The brief's default is
// "take PROD's", so these are written even when DEV also changed them; each write
// is logged in the sync change set (ATTRIBUTE_VALUE_SET) with before/after.
async function copyChangedAttributeValues(source, target, { ideToken, token, gitUser, plan: _plan, untick = [], user } = {}) {
    const written = []
    const errors = []
    const { collectAttrsFiles } = require('./git-attrs')
    let repoUrl
    try { repoUrl = (await makeClient(target, ideToken).post('GitStatus', { Username: gitUser, Password: token }))?.URL ?? null } catch { repoUrl = null }
    if (!repoUrl) return { written, errors, note: 'attribute values not synced: no repository for the target' }
    const last = (() => { try { return cl.latestDeployTo(target) } catch { return null } })()
    const baseCommit = last?.attrs_commit ?? null
    if (!baseCommit) return { written, errors, note: 'attribute values not synced: no Last Deployed attributes recorded' }

    const prod = new TM1Client(target, makeClient(target, ideToken))
    const dev = new TM1Client(source, makeClient(source, ideToken))
    const liveFiles = await collectAttrsFiles(prod).catch(() => ({}))
    const live = docsFromFiles(liveFiles)
    const base = readAttrsAtCommit(repoUrl, baseCommit, { token, gitUser })
    const skip = new Set((untick ?? []).map(String))
    const changed = changedAttributeValues(base, live)
    for (const v of changed) {
        if (skip.has(`dimension:${v.dimension}`)) continue
        try {
            const attrType = (live[v.dimension]?.attributes ?? []).find(a => String(a.Name).toLowerCase() === String(v.attribute).toLowerCase())?.Type
            const type = /^num/i.test(String(attrType ?? '')) ? 'N' : 'S'
            const current = await dev.getElementAttributeValues(v.dimension, v.element).catch(() => ({}))
            if (String(current?.[v.attribute] ?? '') === String(v.after ?? '')) continue
            await dev.writeElementAttribute(v.dimension, v.element, v.attribute, v.after ?? '', type)
            cl.writeLog({
                server: source, action: 'ATTRIBUTE_VALUE_SET', objectType: 'attribute-value',
                objectName: `${v.dimension}:${v.element}:${v.attribute}`,
                detail: { dimension: v.dimension, hierarchy: v.dimension, element: v.element, attribute: v.attribute, before: current?.[v.attribute] ?? null, after: v.after ?? '' },
                user,
            })
            written.push({ dimension: v.dimension, element: v.element, attribute: v.attribute })
        } catch (e) { errors.push({ dimension: v.dimension, what: `value ${v.element}.${v.attribute}`, why: e.message }) }
    }
    return { written, errors }
}

// New chores on PROD are copied to DEV and switched OFF as they arrive. (Refresh
// updates existing ones; a chore only the target has needs creating.)
async function copyNewChores(dev, prod, plan, { untick = [], user } = {}) {
    const skip = new Set(untick ?? [])
    const copied = []
    const errors = []
    for (const c of plan.chores ?? []) {
        if (c.onDev || skip.has(choreKey(c))) continue
        try {
            const full = await prod.getChore(c.name)
            if (!full) continue
            await dev.createChore({
                Name: full.Name,
                StartTime: full.StartTime,
                Frequency: full.Frequency,
                ExecutionMode: full.ExecutionMode,
                Active: false,           // a chore on a dev server is an incident
                Tasks: full.Tasks ?? [],
            })
            cl.writeLog({ server: dev.server, action: 'CHORE_CREATED', objectType: 'chore', objectName: c.name, detail: `copied from PROD; switched OFF`, user })
            copied.push({ name: c.name, active: false })
        } catch (e) { errors.push({ type: 'chore', name: c.name, error: e.message }) }
    }
    return { copied, errors }
}

// ── Guard: no in-flight work ────────────────────────────────────────────────
// A sync writes PROD's changes INTO DEV (and takes PROD's value on a clash). With
// an open change set on DEV, that moves the ground under a developer mid-change:
// their expected numbers stop meaning what they did an hour ago, and the chain
// (DEV → TEST → PROD) no longer has a known starting point. So a sync is only
// allowed on a quiet DEV. Close or retire first.
function openChangeSets(server) {
    try {
        return require('./change-log').getSessions(server, 500)
            .filter(s => !s.closed_at && !s.wont_deploy_at && s.kind !== 'sync' && (s.entry_count ?? 0) > 0)
            .map(s => ({ id: s.id, name: s.name, user: s.user ?? null }))
    } catch { return [] }
}

async function syncDevFromProd(source, target, { ideToken, token = null, gitUser = null, by = null, untick = [], user = null, idleCheck = null, deps = {} } = {}) {
    const at = new Date().toISOString()
    const out = { ok: false, at, source, target, changeSet: null, idle: null, applied: [], skipped: [], errors: [], copiedNew: [] }

    const open = (deps.openChangeSets ?? openChangeSets)(source)
    if (open.length) {
        out.refused = true
        out.openChangeSets = open
        out.error = `Refused: ${source} has ${open.length} open change set${open.length === 1 ? '' : 's'} (${open.map(s => s.name).join(', ')}). Close or retire them first — a sync writes ${target}'s changes into ${source} and would move the data under in-flight work.`
        return out
    }

    const idle = idleCheck ?? ((server, opts) => require('./idle-check').idleCheck(server, opts))
    try {
        out.idle = { target: await idle(target, { ideToken }), source: await idle(source, { ideToken }) }
        const running = [...(out.idle.target?.running ?? []), ...(out.idle.source?.running ?? [])]
        if (running.length) {
            out.error = `Refused: work is running on ${running.map(r => r.name).join(', ')} — stop it before syncing.`
            return out
        }
    } catch (e) { out.idle = { error: e.message } }

    let plan
    try { plan = await planRefresh(source, target, { ideToken }) }
    catch (e) { out.error = `The sync plan failed: ${e.message}`; return out }
    out.plan = { dimensions: plan.dimensions?.length ?? 0, chores: plan.chores?.length ?? 0, subsets: plan.subsets?.length ?? 0, views: plan.views?.length ?? 0, hierarchies: plan.hierarchies?.length ?? 0 }

    const session = cl.startSession(`Sync DEV from ${target} ${at.slice(0, 10)}`, source, user ?? by ?? 'sync', 'sync')
    out.changeSet = { id: session.id, name: session.name, kind: 'sync' }

    const selection = syncSelection(plan, { untick })
    out.selection = { dimensions: selection.accept.map(a => a.dimension), chores: selection.chores.map(c => c.name), covers: selection.covers.length, hierarchies: selection.hierarchies.length }

    let applied
    try {
        applied = await applyRefresh(source, target, {
            ideToken, session: session.id, ...selection, user: user ?? by ?? 'sync',
        })
        out.applied = applied.applied ?? []
        out.skipped = applied.skipped ?? []
        out.errors = applied.errors ?? []
    } catch (e) {
        out.error = e.message
        out.refused = e.refused ?? false
        return out
    }

    // Attribute values PROD changed since its last deploy, default take PROD's.
    try {
        const av = await copyChangedAttributeValues(source, target, { ideToken, token, gitUser, plan, untick, user: user ?? by ?? 'sync' })
        out.attributeValues = av
        out.errors.push(...(av.errors ?? []).map(e => ({ dimension: e.dimension, what: e.what, why: e.why })))
    } catch (e) { out.errors.push({ dimension: 'attribute values', what: 'not copied', why: e.message }) }

    // A chore only PROD has: create it on DEV, switched off.
    try {
        const dev = new TM1Client(source, makeClient(source, ideToken))
        const prod = new TM1Client(target, makeClient(target, ideToken))
        const newChores = await copyNewChores(dev, prod, plan, { untick, user: user ?? by ?? 'sync' })
        out.copiedNew.push(...newChores.copied)
        out.errors.push(...newChores.errors.map(e => ({ dimension: `chore ${e.name}`, what: 'not created', why: e.error })))
    } catch (e) { out.errors.push({ dimension: 'chores', what: 'not created', why: e.message }) }

    if (out.errors.length) {
        // A failed write stops the sync. The change set is left open so the admin
        // can see and finish it; it is reported, never silently closed.
        out.error = `The sync stopped: ${out.errors.length} write${out.errors.length === 1 ? '' : 's'} failed. The change set is left open.`
        return out
    }

    // Every clash the admin did not untick has now taken PROD's value: tell the
    // developer whose change it replaced, on their change set.
    try {
        const taken = (plan.clashes ?? []).filter(c => !(untick ?? []).includes(c.key))
        out.developerNotes = notifyClashOwners(taken, { target, syncName: session.name })
    } catch (e) { out.developerNotes = []; out.errors.push({ dimension: 'developer notes', what: 'not written', why: e.message }) }

    // Close: DEV writes its own objects into `dev`, the IDE writes attrs-DEV.
    try {
        const finalized = await finalizeDevClose(source, session.id, { token, gitUser, ideToken, user: user ?? by })
        out.finalized = finalized
        await closeChangeSet(session.id, { user: user ?? by, tests: null, ideToken })
        out.closed = { id: session.id, commit: finalized?.commit ?? null, neverDeployed: true }
        out.ok = true
    } catch (e) {
        out.error = `The sync applied, but could not close DEV's change set: ${e.message}`
    }
    return out
}

module.exports = { syncDevFromProd, syncSelection, copyNewChores, copyChangedAttributeValues, notifyClashOwners, clashNote, openChangeSets, dimKey, coverKey, hierKey, choreKey }
