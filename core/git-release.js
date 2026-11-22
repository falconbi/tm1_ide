'use strict'

// ── Change-set-scoped releases ───────────────────────────────────────────────
// A release is a hand-built commit on branch release-<target>: the TARGET's last
// deployed commit (the IDE-recorded one, never TM1's DeployedCommit) plus ONLY
// the files whose objects this change set touched. Deploying it ships exactly
// that change set — nothing else that happens to be on DEV rides along.
//
// The lab proved TM1 Git accepts such a commit: PROD's pull plan listed only the
// one object and skipped the rest. This builds that commit in a throwaway clone.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient } = require('./adapter-registry')
const { TM1Client } = require('./tm1-client')
const { lastDeployed } = require('./git-state')
const { git, authUrl, sanitize } = require('./git-repo')
const gitIdentity = require('./git-identity')
const cl = require('./change-log')
const { lintTI } = require('./ti-lint')
const { sameCommit } = require('./git-approvals')
const { odataKey } = require('./odata-key')

const NO_BASE_ERROR = (target) => `${target} has no recorded deployed commit — set it up first (init + first pull), then release against it.`
// Releases go one change set at a time, in dependency order.
const RELEASE_FIRST = (owner, target) => `Release "${owner}" to ${target} first, then rebuild this release.`

// Map a TM1-rest parseObjectFile 'object_type' (the change-log vocabulary) to the
// TM1 object the plan/tree refers to. rules→cube, attribute→dimension, etc.
const ENTRY_TO_OBJECT = {
    rules: 'cube', cube: 'cube',
    dimension: 'dimension', attribute: 'dimension',
    subset: 'subset', view: 'view',
    process: 'process', chore: 'chore',
}

// Map a repo file path to the top-level TM1 object it belongs to (the granularity
// both the change-log entries and the GitPull plan use). Mirrors the path rules
// in git-restore.js parseObjectFile, extended for cubes and dimension files.
function objectFromFile(file) {
    const f = String(file ?? '')
    let m
    m = f.match(/^dimensions\/([^/]+)\.hierarchies\/([^/]+)\.subsets\/([^/]+)\.json$/)
    if (m) return { type: 'subset', name: m[3], parent: m[1], hierarchy: m[2] }
    m = f.match(/^dimensions\/([^/]+)\.hierarchies\/([^/]+)\.json$/)
    if (m) return { type: 'dimension', name: m[1], kind: 'dimension' }
    m = f.match(/^dimensions\/([^/]+)\.json$/)
    if (m) return { type: 'dimension', name: m[1], kind: 'dimension' }
    m = f.match(/^processes\/(.+)\.(json|ti)$/)
    if (m) return { type: 'process', name: m[1], kind: 'process' }
    // A view is two files when it is MDX-driven: the definition and its .mdx text.
    // Both belong to the same view — mapping only the .json left an MDX-only change
    // invisible to the release and to the conflict check.
    m = f.match(/^cubes\/([^/]+)\.views\/([^/]+)\.(json|mdx)$/)
    if (m) return { type: 'view', name: m[2], parent: m[1] }
    m = f.match(/^cubes\/(.+)\.rules$/)
    if (m) return { type: 'cube', name: m[1], kind: 'rules' }
    m = f.match(/^cubes\/([^/]+)\.json$/)
    if (m) return { type: 'cube', name: m[1], kind: 'cube' }
    m = f.match(/^chores\/(.+)\.(json|ti)$/)
    if (m) return { type: 'chore', name: m[1], kind: 'chore' }
    return null
}

// Parse `git diff --name-status` output into [{ status, action, file }].
function parseNameStatus(text) {
    return String(text ?? '')
        .split('\n').filter(Boolean)
        .map(line => {
            const [status, ...rest] = line.split('\t')
            const verb = String(status)[0]
            // A rename is a delete of the old path plus an add of the new one.
            // Keeping oldFile lets the release remove what the base still has.
            if ((verb === 'R' || verb === 'C') && rest.length >= 2) {
                return { status, action: verb === 'R' ? 'R' : 'A', file: rest[1], oldFile: rest[0] }
            }
            return { status, action: verb === 'D' ? 'D' : 'A', file: rest[rest.length - 1] }
        })
}

// All changed files (and the objects they belong to) between two commits in the repo.
function changedFilesBetween(work, from, to) {
    return parseNameStatus(git(work, 'diff', '--name-status', from, to))
}

// Which OBJECTS (type ⦂ name, change-set granularity) each change-left-in-list is.
// Key an object for change-set matching / plan checking. Subsets belong to a
// DIMENSION and views to a CUBE — the parent is part of the identity, so a
// 'Default' subset on two dimensions is two different objects.
const objectKey = (type, name, parent) => {
    const n = String(name ?? '').toLowerCase()
    if (type === 'subset' || type === 'view') return `${type}::${String(parent ?? '').toLowerCase()}::${n}`
    return `${type}::${n}`
}

const subsetNameFromId = (el) => el?.Name ?? String(el?.['@id'] ?? '').match(/Elements\('([^']+)'\)/)?.[1] ?? null

