'use strict'

// ── Pre-deploy check (Part D) ───────────────────────────────────────────────
// Runs first in every deploy. It WRITES NOTHING to the target or to DEV: the
// target writes its own objects into Git (`live-<target>`), the IDE writes its
// attributes into `attrs-<target>`, and the two snapshots are compared with what
// the target last received. The result is a sorted list a person can act on:
//
//   rule or process changed on the target   → STOP; offer the carry-back
//   cube STRUCTURE changed on the target    → STOP; the developer makes the
//                                              change on DEV in a new change set
//   elements/parents/hierarchies/attributes/
//   subsets/views/chores changed            → kept in the release; DEV is behind
//                                              (the sync copies them)
//
// The classification is pure (except for the Git/TM1 reads around it), so the
// rules are tested without a server. The orchestrator is injectable for the same
// reason.

const { makeClient } = require('./adapter-registry')
const { TM1Client } = require('./tm1-client')

const RULE_PROCESS = 'rule-process'
const CUBE = 'cube'
const DIMENSION = 'dimension'
const SUBSET = 'subset'
const VIEW = 'view'
const CHORE = 'chore'
const ATTRIBUTE = 'attribute'
const OTHER = 'other'

// Which kind of model object a changed Git file is. Paths are TM1 Git's own.
function fileKind(file) {
    const f = String(file ?? '')
    if (/^attributes\//.test(f)) return 'attribute'
    if (/^processes\//.test(f) || /^cubes\/[^/]+\.rules$/.test(f)) return RULE_PROCESS
    if (/^cubes\/[^/]+\.json$/.test(f)) return CUBE
    if (/^chores\//.test(f)) return CHORE
    if (/^dimensions\/[^/]+\.hierarchies\/[^/]+\.subsets\//.test(f)) return SUBSET
    if (/^cubes\/[^/]+\.views\//.test(f)) return VIEW
    if (/^dimensions\/[^/]+\.hierarchies\/[^/]+\.json$/.test(f)) return DIMENSION
    if (/^dimensions\/[^/]+\.json$/.test(f)) return DIMENSION
    return OTHER
}

// The file's object name (dimension/cube/process/chore/subset), for a readable
// message. A dimension's files all start with `dimensions/<dim>.hierarchies/`, so
// the dimension name is what precedes that marker — not the whole first path
// segment (which reads as "WFP Employee.hierarchies"). A subset's own name is the
// last segment before `.json`.
function fileObject(file) {
    const f = String(file ?? '')
    let m
    if ((m = f.match(/^attributes\/([^/]+)\.json$/i))) return m[1]
    if ((m = f.match(/^dimensions\/(.+?)\.hierarchies\/[^/]+\.subsets\/([^/]+)\.json$/i))) return m[2]
    if ((m = f.match(/^dimensions\/(.+?)\.hierarchies\//i))) return m[1]
    if ((m = f.match(/^dimensions\/([^/]+?)(?:\.json)?$/i))) return m[1]
    if ((m = f.match(/^cubes\/([^/]+?)(?:\.hierarchies)?\.(?:json|rules|views)/))) return m[1]
    if ((m = f.match(/^processes\/(.+)\.(?:json|ti)$/))) return m[1]
    if ((m = f.match(/^chores\/(.+)\.(?:json|ti)$/))) return m[1]
    return f
}

// Sort drift entries into what stops a deploy and what the release/sync keeps.
// `entries` are { status, file, kind? } from the drift check; a cube whose only
// difference is its view list is the view family (the drift check already marks
// it `kind: 'cube-views'`).
function classifyDrift(entries = []) {
    const stops = []
    const carryBack = []
    const kept = []
    const sync = []
    for (const e of entries ?? []) {
        const kind = e?.kind === 'cube-views' ? VIEW : fileKind(e?.file)
        const row = {
            file: e?.file ?? null,
            status: e?.status ?? null,
            object: fileObject(e?.file),
            kind,
            summary: e?.summary ?? null,
            devMissing: e?.devMissing ?? null,
        }
        if (kind === RULE_PROCESS) {
            row.reason = 'rule or process changed on the target — the deploy stops; bring it onto DEV first'
            carryBack.push(row)
            stops.push(row)
        } else if (kind === CUBE) {
            row.reason = 'cube structure changed on the target — the developer makes the change on DEV in a new change set, then deploys it first'
            stops.push(row)
        } else if (kind === DIMENSION || kind === SUBSET || kind === VIEW || kind === CHORE || kind === ATTRIBUTE) {
            row.reason = kind === CHORE
                ? 'chore schedule changed on the target — kept in the release; the sync copies it to DEV with the chore off'
                : 'changed on the target — kept in the release; DEV is behind, run the sync'
            kept.push(row)
            sync.push(row)
        } else {
            row.reason = 'unclassified change on the target — the deploy stops until someone looks at it'
            stops.push(row)
        }
    }
    return { stops, carryBack, kept, sync }
}

// A short message naming what stops this check, or null when nothing does.
function stopMessage(stops = []) {
    if (!stops.length) return null
    const names = stops.map(s => `${s.object} (${s.kind})`).join(', ')
    return `The pre-deploy check stopped: ${names}. Nothing was written to the target or DEV.`
}

function runningWork(idle) {
    return (idle?.running ?? []).length > 0
}

// Read the target's live state into Git and attributes into the attributes
// branch, then classify. Injectable dependencies keep it testable; in production
// they are the real drift check and attribute writer.
async function preDeployCheck(target, {
    source = null, session = null, token, gitUser, ideToken, client = null,
    windowMinutes = 30, ownAccount = null,
    deps = {},
} = {}) {
    const at = new Date().toISOString()
    const out = { at, target, source, session: session ?? null, ok: false, idle: null, stops: [], carryBack: [], kept: [], sync: [], attrs: null }

    const idle = deps.idleCheck ?? ((server, opts) => require('./idle-check').idleCheck(server, opts))
    try { out.idle = { target: await idle(target, { ideToken, windowMinutes, ownAccount }) } }
    catch (e) { out.idle = { target: { error: e.message } } }
    if (source) {
        try { out.idle.source = await idle(source, { ideToken, windowMinutes, ownAccount }) }
        catch (e) { out.idle.source = { error: e.message } }
    }
    if (runningWork(out.idle.target) || runningWork(out.idle.source)) {
        const where = [runningWork(out.idle.target) ? target : null, runningWork(out.idle.source) ? source : null].filter(Boolean)
        out.stops.push({ kind: 'idle', object: where.join(', '), reason: `work is running on ${where.join(' and ')} — stop it before deploying` })
    }

    // 2 — the target writes its own objects into live-<target>; the IDE writes
    // its attributes. Both are snapshots, not changes to the model.
    let repoUrl
    try {
        const c = client ?? makeClient(target, ideToken)
        const st = await c.post('GitStatus', { Username: gitUser, Password: token })
        repoUrl = st?.URL ?? null
    } catch (e) {
        out.error = `Could not read ${target}'s Git link: ${e.message}`
        out.ok = false
        return out
    }
    if (!repoUrl) { out.error = `${target} is not linked to a repository.`; return out }

    const drift = deps.driftCheck ?? ((server, opts) => require('./git-drift').driftCheck(server, opts))
    let d
    try { d = await drift(target, { token, gitUser, ideToken }) }
    catch (e) { out.error = `The live snapshot failed: ${e.message}`; return out }
    if (d?.error) { out.error = d.error; return out }
    // The date of the deploy whose commit this is compared against, so the screen
    // can say "since the deploy on 26 Nov 11:42 (4f2a9c1)" instead of "since the
    // last deploy" — two different things when a deploy was rolled back.
    let deployedAt = null
    try { deployedAt = (deps.latestDeployTo ?? require('./change-log').latestDeployTo)(target)?.deployed_at ?? null } catch { /* none */ }
    out.live = { deployed: d.deployed ?? null, deployedAt, branch: d.liveBranch ?? `live-${target}` }
    out.diff = d.entries ?? []

    // Attributes: write the live branch and keep its commit for the release.
    try {
        const collect = deps.collectAttrsFiles ?? require('./git-attrs').collectAttrsFiles
        const write = deps.writeAttrsBranch ?? require('./git-attrs').writeAttrsBranch
        const tc = new TM1Client(target, client ?? makeClient(target, ideToken))
        const files = await collect(tc)
        const w = await write(target, { repoUrl, token, gitUser, files, message: `Live attributes of ${target}` })
        out.attrs = { branch: w?.branch ?? null, commit: w?.commit ?? null, changed: !!w?.changed, error: w?.ok === false ? w.error : null }
    } catch (e) {
        out.attrs = { error: e.message }
    }

    // Attributes are not in TM1 Git's live branch — the IDE wrote attrs-<target>.
    // Compare it with the attributes recorded on the last deploy, so a definition
    // or a value changed on the target is named and offered to the sync (Part D.3).
    // Attribute changes are kept, never a stop: the release uses the target's own
    // live attributes and the change set's recorded values.
    try {
        const commit = out.attrs?.commit
        const latest = deps.latestDeployTo ?? ((s) => require('./change-log').latestDeployTo(s))
        const last = commit ? latest(target) : null
        const baseCommit = last && ['complete', 'incomplete', 'reverted'].includes(String(last.status))
            ? (last.attrs_commit ?? null)
            : null
        if (commit && baseCommit) {
            const read = deps.readAttrsAtCommit ?? require('./close-check').readAttrsAtCommit
            const live = read(repoUrl, commit, { token, gitUser }) ?? {}
            const base = read(repoUrl, baseCommit, { token, gitUser }) ?? {}
            const canon = (doc) => JSON.stringify({ attributes: doc?.attributes ?? [], elements: doc?.elements ?? [] })
            for (const dim of new Set([...Object.keys(live), ...Object.keys(base)])) {
                if (canon(live[dim]) !== canon(base[dim])) {
                    out.diff.push({ status: 'M', file: `attributes/${dim}.json`, kind: 'attribute', object: dim })
                }
            }
        }
    } catch (e) {
        out.attrs = { ...(out.attrs ?? {}), compareError: e.message }
    }

    // What does DEV actually lack? Only the changed objects are read, not the whole
    // model: compare each drifted dimension/subset with DEV. This turns "PROD
    // changed this" into "PROD has these, DEV does not".
    if (source && out.diff.length) {
        try {
            const dev = deps.sourceClient ?? new TM1Client(source, makeClient(source, ideToken))
            for (const e of out.diff) {
                const file = String(e.file ?? '')
                const sub = file.match(/^dimensions\/(.+?)\.hierarchies\/(.+?)\.subsets\/(.+)\.json$/i)
                const hier = file.match(/^dimensions\/(.+?)\.hierarchies\/(.+?)\.json$/i)
                if (sub) {
                    const [, dim, h, name] = sub
                    const devSub = await dev.getSubsetElements(dim, name, h).catch(() => null)
                    e.devMissing = devSub
                        ? { kind: 'subset', missing: false, members: (e.prodMembers ?? []).filter(n => !new Set(devSub.map(x => x.name)).has(n)) }
                        : { kind: 'subset', missing: true }
                    delete e.prodMembers
                } else if (hier && e.prodAdded) {
                    const [, dim, h] = hier
                    const [els, eds] = await Promise.all([
                        dev.getElements(dim, h).catch(() => []),
                        dev.getEdges(dim, h).catch(() => []),
                    ])
                    const haveEls = new Set((els ?? []).map(x => x.Name ?? x.name))
                    const haveEdges = new Set((eds ?? []).map(x => `${x.ParentName ?? x.parent}::${x.ComponentName ?? x.child}`))
                    e.devMissing = {
                        kind: 'dimension',
                        elements: (e.prodAdded.elements ?? []).filter(n => !haveEls.has(n)),
                        edges: (e.prodAdded.edges ?? []).filter(k => !haveEdges.has(k)),
                    }
                    delete e.prodAdded
                }
            }
        } catch (e) {
            out.devCompareError = e.message
        }
    }

    const c = classifyDrift(out.diff)
    out.stops.push(...c.stops)
    out.carryBack = c.carryBack
    out.kept = c.kept
    out.sync = c.sync

    // Part D.5 — DEV deleted an attribute, dimension or cube that a process on
    // the TARGET still uses. The close check looks at DEV's processes; a
    // PROD-only process is only visible here, before the deploy would break it.
    if (session) {
        try {
            const cl = require('./change-log')
            const recordedChanges = deps.recordedChanges ?? require('./recorded-changes').recordedChanges
            const scanDeletedUsage = deps.scanDeletedUsage ?? require('./close-check').scanDeletedUsage
            const records = recordedChanges(deps.sessionLog ? deps.sessionLog(session) : cl.getSessionLogVerbose(session))
            const deleted = {
                dimensions: (records.deletes ?? []).filter(d => d.type === 'dimension').map(d => d.name),
                cubes: (records.deletes ?? []).filter(d => d.type === 'cube').map(d => d.name),
                attributes: [],
            }
            for (const [dim, rec] of records.dimensions ?? []) {
                for (const a of rec.attrDefs ?? []) if (a.action === 'delete') deleted.attributes.push({ dim, name: a.name })
            }
            if (deleted.dimensions.length || deleted.cubes.length || deleted.attributes.length) {
                const tc = new TM1Client(target, client ?? makeClient(target, ideToken))
                const used = await scanDeletedUsage(tc, deleted)
                out.deletedUsage = used
                for (const u of used) {
                    out.stops.push({
                        kind: 'deleted-usage',
                        object: u.process,
                        reason: `${u.process} on ${target} ${u.what}, which this change set deletes on DEV — fix it in a new change set and deploy that first`,
                    })
                }
            }
        } catch (e) {
            // A scan that could not run is reported, never silently "nothing found".
            out.deletedUsageError = e.message
        }
    }

    out.ok = out.stops.length === 0
    out.message = stopMessage(out.stops)
    return out
}

module.exports = { fileKind, fileObject, classifyDrift, stopMessage, preDeployCheck }
