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
const { makeClient } = require('./adapter_registry')
const { lastDeployed } = require('./git-state')
const { git, authUrl, sanitize } = require('./git-repo')
const gitIdentity = require('./git-identity')
const cl = require('./change_log')
const { lintTI } = require('./ti-lint')
const { sameCommit } = require('./git-approvals')

const NO_BASE_ERROR = (target) => `${target} has no recorded deployed commit — set it up first (init + first pull), then release against it.`

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
    if (m) return { type: 'subset', name: m[3], parent: m[1] }
    m = f.match(/^dimensions\/([^/]+)\.hierarchies\/([^/]+)\.json$/)
    if (m) return { type: 'dimension', name: m[1], kind: 'dimension' }
    m = f.match(/^dimensions\/([^/]+)\.json$/)
    if (m) return { type: 'dimension', name: m[1], kind: 'dimension' }
    m = f.match(/^processes\/(.+)\.(json|ti)$/)
    if (m) return { type: 'process', name: m[1], kind: 'process' }
    m = f.match(/^cubes\/([^/]+)\.views\/([^/]+)\.json$/)
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
            const file = rest[rest.length - 1]      // renames: 'R100 old new' → new
            const verb = String(status)[0]           // A, M, D (R = rename → treat as add)
            return { status, action: verb === 'D' ? 'D' : 'A', file }
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

// Best-effort owner of an object: another change-log session (on the change set's
// server) whose log touched the same object. Null when unknown.
function ownerOf(logsBySession, obj) {
    for (const s of logsBySession) {
        for (const e of s.entries) {
            if (ENTRY_TO_OBJECT[e.object_type] && ENTRY_TO_OBJECT[e.object_type] === obj.type &&
                String(e.object_name).toLowerCase() === String(obj.name).toLowerCase()) {
                return { sessionName: s.name, user: s.user ?? null }
            }
        }
    }
    return null
}

// Build the release commit for one change set against the target's recorded base.
// Returns { ok, ... } — never throws past here.
async function buildRelease(changeSet, target, { token, gitUser = gitIdentity.user(), repoUrl, ideToken } = {}) {
    // Re-read the session so commit_ref / release fields are the live DB values.
    const session = changeSet?.id ? (cl.getSession(changeSet.id) ?? changeSet) : changeSet
    const base = lastDeployed(target)?.lastDeployedCommit
    if (!base) return { ok: false, refused: true, error: NO_BASE_ERROR(target) }
    const devCommit = session?.commit_ref
    if (!devCommit) return { ok: false, refused: true, error: `Change set "${session?.name ?? session?.id}" has not been pushed — commit it to the repo first.` }

    // Subsets and views cannot be released: the lab proved TM1 Git's pull plan has
    // no operation for them, so they never land on the target. Refuse loudly —
    // before touching the repo — rather than ship a release that silently drops them.
    const logEntries = session?.id ? cl.getSessionLog(session.id) : []
    const unsupported = (logEntries ?? []).find(e => e.object_type === 'subset' || e.object_type === 'view')
    if (unsupported) {
        return { ok: false, refused: true, error: `Subsets and views can't be released through TM1 Git yet — the pull doesn't apply them (this change set touches ${unsupported.object_type} "${unsupported.object_name}").` }
    }

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
        const otherLogs = (session?.server ? allSessions : [])
            .filter(s => s.id !== session?.id)
            .map(s => ({ name: s.name, user: s.user ?? null, entries: (() => { try { return cl.getSessionLog(s.id) } catch { return [] } })() }))

        const included = []
        const excluded = []
        for (const c of changed) {
            const obj = objectFromFile(c.file)
            if (!obj) { excluded.push({ type: 'other', name: c.file, files: [c.file] }); continue }
            if (csetObjectKeys.has(objectKey(obj.type, obj.name, obj.parent))) {
                included.push({ ...obj, file: c.file, action: c.action })
            } else {
                excluded.push({ ...obj, files: [c.file], file: c.file, owner: ownerOf(otherLogs, obj) })
            }
        }

        // Objects in the change set that produced no file change (e.g. only an attribute value).
        const noFile = []
        for (const e of logEntries) {
            const o = ENTRY_TO_OBJECT[e.object_type]
            if (!o) continue
            const parent = (e.object_type === 'subset' || e.object_type === 'view') ? e.detail : null
            const key = objectKey(o, e.object_name, parent)
            if (!included.some(i => objectKey(i.type, i.name, i.parent) === key)) noFile.push({ type: o, name: e.object_name, parent: parent ?? undefined })
        }

        // Nothing to ship?
        if (included.length === 0) {
            return { ok: false, refused: true, error: `Nothing from change set "${changeSet?.name ?? ''}" changed files between the base and the pushed commit — nothing to release.` }
        }

        // Apply: base + only this change set's files.
        git(work, 'checkout', '-q', base)
        for (const inc of included) {
            if (inc.action === 'D') git(work, 'rm', '--quiet', '--', inc.file)
            else git(work, 'checkout', devCommit, '--', inc.file)
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

        return {
            ok: true, target, base, devCommit, releaseCommit,
            changeSet: { id: changeSet?.id ?? null, name: changeSet?.name ?? null, server: changeSet?.server ?? null },
            included: included.map(i => ({ type: i.type, name: i.name, parent: i.parent, file: i.file, action: i.action })),
            excluded: excluded.map(x => ({ type: x.type, name: x.name, parent: x.parent, file: x.file, owner: x.owner ?? null })),
            noFile,
        }
    } catch (e) {
        return { ok: false, error: sanitize(e.message, token) }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

module.exports = { buildRelease, objectFromFile, parseNameStatus, ENTRY_TO_OBJECT, objectKey, NO_BASE_ERROR, changedObjects, checkDependencies, splitTi, verifyRelease }

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
                    const r = await c.get(`Cubes('${encodeURIComponent(obj.name)}')`, { $select: 'Rules' })
                    ok = String(r?.Rules ?? '') === String(releaseText ?? '').replace(/\r\n/g, '\n')
                } else {
                    const url = obj.type === 'subset' ? `Dimensions('${encodeURIComponent(obj.parent)}')/Hierarchies('${encodeURIComponent(obj.parent)}')/Subsets('${encodeURIComponent(obj.name)}')`
                        : obj.type === 'view'     ? `Cubes('${encodeURIComponent(obj.parent)}')/Views('${encodeURIComponent(obj.name)}')`
                        : obj.type === 'dimension' ? `Dimensions('${encodeURIComponent(obj.name)}')`
                        : obj.type === 'cube'     ? `Cubes('${encodeURIComponent(obj.name)}')`
                        : `Processes('${encodeURIComponent(obj.name)}')`
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
async function checkDependencies(releaseCommit, target, { token, gitUser = gitIdentity.user(), repoUrl, ideToken } = {}) {
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
        const c = makeClient(target, ideToken)
        for (const ch of changed) {
            const obj = objectFromFile(ch.file)
            if (!obj || ch.action === 'D') continue   // a deletion needs no dependency check
            const text = git(work, 'show', `${releaseCommit}:${ch.file}`)
            if (obj.kind === 'rules') {
                try {
                    const r = await c.post(`Cubes('${encodeURIComponent(obj.name)}')/tm1.CheckRules`, { Rules: text })
                    const errs = r?.value ?? []
                    if (errs.length) blockers.push({
                        object: `rules ${obj.name}`,
                        message: errs.map(e => `line ${e.LineNumber ?? '?'}: ${e.Message ?? e.Description ?? JSON.stringify(e)}`).join('; ') +
                            ' — if this reference belongs to another change set, ship that change set too (or build a combined release).',
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