// TM1 Git's pull plan names the parent object for a subset/view change. Allow
// that parent as well as the child's own key when verifying a release.
function expectedPlanKeys(objects) {
    const keys = new Set((objects ?? []).map(o => objectKey(o.type, o.name, o.parent)))
    for (const o of objects ?? []) {
        if (o.type === 'subset' && o.parent) keys.add(objectKey('dimension', o.parent))
        if (o.type === 'view' && o.parent) keys.add(objectKey('cube', o.parent))
    }
    return keys
}

// A view or subset that changed on the target AND is shipped by this release:
// TM1's pull does not touch those, but the IDE applies them over REST afterwards,
// and that REPLACES — so the target's version would be lost. Pure, so both the
// Review check and the final deploy guard use exactly the same rule.
function viewSubsetConflicts(nonBlockingEntries, releaseKeys) {
    return (nonBlockingEntries ?? []).filter(e => {
        const o = objectFromFile(e.file)
        return o?.type && releaseKeys?.has(objectKey(o.type, o.name, o.parent))
    })
}

// ── Deploy order on shared objects ──────────────────────────────────────────
// Two change sets that touch the same object must deploy in the order the changes
// were made. Order is judged by the change-log timestamp of each session's LAST
// change to that object — not by change-set number, not by close time, because a
// set can be closed long after the edit that matters.
//
// Two refusals:
//   older change, not deployed   → this release would ship a state that predates it
//                                  (the classic: created in 1001, deleted in 1002;
//                                   deploy 1002 first and 1001 puts it back)
//   newer change, already deployed → this release would undo work already on the
//                                  target
//
// Retired sets are ignored (they own nothing), and a set carried by a catch-up
// counts as deployed. A newer change that has not been deployed yet does not
// block: shipping the older one first preserves the order.
//
// Pure, so the rule can be tested without a repo: rows are
//   { label, mineAt, other: { id, name, at, deployed, covered, retired } }
function sharedObjectOrdering(rows, target) {
    const older = []
    const newer = []
    for (const r of rows ?? []) {
        if (!r?.other || r.other.retired) continue
        const at = r.other.at
        const mine = r.mineAt
        if (!at || !mine) continue
        const deployed = !!(r.other.deployed || r.other.covered)
        if (!deployed) {
            if (at < mine) older.push(r)
        } else if (at > mine) {
            newer.push(r)
        }
    }
    if (!older.length && !newer.length) return null

    const clock = (iso) => String(iso).slice(11, 16)
    const parts = []
    for (const r of older) {
        parts.push(`${r.label} was also changed in ${r.other.name} (${clock(r.other.at)}), which hasn't been deployed to ${target}. Deploy ${r.other.name} first, or retire it.`)
    }
    for (const r of newer) {
        parts.push(`${r.other.name} already deployed a newer change to ${r.label} (${clock(r.other.at)}). This release would undo it. Retire this change set, or redo the change on DEV.`)
    }
    return { older, newer, message: `Refused: ${parts.join(' ')}` }
}

// ── Link closure ─────────────────────────────────────────────────────────────
// TM1 Git stores cross-object references as `@Code.links` (an array) or
// `@Code.link` (one string). A released hierarchy without its linked subsets is
// a file TM1 cannot read ("Cannot open the file specified by link …"), so a
// release must carry every file those links name, and every file they link in
// turn. Paths are relative to the folder of the file that names them.
//
//   files — the file paths in the release tree
//   read  — read(file) returns that file's text or parsed object, or null
//
// Returns [{ file, neededBy }] for links missing from the release tree. Pure:
// no repo, no disk; the caller supplies read().
function linkClosure(files, read) {
    const present = new Set(files)
    const visited = new Set()
    const missing = []
    const queue = [...present]

    while (queue.length) {
        const file = queue.shift()
        if (visited.has(file)) continue
        visited.add(file)
        if (!/\.json$/i.test(file)) continue

        let body
        try { body = read(file) } catch { continue }
        if (body == null) continue
        let data = body
        if (typeof body === 'string') {
            try { data = JSON.parse(body) } catch { continue }
        }
        if (!data || typeof data !== 'object') continue

        for (const [key, value] of Object.entries(data)) {
            const many = key.endsWith('@Code.links')
            const one = key.endsWith('@Code.link')
            if (!many && !one) continue
            const links = many ? (Array.isArray(value) ? value : []) : [value]
            for (const link of links) {
                if (typeof link !== 'string' || !link) continue
                const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), link))
                if (present.has(target)) {
                    if (!visited.has(target)) queue.push(target)
                    continue
                }
                if (!missing.some(m => m.file === target && m.neededBy === file)) {
                    missing.push({ file: target, neededBy: file })
                }
            }
        }
    }
    return missing
}

// Best-effort owner of an object: another change-log session (on the change set's
// server) whose log touched the same object. A retired phantom set (or one
// already covered by a catch-up) owns nothing — it must never block a release.
function ownerOf(logsBySession, obj) {
    const wanted = objectKey(obj.type, obj.name, obj.parent)
    for (const s of logsBySession) {
        if (s.wont_deploy_at || s.covered_by) continue
        for (const e of s.entries) {
            const type = ENTRY_TO_OBJECT[e.object_type]
            if (!type) continue
            const parent = (e.object_type === 'subset' || e.object_type === 'view') ? e.detail : null
            if (objectKey(type, e.object_name, parent) === wanted) {
                return { sessionName: s.name, user: s.user ?? null }
            }
        }
    }
    return null
}

