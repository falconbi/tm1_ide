'use strict'

// ── Drift check (#3) ────────────────────────────────────────────────────────
// PROD pushes its live state to `prod-live`; git diff against its deployed
// commit shows what's drifted on PROD (out-of-band edits, PROD-only objects).
// Uses the git CLI for the diff (the repo is read-only from the IDE's side here).
//   driftCheck(server)  → { server, deployed, prodLive, entries: [{status, file, diff}] }
//   revert(server)      → redeploy the repo state to the target (overwrite the drift)
//   promote(server)     → merge prod-live into dev, then the source server pulls it

const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient, isReadOnly } = require('./adapter_registry')
const gitIdentity = require('./git-identity')
const assertions = require('./assertions')
const { git, authUrl, sanitize } = require('./git-repo')

async function driftCheck(server, { token, gitUser = gitIdentity.user(), ideToken } = {}) {
    const c = makeClient(server, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    const repoUrl = st?.URL
    // Reference: what the server last RECEIVED. TM1's DeployedCommit is the last
    // git operation's target (a prod-live push clobbers it), so prefer the IDE's
    // recorded deploy commit, falling back to DeployedCommit.
    let deployed = null
    try {
        const { lastDeployed } = require('./git-state')
        deployed = lastDeployed(server)?.lastDeployedCommit ?? null
    } catch { /* ignore */ }
    deployed = deployed ?? st?.DeployedCommit?.ID ?? null
    if (!deployed) return { server, drift: null, note: 'no deployed commit — the target has never pulled' }
    if (!repoUrl) return { server, drift: null, note: 'no repo URL' }

    // Push the target's live state to prod-live (a drift report — does not change its deployed commit).
    // NewBranch on first push; Branch on subsequent pushes (the branch then exists).
    // Plans are ephemeral (expire in seconds), so create AND execute atomically —
    // the push must actually land for prod-live to reflect the live state; a
    // created-but-unexecuted plan leaves prod-live stale and the diff below a
    // false positive.
    const branches = st?.Remote?.Branches ?? []
    const hasLive = branches.includes('prod-live')
    let pushed
    try {
        const plan = await c.post('GitPush', hasLive
            ? { Branch: 'prod-live', NewBranch: '', Force: false, Message: 'drift check: PROD live state', Author: gitUser, Email: gitIdentity.email(), Username: gitUser, Password: token }
            : { Branch: '', NewBranch: 'prod-live', Force: false, Message: 'drift check: PROD live state', Author: gitUser, Email: gitIdentity.email(), Username: gitUser, Password: token })
        await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        pushed = true
    } catch (e) {
        return { server, drift: null, error: `Push to prod-live failed: ${sanitize(e.response?.data?.error?.message ?? e.message, token)}` }
    }

    // Diff via git CLI in a throwaway checkout.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1drift-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        // the deployed commit lives on dev — fetch dev + prod-live, diff locally
        git(work, 'fetch', '-q', 'origin', 'dev', 'prod-live')
        const nameStatus = git(work, 'diff', '--name-status', `${deployed}..origin/prod-live`).trim()
        const entries = []
        if (nameStatus) {
            const full = git(work, 'diff', `${deployed}..origin/prod-live`)
            for (const line of nameStatus.split('\n')) {
                const [status, file] = line.split('\t')
                entries.push({ status, file, diff: status === 'A' ? '(new on PROD)' : '' })
            }
            // attach the readable diff for modified/deleted files
            if (full) {
                const blocks = full.split(/^diff --git /m).filter(Boolean)
                for (const b of blocks) {
                    const f = b.match(/^a\/(\S+)/)?.[1]
                    if (f) {
                        const e = entries.find(x => x.file === f)
                        if (e) e.diff = 'diff --git ' + b.slice(0, 400)
                    }
                }
            }
        }
        return { server, deployed, prodLive: 'origin/prod-live', pushed, entries }
    } catch (e) {
        return { server, deployed, drift: null, error: `git diff failed: ${sanitize(e.message, token)}` }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

// Revert drift on the target — RESTORES the drifted objects from the APPROVED
// commit's repo file (never from DEV's live state, so uncommitted DEV edits can
// not ship). The drifted objects are derived HERE from the drift check — the
// client cannot supply an arbitrary list to copy to PROD. Goes through the
// normal approval gate on the incoming commit.
async function revert(server, { branch = 'dev', token, gitUser = gitIdentity.user(), ideToken } = {}) {
    const approvals = require('./git-approvals')
    const c = makeClient(server, ideToken)
    let plan
    try {
        plan = await c.post('GitPull', { Branch: branch, ExecutionMode: 'SingleCommit', Force: false, Username: gitUser, Password: token })
    } catch (e) {
        return { ok: false, refused: true, error: `Pull plan failed: ${sanitize(e.response?.data?.error?.message ?? e.message, token)}` }
    }
    const commit = plan.Commit?.ID ?? null
    const approval = commit ? await approvals.find(server, commit, { ideToken }) : null
    if (!approval) {
        return { ok: false, refused: true, error: `Refused: DEV has moved on since the last deploy — reverting would ship unapproved changes (${commit}). Approve the new commit first, or redeploy the approved one.` }
    }

    // Derive the drifted objects server-side; never trust a client-supplied list.
    const d = await driftCheck(server, { token, gitUser, ideToken })
    const entries = d?.entries ?? []
    if (d?.error) return { ok: false, refused: true, error: d.error }
    if (!entries.length) return { ok: true, note: 'no drift to restore', commit, approvedBy: approval.approver }

    const { restoreFromCommit } = require('./git-restore')
    const res = await restoreFromCommit(server, commit, entries, { branch, token, gitUser, ideToken })
    res.commit = commit
    res.approvedBy = approval.approver
    res.note = `Restored ${res.restored.length} object(s) from commit ${commit}${res.skipped.length ? ` · ${res.skipped.length} skipped (apply manually): ${res.skipped.map(s => s.file).slice(0, 5).join(', ')}` : ''}${res.errors.length ? ` · ${res.errors.length} failed by ${res.errors[0].error}` : ''}.`
    return res
}

// Promote PROD's live state into dev: merge prod-live → dev, then the source server pulls it.
async function promote(server, { token, gitUser = gitIdentity.user(), ideToken, source } = {}) {
    // Promote merges prod-live into dev and the SOURCE pulls the merge — so the
    // source is the server that gets written. Refuse a self-promote and a
    // read-only source before anything touches a server.
    if (source === server) {
        return { ok: false, refused: true, error: `Refused: source and target are the same server ("${server}"). Promote merges prod-live into dev and pulls the merge — self-promote is a no-op.` }
    }
    if (source && isReadOnly(source)) {
        return { ok: false, refused: true, error: `"${source}" is read-only (PROD posture) — no changes are allowed here.` }
    }
    const c = makeClient(server, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    const repoUrl = st?.URL
    if (!repoUrl) return { ok: false, error: 'no repo URL' }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1promote-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', 'dev', 'prod-live')
        // merge prod-live into a local dev checkout of origin/dev, with our identity
        git(work, 'checkout', '-q', '-b', 'dev', 'origin/dev')
        try {
            git(work, '-c', `user.name=${gitIdentity.user()}`, '-c', `user.email=${gitIdentity.email()}`, 'merge', '--no-edit', 'origin/prod-live')
        } catch (mergeErr) {
            // Merge conflict — report the files by name.
            let files = []
            try { files = git(work, 'diff', '--name-only', '--diff-filter=U').trim().split('\n').filter(Boolean) } catch { /* none */ }
            return { ok: false, conflicts: files, error: `Merge conflict: ${files.length} file(s) need resolution. ${sanitize(mergeErr.message, token)}` }
        }
        git(work, 'push', 'origin', 'dev:dev')
        // source server pulls the merged state to apply it
        if (source) {
            const sc = makeClient(source, ideToken)
            const plan = await sc.post('GitPull', { Branch: 'dev', ExecutionMode: 'SingleCommit', Force: false, Username: gitUser, Password: token })
            await sc.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        }
        return { ok: true, note: 'prod-live merged into dev; source pulled the merged state' }
    } catch (e) {
        return { ok: false, error: `promote failed: ${sanitize(e.message, token)}` }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

module.exports = { driftCheck, revert, promote }