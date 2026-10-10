'use strict'

// ── Drift check (#3) ────────────────────────────────────────────────────────
// PROD pushes its live state to `prod-live`; git diff against its deployed
// commit shows what's drifted on PROD (out-of-band edits, PROD-only objects).
// Uses the git CLI for the diff (the repo is read-only from the IDE's side here).
//   driftCheck(server)  → { server, deployed, prodLive, entries: [{status, file, diff}] }
//
// There is NO automated Revert/Promote anymore: drift pauses deploys, and the
// fix is to re-apply the change on DEV in a change set and release it.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient } = require('./adapter_registry')
const gitIdentity = require('./git-identity')
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
        // Fetch every branch, not just dev+prod-live: the recorded deployed commit
        // can live on a release-* branch (a release deployment), and the diff below
        // must be able to resolve it.
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
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

module.exports = { driftCheck }