// Objects that exist on the target but not in the repo at `commit`. TM1 Git
// never deletes target-only objects, so a catch-up review names them. Control
// (`}`) objects are never repo objects — skip them. Best-effort: an unreadable
// target list is reported as empty, never a failed release.
async function targetOnlyObjects(target, work, commit, { ideToken } = {}) {
    const repoFiles = git(work, 'ls-tree', '-r', '--name-only', commit).split('\n').filter(Boolean)
    const repoKeys = new Set(repoFiles.map(f => String(f).toLowerCase()))
    const repoNames = { cube: new Set(), dimension: new Set(), process: new Set(), chore: new Set() }
    for (const file of repoFiles) {
        const obj = objectFromFile(file)
        if (obj && repoNames[obj.type]) repoNames[obj.type].add(String(obj.name).toLowerCase())
    }
    const c = makeClient(target, ideToken)
    const out = []
    for (const [type, url] of [['cube', 'Cubes'], ['dimension', 'Dimensions'], ['process', 'Processes'], ['chore', 'Chores']]) {
        try {
            const r = await c.get(url, { $select: 'Name' })
            for (const row of r?.value ?? []) {
                const name = row?.Name
                if (!name || String(name).startsWith('}')) continue
                if (!repoNames[type].has(String(name).toLowerCase())) out.push({ type, name })
            }
        } catch { /* target read is best-effort */ }
    }
    // Views and subsets are objects too; list them with their parent so the
    // reviewed delete step can name exactly what it removes.
    for (const cube of (await c.get('Cubes', { $select: 'Name' }).then(r => r?.value ?? []).catch(() => []))) {
        const name = cube?.Name
        if (!name || String(name).startsWith('}') || !repoNames.cube.has(String(name).toLowerCase())) continue
        try {
            const vs = await c.get(`Cubes('${odataKey(name)}')/Views`, { $select: 'Name' })
            for (const v of vs?.value ?? []) {
                if (!v?.Name) continue
                const file = `cubes/${name}.views/${v.Name}.json`.toLowerCase()
                if (!repoKeys.has(file)) out.push({ type: 'view', name: v.Name, parent: name })
            }
        } catch { /* best effort */ }
    }
    for (const dim of (await c.get('Dimensions', { $select: 'Name' }).then(r => r?.value ?? []).catch(() => []))) {
        const name = dim?.Name
        if (!name || String(name).startsWith('}') || !repoNames.dimension.has(String(name).toLowerCase())) continue
        try {
            const hs = await c.get(`Dimensions('${odataKey(name)}')/Hierarchies`, { $select: 'Name' })
            for (const h of hs?.value ?? []) {
                if (!h?.Name) continue
                try {
                    const ss = await c.get(`Dimensions('${odataKey(name)}')/Hierarchies('${odataKey(h.Name)}')/Subsets`, { $select: 'Name' })
                    for (const sub of ss?.value ?? []) {
                        if (!sub?.Name) continue
                        const file = `dimensions/${name}.hierarchies/${h.Name}.subsets/${sub.Name}.json`.toLowerCase()
                        if (!repoKeys.has(file)) out.push({ type: 'subset', name: sub.Name, parent: name, hierarchy: h.Name })
                    }
                } catch { /* no subsets */ }
            }
        } catch { /* best effort */ }
    }
    return out
}

