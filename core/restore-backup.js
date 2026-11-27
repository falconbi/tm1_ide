'use strict'

// ── Restore a target from the backup taken before a deploy (Part J) ─────────
// "Return to last release" is gone: it put only Git objects back, lost any data
// the deploy wrote, and took no backup. Recovery is now:
//
//   1. the admin restores the data folder from the backup (outside the IDE)
//   2. "PROD restored from backup", choosing the backup by name
//   3. this moves release-<target>, the deploy note and attrs-<target> back to
//      the tag that backup created; marks the bad deploy `reverted`; the change
//      set goes back to "waiting for PROD"
//   4. TM1 on the target writes its own objects into Git and the IDE writes its
//      attributes; they should match the tag. If not (wrong backup), warn and
//      name the differences. Nothing is deleted from Git.
//
// The tags were made by the deploy (core/deploy-backup, Part I.4):
//   backup-<file name>        on the release commit the target held before it
//   backup-attrs-<file name>  on the matching attributes commit

const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient } = require('./adapter-registry')
const { git, authUrl, sanitize } = require('./git-repo')
const gitIdentity = require('./git-identity')
const { attrsBranch } = require('./git-attrs')

function workClone(repoUrl, { token, gitUser }) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1restoreb-'))
    git(work, 'init', '-q')
    git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token ?? ''))
    git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*')
    return work
}

function resolveTag(repoUrl, tag, { token, gitUser } = {}) {
    const work = workClone(repoUrl, { token, gitUser })
    try {
        return git(work, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`).trim() || null
    } catch { return null }
    finally { fs.rmSync(work, { recursive: true, force: true }) }
}

// Move a branch to a commit (force-with-lease, never blind) and return the branch.
function moveBranch(repoUrl, branch, commit, { token, gitUser } = {}) {
    if (!commit) return { ok: false, error: 'no commit to move to' }
    const work = workClone(repoUrl, { token, gitUser })
    try {
        let existing = null
        try { existing = git(work, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`).trim() || null } catch { existing = null }
        if (existing) {
            git(work, 'push', '-q', `--force-with-lease=refs/heads/${branch}:${existing}`, 'origin', `${commit}:refs/heads/${branch}`)
        } else {
            git(work, 'push', '-q', 'origin', `${commit}:refs/heads/${branch}`)
        }
        return { ok: true, branch, commit, previous: existing }
    } catch (e) {
        return { ok: false, branch, error: sanitize(e.message, token) }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

// Files that differ between two commits in the repo. Empty means they match.
function diffCommits(repoUrl, from, to, { token, gitUser } = {}) {
    if (!from || !to) return []
    const work = workClone(repoUrl, { token, gitUser })
    try {
        return git(work, 'diff', '--name-status', from, to).split('\n').filter(Boolean)
    } catch { return [] }
    finally { fs.rmSync(work, { recursive: true, force: true }) }
}

async function restoreFromBackup(target, {
    backupName, token, gitUser = gitIdentity.user(), ideToken, by: _by = null, client = null, deps = {},
} = {}) {
    const out = { target, ok: false, backupName: backupName ?? null, warnings: [], differences: [] }
    if (!String(backupName ?? '').trim()) {
        out.error = 'Choose the backup by name — e.g. PROD_2026-11-27_1000.zip (the file the deploy recorded).'
        return out
    }
    const tag = `backup-${backupName}`
    const attrsTag = `backup-attrs-${backupName}`

    const resolve = deps.resolveTag ?? resolveTag
    const move = deps.moveBranch ?? moveBranch
    const diff = deps.diffCommits ?? diffCommits
    const record = deps.recordDeploy ?? ((server, commit, summary, opts) => require('./git-state').recordDeploy(server, commit, summary, opts))
    const latestDeployTo = deps.latestDeployTo ?? ((server) => require('./change-log').latestDeployTo(server))
    const setStatus = deps.setDeployStatus ?? ((sessionId, t, status, reason) => require('./change-log').setSessionDeployStatus(sessionId, t, status, reason))

    let repoUrl
    try {
        const c = deps.client ?? client ?? makeClient(target, ideToken)
        repoUrl = (await c.post('GitStatus', { Username: gitUser, Password: token }))?.URL ?? null
    } catch (e) {
        out.error = `Could not read ${target}'s Git link: ${e.message}`
        return out
    }
    if (!repoUrl) { out.error = `${target} is not linked to a repository.`; return out }

    const commit = resolve(repoUrl, tag, { token, gitUser })
    if (!commit) {
        out.error = `No restore tag "${tag}" in the repository. The backup can only be restored if the deploy tagged it — check the name on the backup file and in the deploy report.`
        return out
    }
    out.tag = tag
    out.restoredTo = commit
    const attrsCommit = resolve(repoUrl, attrsTag, { token, gitUser })
    out.attrsTag = attrsCommit ? attrsTag : null

    // 3 — the target's own live state, compared with the tag. This is a CHECK:
    // a mismatch warns and names the files, it does not block the pointer move.
    try {
        const pushState = deps.pushServerState ?? require('./git-setup').pushServerState
        try { await pushState(target, `live-${target}`, { token, gitUser, ideToken }) } catch { /* reported below */ }
        const releaseDiff = diff(repoUrl, commit, `origin/live-${target}`, { token, gitUser })
        const attrsDiff = attrsCommit ? diff(repoUrl, attrsCommit, `origin/${attrsBranch(target)}`, { token, gitUser }) : []
        out.differences = [...releaseDiff, ...attrsDiff]
        if (out.differences.length) {
            out.warnings.push(`This is not the backup ${target} was restored to, or the restore did not finish: ${out.differences.length} file(s) still differ — ${out.differences.slice(0, 10).join(', ')}${out.differences.length > 10 ? '…' : ''}.`)
        }
    } catch (e) {
        out.warnings.push(`The check could not compare the target with the tag: ${e.message}`)
    }

    // Pointers back: release line, deploy note, attributes branch.
    const rel = move(repoUrl, `release-${target}`, commit, { token, gitUser })
    out.releaseBranch = rel
    if (!rel.ok) { out.error = `Could not move release-${target} back to ${tag}: ${rel.error}`; return out }
    if (attrsCommit) {
        out.attrsBranch = move(repoUrl, attrsBranch(target), attrsCommit, { token, gitUser })
    }
    try {
        out.deployNote = await record(target, commit, `Restored from backup ${backupName}`, { ideToken })
    } catch (e) {
        out.warnings.push(`Restored, but the deploy note could not be written: ${e.message}`)
    }

    // The bad deploy is `reverted`; its change set goes back to waiting for this
    // target (a reverted deploy does not count as reached).
    try {
        const bad = await latestDeployTo(target)
        if (bad && (bad.status === 'complete' || bad.status === 'incomplete')) {
            await setStatus(bad.session_id, target, 'reverted', `restored from backup ${backupName}`)
            out.revertedSession = bad.session_id
        }
    } catch (e) {
        out.warnings.push(`The deploy record could not be marked reverted: ${e.message}`)
    }

    out.ok = true
    out.note = `${target} pointers moved back to ${tag}. Nothing was deleted from Git. The change set is waiting for ${target} again.`
    return out
}

module.exports = { restoreFromBackup, resolveTag, moveBranch, diffCommits }
