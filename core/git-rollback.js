'use strict'

// ── Return a target to the release it last received ─────────────────────────
// The recovery for a pull that died part-way, and for a target someone has
// changed into an unrecognisable state: put it back to the tree of the commit
// the IDE recorded as last deployed.
//
// How, given what TM1 Git can actually do: GitPull takes a BRANCH, not a commit
// (proved on the lab — see docs/deploy/TM1_GIT_EVALUATION.md). A branch pointing
// at an older commit is a backwards step TM1 has no reason to plan, so this
// builds a FORWARD commit instead:
//
//   parent = what the target holds now (TM1's DeployedCommit)
//   tree   = the last release it received
//
// Pulling that branch is an ordinary forward change that restores every object
// in the tree. The restore branch is left in the repo as the record of what
// happened, and release-<target> is reset onto the same commit so the next
// release is built on what the target now actually holds.
//
// What it cannot do, and says so:
//   - It cannot bring back cell DATA. Values loaded since the release are data,
//     not Git objects, and a pull does not touch them.
//   - It cannot remove objects created after the release: TM1's pull never
//     deletes (docs/deploy/DEPLOY_LIFECYCLE.md). Those are reconciled separately.
//   - It cannot undo anything outside Git (attribute values, picklists written
//     over REST) — the same reason the IDE applies those itself after a pull.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient } = require('./adapter-registry')
const { git, authUrl, sanitize } = require('./git-repo')
const gitIdentity = require('./git-identity')
const { lastDeployed, recordDeploy } = require('./git-state')

const refusal = (message) => Object.assign(new Error(message), { refused: true })

const NOTHING_TO_RETURN = (target) =>
    `${target} has no recorded last release — there is nothing to return to. Record a baseline first.`

function commitExists(work, sha) {
    try { git(work, 'cat-file', '-e', `${sha}^{commit}`); return true } catch { return false }
}

async function historyEvent(target, event, { ideToken } = {}) {
    const store = require('./model-store')
    // 'lock' is the Deployments folder WITHOUT a fixed document name — 'deployState'
    // always resolves to state.json, which would have overwritten the deploy state.
    const events = (await store.readOptional(target, 'lock', 'restore-events.json', { ideToken })) ?? []
    events.push(event)
    await store.writeDoc(target, 'lock', 'restore-events.json', events, { ideToken })
}

// What a return would do to the model, worded exactly as the first pull words
// it — because it IS the same overwrite. The element loss comes from the shared
// compareTargetWithRepo, never a local copy of that arithmetic.
async function returnPreview(target, { token, gitUser = gitIdentity.user(), ideToken } = {}) {
    const recorded = lastDeployed(target)
    const base = recorded?.lastDeployedCommit ?? null
    if (!base) throw refusal(NOTHING_TO_RETURN(target))
    const c = makeClient(target, ideToken)
    let st
    try { st = await c.post('GitStatus', { Username: gitUser, Password: token }) }
    catch (e) { throw new Error(sanitize(e.response?.data?.error?.message ?? e.message, token)) }
    const repoUrl = st?.URL
    if (!repoUrl) throw refusal(`${target} is not linked to a repo.`)
    const { compareTargetWithRepo } = require('./git-readiness')
    const cmp = await compareTargetWithRepo(target, { commit: base, repoUrl, token, gitUser, ideToken, client: c })
    return { target, from: st?.DeployedCommit?.ID ?? null, to: base, ...cmp }
}