// Build the release commit for one change set against the target's recorded base.
// Returns { ok, ... } — never throws past here.
async function buildRelease(changeSet, target, { token, gitUser = gitIdentity.user(), repoUrl, ideToken, addObjects = [], excludeObjects = [], by = null, catchUp = false } = {}) {
    // Re-read the session so commit_ref / release fields are the live DB values.
    const session = changeSet?.id ? (cl.getSession(changeSet.id) ?? changeSet) : changeSet
    const base = lastDeployed(target)?.lastDeployedCommit
    if (!base) return { ok: false, refused: true, error: NO_BASE_ERROR(target) }
    const devCommit = session?.commit_ref
    if (!devCommit) return { ok: false, refused: true, error: `Change set "${session?.name ?? session?.id}" has not been pushed — commit it to the repo first.` }

    const logEntries = session?.id ? cl.getSessionLog(session.id) : []
    const processRuns = logEntries.filter(e => e.object_type === 'process-run').length

    if (!repoUrl) {
        try {
            const st = await makeClient(target, ideToken).post('GitStatus', { Username: gitUser, Password: token })
            repoUrl = st?.URL
        } catch (e) { return { ok: false, error: sanitize(e.response?.data?.error?.message ?? e.message, token) } }
        if (!repoUrl) return { ok: false, refused: true, error: `${target} is not linked to a repo.` }
    }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1release-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')

        // The base is ALWAYS the target's recorded deployed commit. A branch tip
        // that already sits on that base is a release built but not yet deployed —
        // replacing it is normal (rebuild). Only refuse when the tip does NOT build
        // on the recorded base (it descends from a commit the target hasn't got).
        const relRef = `refs/remotes/origin/release-${target}`
        let existing = null
        try { existing = (git(work, 'rev-parse', '--verify', '--quiet', relRef).trim() || null) } catch { existing = null }
        if (existing && !sameCommit(existing, base)) {
            let parent = null
            try { parent = (git(work, 'rev-parse', '--verify', '--quiet', `${existing}^`).trim() || null) } catch { parent = null }
            if (!sameCommit(parent, base)) {
                return { ok: false, refused: true, error: `release-${target} has moved to ${existing}, which does not build on ${target}'s recorded commit (${base}) — someone else released or the target moved on. Investigate before rebuilding.` }
            }
        }

        const changed = changedFilesBetween(work, base, devCommit)
        const csetObjectKeys = new Set(logEntries
            .filter(e => ENTRY_TO_OBJECT[e.object_type])
            .map(e => objectKey(
                ENTRY_TO_OBJECT[e.object_type],
                e.object_name,
                (e.object_type === 'subset' || e.object_type === 'view') ? e.detail : null)))

        // Other sessions on the same server, for the "left on DEV" owners.
        const allSessions = cl.getAllSessions(500)
        const otherLogs = (session?.server ? allSessions.filter(s => s.server === session.server) : [])
            .filter(s => s.id !== session?.id)
            .map(s => ({ id: s.id, name: s.name, user: s.user ?? null, closed_at: s.closed_at ?? null, deployed_target: s.deployed_target ?? null, wont_deploy_at: s.wont_deploy_at ?? null, covered_by: s.covered_by ?? null, entries: (() => { try { return cl.getSessionLog(s.id) } catch { return [] } })() }))

        // A catch-up takes EVERY file that changed between the target's base and
        // DEV's pushed commit: no change-set filter, no ownership refusal. An
        // ordinary release takes only the files whose objects this set touched.
        const included = []
        const excluded = []
        if (catchUp) {
            for (const c of changed) {
                const obj = objectFromFile(c.file)
                included.push(obj
                    ? { ...obj, file: c.file, oldFile: c.oldFile, action: c.action }
                    : { type: 'other', name: c.file, file: c.file, oldFile: c.oldFile, action: c.action })
            }
        } else {
            for (const c of changed) {
                const obj = objectFromFile(c.file)
                if (!obj) { excluded.push({ type: 'other', name: c.file, files: [c.file] }); continue }
                if (csetObjectKeys.has(objectKey(obj.type, obj.name, obj.parent))) {
                    included.push({ ...obj, file: c.file, oldFile: c.oldFile, action: c.action })
                } else {
                    excluded.push({ ...obj, files: [c.file], file: c.file, owner: ownerOf(otherLogs, obj) })
                }
            }
        }

        // Objects in the change set that produced no file change (e.g. only an attribute value).
        const noFile = []
        if (!catchUp) {
            for (const e of logEntries) {
                const o = ENTRY_TO_OBJECT[e.object_type]
                if (!o) continue
                const parent = (e.object_type === 'subset' || e.object_type === 'view') ? e.detail : null
                const key = objectKey(o, e.object_name, parent)
                if (!included.some(i => objectKey(i.type, i.name, i.parent) === key)) noFile.push({ type: o, name: e.object_name, parent: parent ?? undefined })
            }
        }

        // Objects added from "Left on DEV" by the person building the release.
        // Validate here: the client is never trusted on ownership, and only an
        // unowned excluded item may be pulled into this release.
        const addedByUser = []
        if (!catchUp) {
            for (const a of addObjects) {
                const label = `${a.type} ${a.name}${a.parent ? ` (${a.parent})` : ''}`
                const hit = excluded.find(x => objectKey(x.type, x.name, x.parent) === objectKey(a.type, a.name, a.parent))
                if (!hit) return { ok: false, refused: true, error: `Cannot add ${label}: it is not an unowned "left on DEV" item in this release.` }
                if (hit.owner) return { ok: false, refused: true, error: `Cannot add ${label}: it belongs to change set "${hit.owner.sessionName}". ${RELEASE_FIRST(hit.owner.sessionName, target)}` }
                const file = hit.file ?? hit.files?.[0] ?? null
                if (!file) return { ok: false, refused: true, error: `Cannot add ${label}: the release has no file for it.` }
                included.push({ ...hit, file, action: hit.action ?? 'A' })
                addedByUser.push({ type: hit.type, name: hit.name, parent: hit.parent ?? null, file, by })
                excluded.splice(excluded.indexOf(hit), 1)
            }
        }

        // Objects the approver chose to keep the target's version of.
        // Review offers this when a view or subset changed on BOTH sides: the
        // release would otherwise replace the target's copy. Excluded here means
        // removed from this release entirely — not "applied last", gone — and
        // recorded, so it is never a silent decision.
        const excludedByUser = []
        if (!catchUp) {
            for (const x of excludeObjects) {
                const key = objectKey(x.type, x.name, x.parent)
                const i = included.findIndex(inc => objectKey(inc.type, inc.name, inc.parent) === key)
                const label = `${x.type} ${x.name}${x.parent ? ` (${x.parent})` : ''}`
                if (i < 0) {
                    return { ok: false, refused: true, error: `Cannot keep ${target}'s version of ${label}: it is not in this release.` }
                }
                const [gone] = included.splice(i, 1)
                excludedByUser.push({ type: gone.type, name: gone.name, parent: gone.parent ?? null, file: gone.file ?? null, reason: `kept ${target}'s version`, by })
            }
        }

        // A subset is stored inside its dimension's hierarchy file through
        // `Subsets@Code.links`. Creating or deleting one changes that file, so a
        // release that ships the subset must carry the hierarchy too — otherwise
        // the pull leaves the link stale (drift on the dimension), and a delete
        // cannot even be built, because closure refuses a base that still links a
        // subset DEV no longer has.
        // Declared here: the hierarchy carried with a subset is recorded as a
        // dependency, and the closure below adds more.
        const addedAsDependency = []
        if (!catchUp) {
            const dims = new Set(included.filter(i => i.type === 'subset' && i.parent).map(i => i.parent))
            for (const dim of dims) {
                for (const c of changed) {
                    const obj = objectFromFile(c.file)
                    if (!obj || obj.type !== 'dimension' || obj.name !== dim) continue
                    if (included.some(x => x.file === c.file)) continue
                    included.push({ ...obj, file: c.file, oldFile: c.oldFile, action: c.action })
                    addedAsDependency.push({
                        type: 'dimension', name: dim, parent: null, file: c.file,
                        neededBy: `subset in ${dim} (the hierarchy lists its subsets)`,
                    })
                }
            }
        }

        // Nothing to ship?
        if (included.length === 0) {
            return {
                ok: false, refused: true,
                error: catchUp
                    ? `Nothing differs between ${target}'s recorded commit and ${session?.server ?? 'the source'} — there is no catch-up to release.`
                    : `Nothing from change set "${changeSet?.name ?? ''}" changed files between the base and the pushed commit — nothing to release.`,
            }
        }

        // Apply: base + only this change set's files.
        git(work, 'checkout', '-q', base)
        for (const inc of included) {
            if (inc.action === 'D') git(work, 'rm', '--quiet', '--', inc.file)
            else {
                if (inc.action === 'R' && inc.oldFile) {
                    try { git(work, 'rm', '--quiet', '--', inc.oldFile) } catch { /* already gone in base */ }
                }
                git(work, 'checkout', devCommit, '--', inc.file)
                // An MDX view carries its expression in a sibling .mdx file — include
                // it so the release can apply (and verify) the actual MDX.
                if (inc.type === 'view' && /\.views\/.+\.json$/.test(inc.file)) {
                    const mdx = inc.file.replace(/\.json$/, '.mdx')
                    try { git(work, 'checkout', devCommit, '--', mdx) } catch { /* native view — no MDX */ }
                }
            }
        }

        // A release never ships a broken link. Run the closure on the whole
        // release tree (base + this change set), add unowned dependencies from
        // DEV, refuse an owned or missing one, and repeat until nothing new comes
        // in — links can be nested.
        const existsOnDev = (file) => {
            try { git(work, 'cat-file', '-e', `${devCommit}:${file}`); return true } catch { return false }
        }
        for (;;) {
            const releaseFiles = git(work, 'ls-files').split('\n').filter(Boolean)
            const missing = linkClosure(releaseFiles, (file) => {
                try { return fs.readFileSync(path.join(work, file), 'utf8') } catch { return null }
            })
            if (missing.length === 0) break
            let added = 0
            for (const m of missing) {
                if (!existsOnDev(m.file)) {
                    return { ok: false, refused: true, error: `${m.neededBy} links ${m.file}, which does not exist on DEV.` }
                }
                const obj = objectFromFile(m.file)
                const owner = obj ? ownerOf(otherLogs, obj) : null
                // A catch-up ships everything, so another set's ownership of a
                // linked file is not a refusal there; an ordinary release refuses.
                if (owner && !catchUp) {
                    return { ok: false, refused: true, error: `${m.neededBy} needs ${m.file}, which belongs to change set "${owner.sessionName}". ${RELEASE_FIRST(owner.sessionName, target)}` }
                }
                git(work, 'checkout', devCommit, '--', m.file)
                addedAsDependency.push({
                    type: obj?.type ?? 'file',
                    name: obj?.name ?? path.posix.basename(m.file),
                    parent: obj?.parent ?? null,
                    file: m.file,
                    neededBy: m.neededBy,
                })
                if (obj) {
                    const i = excluded.findIndex(x => objectKey(x.type, x.name, x.parent) === objectKey(obj.type, obj.name, obj.parent))
                    if (i >= 0) excluded.splice(i, 1)
                }
                added++
            }
            if (added === 0) break
        }
        // Keeping the target's version only holds if nothing else in the release
        // needs that object: the link closure above may have pulled it back in as a
        // dependency (a view needing the subset, say). Refuse rather than ship a
        // version the approver asked to leave alone.
        for (const x of excludedByUser) {
            if (!x.file) continue
            let differs = ''
            try { differs = git(work, 'diff', '--cached', '--name-only', base, '--', x.file).trim() } catch { differs = '' }
            if (differs) {
                return {
                    ok: false, refused: true,
                    error: `Cannot keep ${target}'s version of ${x.type} ${x.name}: another object in this release needs it. Remove that object from the release too, or ship this one.`,
                }
            }
        }

        // Order on shared objects. A release must not ship a version of an object
        // that is older than one already deployed, nor one that would be undone by
        // a later change waiting on DEV. Catch-ups ship everything and keep their
        // own rule.
        if (!catchUp) {
            const LOG_TYPES = {
                dimension: ['dimension', 'attribute'],
                cube: ['cube', 'rules'],
                process: ['process'],
                chore: ['chore'],
                subset: ['subset'],
                view: ['view'],
            }
            // One entry per OBJECT: a process is two files (.json + .ti), and an
            // MDX view is two as well — without this the same conflict is named twice.
            const seenObj = new Set()
            const objs = []
            for (const i of included) {
                if (!i?.type || !LOG_TYPES[i.type] || !i.name) continue
                const parent = (i.type === 'subset' || i.type === 'view') ? (i.parent ?? null) : null
                const key = objectKey(i.type, i.name, parent)
                if (seenObj.has(key)) continue
                seenObj.add(key)
                objs.push({ type: i.type, name: i.name, parent, logTypes: LOG_TYPES[i.type] })
            }

            let rows = []
            try {
                const items = []
                for (const o of objs) for (const lt of o.logTypes) items.push({ object_type: lt, object_name: o.name, detail: o.parent })
                const ordering = cl.getObjectOrdering(session.server, session.id, items)
                for (const o of objs) {
                    const relevant = ordering.filter(x => x.object_name === o.name && (x.detail ?? null) === o.parent)
                    const mineAt = relevant.map(x => x.mineAt).filter(Boolean).sort().pop() ?? session.closed_at ?? new Date().toISOString()
                    const bySession = new Map()
                    for (const r of relevant) {
                        for (const other of r.others) {
                            const at = bySession.get(other.session_id)
                            if (!at || other.at > at.at) bySession.set(other.session_id, { ...other, at: other.at })
                        }
                    }
                    for (const other of bySession.values()) {
                        rows.push({
                            label: `${o.type} ${o.name}`,
                            mineAt,
                            other: {
                                id: other.session_id, name: other.session_name ?? '(unnamed)', at: other.at,
                                deployed: !!other.deployed_target, covered: !!other.covered_by, retired: !!other.wont_deploy_at,
                            },
                        })
                    }
                }
            } catch (e) {
                // Fail closed: an ordering check that silently skipped would be the
                // exact bug it exists to prevent.
                return { ok: false, refused: true, error: `Refused: could not check the deploy order of these objects (${sanitize(e.message, token)}). Nothing was built.` }
            }

            const conflict = sharedObjectOrdering(rows, target)
            if (conflict) {
                return { ok: false, refused: true, error: conflict.message, ordering: { older: conflict.older.map(r => r.label), newer: conflict.newer.map(r => r.label) } }
            }
        }

        git(work, 'add', '-A')
        git(work, '-c', `user.name=${gitUser}`, '-c', `user.email=${gitIdentity.email()}`, 'commit', '-q', '-m', `Release ${changeSet?.name ?? 'change set'} → ${target}`)
        const releaseCommit = git(work, 'rev-parse', 'HEAD').trim()

        // Replace an undeployed release on the same base — force-with-lease so we
        // never clobber a branch that changed since our fetch.
        if (existing) {
            git(work, 'push', '-q', `--force-with-lease=refs/heads/release-${target}:${existing}`, 'origin', `HEAD:refs/heads/release-${target}`)
        } else {
            git(work, 'push', '-q', 'origin', `HEAD:refs/heads/release-${target}`)
        }

        // A catch-up preview: which of DEV's unreleased sets touched an object
        // this release carries. Closed sets become "covered" when the deploy
        // succeeds; open sets stay in play and are listed as partly shipped.
        let coveredSets = []
        let openSets = []
        let targetOnly = []
        if (catchUp) {
            const includedKeys = new Set(included
                .map(i => objectKey(i.type, i.name, i.parent))
                .filter(k => !k.startsWith('other::')))
            for (const s of otherLogs) {
                if (s.wont_deploy_at || s.covered_by || s.deployed_target) continue
                const touches = s.entries.some(e => {
                    const type = ENTRY_TO_OBJECT[e.object_type]
                    if (!type) return false
                    const parent = (e.object_type === 'subset' || e.object_type === 'view') ? e.detail : null
                    return includedKeys.has(objectKey(type, e.object_name, parent))
                })
                if (!touches) continue
                const item = { id: s.id, name: s.name, user: s.user ?? null, entries: s.entries.length, closed_at: s.closed_at ?? null }
                if (s.closed_at) coveredSets.push(item)
                else openSets.push(item)
            }
            try { targetOnly = await targetOnlyObjects(target, work, devCommit, { ideToken }) } catch { targetOnly = [] }
        }

        return {
            ok: true, target, base, devCommit, releaseCommit,
            changeSet: { id: changeSet?.id ?? null, name: changeSet?.name ?? null, server: changeSet?.server ?? null },
            included: included.map(i => ({ type: i.type, name: i.name, parent: i.parent, file: i.file, action: i.action })),
            excluded: excluded.map(x => ({ type: x.type, name: x.name, parent: x.parent, file: x.file, owner: x.owner ?? null })),
            addedByUser,
            addedAsDependency,
            excludedByUser,
            runs: processRuns,
            noFile,
            ...(catchUp ? { catchUp: true, coveredSets, openSets, targetOnly } : {}),
        }
    } catch (e) {
        return { ok: false, error: sanitize(e.message, token) }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

module.exports = { buildRelease, objectFromFile, viewSubsetConflicts, sharedObjectOrdering, parseNameStatus, ENTRY_TO_OBJECT, objectKey, expectedPlanKeys, ownerOf, NO_BASE_ERROR, changedObjects, checkDependencies, splitTi, verifyRelease, applyReleaseComplement, linkClosure }

// TM1 Git's pull plan has no operation for subsets or views, so a release pull
// never applies them. After the pull, apply every included subset and view to the
// target over REST from the release commit's files — MDX subsets keep their
// expression, static subsets their element list, views as MDX or native.
async function applyReleaseComplement(target, { base, releaseCommit, repoUrl, token, gitUser = gitIdentity.user(), ideToken } = {}) {
    if (!repoUrl || !base || !releaseCommit) return { applied: [], errors: [] }
    const { applySubset, applyView } = require('./git-restore')
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1apply-'))
    const applied = []
    const errors = []
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        const changed = changedFilesBetween(work, base, releaseCommit)
        const tm1 = new TM1Client(target, makeClient(target, ideToken))
        for (const ch of changed) {
            if (ch.action === 'D') continue
            const obj = objectFromFile(ch.file)
            if (!obj || (obj.type !== 'subset' && obj.type !== 'view')) continue
            const content = git(work, 'show', `${releaseCommit}:${ch.file}`)
            try {
                if (obj.type === 'subset') applied.push(await applySubset(tm1, { dim: obj.parent, hierarchy: obj.hierarchy ?? obj.parent, name: obj.name }, content))
                else {
                    let vmdx = null
                    try { vmdx = git(work, 'show', `${releaseCommit}:${ch.file.replace(/\.json$/, '.mdx')}`) } catch { /* no MDX sibling */ }
                    applied.push(await applyView(tm1, { cube: obj.parent, name: obj.name, mdx: vmdx }, content))
                }
            } catch (e) {
                errors.push({ type: obj.type, name: obj.name, error: e.message })
            }
        }
        return { applied, errors }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

// After a deploy has pulled a release, check that every included object actually
// landed on the target with the release's content. rules are compared exactly
// (the pulled text vs the release's file); other objects by existence. Returns the
// list of objects that did not land — so a deploy is never reported as clean when
// TM1 Git silently skipped something.
async function verifyRelease(target, { base, releaseCommit, repoUrl, token, gitUser = gitIdentity.user(), ideToken } = {}) {
    if (!repoUrl || !base || !releaseCommit) return []
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1verify-'))
    const incomplete = []
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        const changed = changedFilesBetween(work, base, releaseCommit)
        const c = makeClient(target, ideToken)
        for (const ch of changed) {
            if (ch.action === 'D') continue      // a deletion removes — nothing to verify
            const obj = objectFromFile(ch.file)
            if (!obj) continue
            let ok = false
            try {
                if (obj.kind === 'rules') {
                    const releaseText = git(work, 'show', `${releaseCommit}:${ch.file}`)
                    const r = await c.get(`Cubes('${odataKey(obj.name)}')`, { $select: 'Rules' })
                    ok = String(r?.Rules ?? '') === String(releaseText ?? '').replace(/\r\n/g, '\n')
                } else if (obj.type === 'subset') {
                    const sub = JSON.parse(git(work, 'show', `${releaseCommit}:${ch.file}`))
                    const path = `Dimensions('${odataKey(obj.parent)}')/Hierarchies('${odataKey(obj.hierarchy ?? obj.parent)}')/Subsets('${odataKey(obj.name)}')`
                    if (sub.Expression) {
                        const t = await c.get(path, { $select: 'Expression' })
                        ok = String(t?.Expression ?? '') === String(sub.Expression)
                    } else {
                        const want = (sub.Elements ?? []).map(el => el?.Name ?? subsetNameFromId(el)).filter(Boolean)
                        const els = (await c.get(`${path}/Elements`, { $select: 'Name' })).value ?? []
                        ok = want.length === els.length && want.every(n => els.some(e => String(e.Name) === n))
                    }
                } else if (obj.type === 'view') {
                    const view = JSON.parse(git(work, 'show', `${releaseCommit}:${ch.file}`))
                    const vpath = `Cubes('${odataKey(obj.parent)}')/Views('${odataKey(obj.name)}')`
                    if (view['@type'] === 'MDXView' || view['MDX@Code.link']) {
                        let want = view.MDX ?? null
                        if (want === null) { try { want = git(work, 'show', `${releaseCommit}:${ch.file.replace(/\.json$/, '.mdx')}`) } catch { want = null } }
                        if (want === null) { ok = false }
                        else {
                            const t = await c.get(vpath, { $select: 'MDX' })
                            ok = String(t?.MDX ?? '').trim() === String(want).trim().replace(/\n$/, '')
                        }
                    } else {
                        await c.get(vpath, { $select: 'Name' })
                        ok = true
                    }
                } else {
                    const url = obj.type === 'dimension' ? `Dimensions('${odataKey(obj.name)}')`
                        : obj.type === 'cube' ? `Cubes('${odataKey(obj.name)}')`
                        : obj.type === 'chore' ? `Chores('${odataKey(obj.name)}')`
                        : `Processes('${odataKey(obj.name)}')`
                    await c.get(url, { $select: 'Name' })
                    ok = true
                }
            } catch { ok = false }
            if (!ok) incomplete.push(`${obj.type} ${obj.name}${obj.parent ? ` (${obj.parent})` : ''}`)
        }
        return incomplete
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

// Split a TM1 Git .ti file into its four section bodies (for TI lint).
function splitTi(text) {
    const grab = (key) => {
        const m = String(text ?? '').match(new RegExp(`#region\\s+${key}\\s*\\r?\\n([\\s\\S]*?)#endregion`, 'i'))
        return m ? m[1].replace(/\r/g, '').trimEnd() : ''
    }
    if (!/#region\s+Prolog/i.test(String(text ?? ''))) return null
    return { prolog: grab('Prolog'), metadata: grab('Metadata'), data: grab('Data'), epilog: grab('Epilog') }
}

// Dependency check BEFORE approval: run TM1 CheckRules on the target for every
// included rule (a wrong reference can mean it belongs to another change set),
// and TI lint for every included process. Blocks on any failure.
async function checkDependencies(releaseCommit, target, { token, gitUser = gitIdentity.user(), repoUrl, ideToken, catchUp = false } = {}) {
    if (!repoUrl) {
        try { repoUrl = (await makeClient(target, ideToken).post('GitStatus', { Username: gitUser, Password: token }))?.URL } catch { /* below */ }
    }
    const base = lastDeployed(target)?.lastDeployedCommit
    if (!repoUrl || !base) return { ok: false, error: 'cannot read the release from the repo (need a repo URL and a recorded base)' }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1release-'))
    const blockers = []
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        const changed = changedFilesBetween(work, base, releaseCommit)

        // A release built before the link closure existed can still be missing a
        // linked file. Catch it here, before approval, instead of at the pull plan.
        const releaseFiles = git(work, 'ls-tree', '-r', '--name-only', releaseCommit).split('\n').filter(Boolean)
        for (const m of linkClosure(releaseFiles, (file) => {
            try { return git(work, 'show', `${releaseCommit}:${file}`) } catch { return null }
        })) {
            blockers.push({ object: m.neededBy, message: `${m.neededBy} needs ${m.file}, which is not in the release.` })
        }

        // A catch-up creates the target's objects as part of the pull; checking
        // rules against the old target would fail on cubes/elements it is about
        // to add. The link closure above is the only pre-deploy dependency check.
        if (catchUp) return { ok: blockers.length === 0, blockers }

        const c = makeClient(target, ideToken)
        for (const ch of changed) {
            const obj = objectFromFile(ch.file)
            if (!obj || ch.action === 'D') continue   // a deletion needs no dependency check
            const text = git(work, 'show', `${releaseCommit}:${ch.file}`)
            if (obj.kind === 'rules') {
                try {
                    const r = await c.post(`Cubes('${odataKey(obj.name)}')/tm1.CheckRules`, { Rules: text })
                    const errs = r?.value ?? []
                    if (errs.length) blockers.push({
                        object: `rules ${obj.name}`,
                        message: errs.map(e => `line ${e.LineNumber ?? '?'}: ${e.Message ?? e.Description ?? JSON.stringify(e)}`).join('; ') +
                            ` — if this reference belongs to another change set, release that change set to ${target} first, then rebuild this release.`,
                    })
                } catch (e) { blockers.push({ object: `rules ${obj.name}`, message: `CheckRules could not run on ${target}: ${e.response?.data?.error?.message ?? e.message}` }) }
            } else if (obj.kind === 'process') {
                const sections = splitTi(text)
                if (sections) {
                    const r = lintTI(sections)
                    if ((r.errors ?? []).length) blockers.push({ object: `process ${obj.name}`, message: (r.errors ?? []).map(e => e.message ?? JSON.stringify(e)).join('; ') })
                }
            }
        }
        return { ok: blockers.length === 0, blockers }
    } catch (e) {
        return { ok: false, error: sanitize(e.message, token) }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

// The objects changed between two commits in the repo (used to check a pull plan
// against the release's included list). Returns [{ type, name, file, action }].
async function changedObjects({ from, to, repoUrl, token, gitUser = gitIdentity.user() }) {
    if (!repoUrl || !from || !to) return []
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1release-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        return changedFilesBetween(work, from, to)
            .map(c => ({ ...objectFromFile(c.file), file: c.file, action: c.action }))
            .filter(o => o.type)
    } catch {
        return []
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}