// Point release-<target> at a commit that is already in the repo. Done from a
// fresh clone so it works after the build clone is gone, and force-with-lease so
// a concurrent move is never clobbered silently.
async function pushReleaseLine(target, { repoUrl, gitUser, token, commit }) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1relpoint-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        let existing = null
        try { existing = git(work, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/release-${target}`).trim() || null } catch { existing = null }
        const ref = `${commit}:refs/heads/release-${target}`
        if (existing) git(work, 'push', '-q', `--force-with-lease=refs/heads/release-${target}:${existing}`, 'origin', ref)
        else git(work, 'push', '-q', 'origin', ref)
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

async function returnToLastRelease(target, { token, gitUser = gitIdentity.user(), ideToken, by, confirm, reason } = {}) {
    const out = { target, ok: false }

    // Cheap guard first: an empty confirmation never reaches the target.
    if (!String(confirm ?? '').trim()) {
        throw refusal(`Refused: type the confirmation sentence the dialog shows — it names what this removes from ${target}.`)
    }

    // Deliberate friction, and the same sentence the first pull asks for: the
    // count of elements this will remove is part of what has to be typed, so it
    // cannot be confirmed without being read.
    const preview = await returnPreview(target, { token, gitUser, ideToken })
    out.preview = preview
    if (String(confirm ?? '') !== preview.confirmText) {
        throw refusal(`Refused: type exactly — ${preview.confirmText}`)
    }
    const base = preview.to

    const lockMod = require('./git-lock')
    await lockMod.acquire(target, { by, ideToken })
    try {
        const c = makeClient(target, ideToken)
        const st = await c.post('GitStatus', { Username: gitUser, Password: token })
        const repoUrl = st?.URL
        if (!repoUrl) throw refusal(`${target} is not linked to a repo.`)
        // What the target itself thinks it holds — the parent of the restore commit.
        const current = st?.DeployedCommit?.ID ?? null
        out.from = current ?? base
        out.to = base

        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1restore-'))
        let restoreCommit
        try {
            git(work, 'init', '-q')
            git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
            git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
            if (!commitExists(work, base)) {
                throw refusal(`${target}'s recorded last release (${String(base).slice(0, 10)}) is not in the repo — it cannot be restored from Git.`)
            }
            const parent = current && commitExists(work, current) ? current : base

            // A commit whose tree IS the last release, sitting on top of whatever
            // the target holds now. Forward, planable, and it changes only the
            // files that differ from the release.
            git(work, 'checkout', '-q', '--detach', parent)
            git(work, 'read-tree', '--reset', '-u', base)
            git(work, '-c', `user.name=${gitUser}`, '-c', `user.email=${gitIdentity.email()}`, 'commit', '-q', '-m',
                `Restore ${target} to ${String(base).slice(0, 10)}`)
            restoreCommit = git(work, 'rev-parse', 'HEAD').trim()

            // A second restore diverges from the first (different parent), so the
            // record branch is force-moved — with a lease, never blindly.
            let priorRestore = null
            try { priorRestore = git(work, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/restore-${target}`).trim() || null } catch { priorRestore = null }
            if (priorRestore) {
                git(work, 'push', '-q', `--force-with-lease=refs/heads/restore-${target}:${priorRestore}`, 'origin', `HEAD:refs/heads/restore-${target}`)
            } else {
                git(work, 'push', '-q', 'origin', `HEAD:refs/heads/restore-${target}`)
            }
        } finally {
            fs.rmSync(work, { recursive: true, force: true })
        }
        out.restoreCommit = restoreCommit

        // Plan first, then apply. A restore that would change nothing is reported
        // as such — never a blind pull.
        const plan = await c.post('GitPull', {
            Branch: `restore-${target}`, ExecutionMode: 'SingleCommit', Force: false,
            Username: gitUser, Password: token,
        })
        const ops = (plan.Operations ?? []).map(String)
        const changes = ops.filter(o => !/^Skip /i.test(o))
        out.plan = { total: ops.length, changes }

        if (changes.length === 0) {
            out.ok = true
            out.already = true
            // Nothing was applied, so nothing moves: the target keeps the commit it
            // already reports, which is reachable from the release branch.
            const keep = current ?? base
            await recordDeploy(target, keep, `Already holds the last release (${String(base).slice(0, 10)})`, { ideToken })
            out.recorded = keep
            return out
        }

        await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        out.ok = true
        out.applied = changes

        // The release line restarts from the restore commit. This must happen
        // together: recording the OLD commit while the branch points at the
        // restore commit orphans the old one (a fetch cannot see an unreachable
        // commit, so the next drift check fails with "unknown revision" — the
        // first live run did exactly that). Recorded and branch therefore both
        // move to the restore commit, whose TREE is the release we returned to.
        await pushReleaseLine(target, { repoUrl, gitUser, token, commit: restoreCommit })
        await recordDeploy(target, restoreCommit, `Returned to the last release (${String(base).slice(0, 10)})`, { ideToken })
        out.recorded = restoreCommit
        out.restoredTreeOf = base
        try {
            await historyEvent(target, {
                action: 'returned',
                at: new Date().toISOString(),
                by: by ?? 'unknown',
                from: current ?? null,
                to: base,
                restore_commit: restoreCommit,
                reason: reason ? String(reason).slice(0, 500) : null,
                changes: changes.slice(0, 200),
            }, { ideToken })
        } catch (e) {
            out.historyError = `Restored, but the history entry could not be written: ${e.message}`
        }
        return out
    } catch (e) {
        if (e.refused) throw e
        throw new Error(sanitize(e.response?.data?.error?.message ?? e.message, token))
    } finally {
        try { await lockMod.release(target, { ideToken }) } catch { /* surfaced by the caller if it matters */ }
    }
}

module.exports = { returnToLastRelease, returnPreview, NOTHING_TO_RETURN }
