'use strict'

// ── Drift check (#3) ────────────────────────────────────────────────────────
// PROD pushes its live state to `prod-live`; git diff against its deployed
// commit shows what's drifted on PROD (out-of-band edits, PROD-only objects).
// Uses the git CLI for the diff (the repo is read-only from the IDE's side here).
//   driftCheck(server)  → { server, deployed, prodLive, entries: [{status, file, diff}] }
//   revert(server)      → redeploy the repo state to the target (overwrite the drift)
//   promote(server)     → merge prod-live into dev, then the source server pulls it

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient } = require('./adapter_registry')
const assertions = require('./assertions')

function git(cwd, ...args) {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function authUrl(url, user, token) {
    return url.replace(/^https:\/\//i, `https://${user}:${token}@`)
}

async function driftCheck(server, { token, gitUser = 'falconbi', ideToken } = {}) {
    const c = makeClient(server, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    const deployed = st?.DeployedCommit?.ID
    const repoUrl = st?.URL
    if (!deployed) return { server, drift: null, note: 'no deployed commit — the target has never pulled' }
    if (!repoUrl) return { server, drift: null, note: 'no repo URL' }

    // Push the target's live state to prod-live (a drift report — does not change its deployed commit).
    // NewBranch on first push; Branch on subsequent pushes (the branch then exists).
    const branches = st?.Remote?.Branches ?? []
    const hasLive = branches.includes('prod-live')
    let pushed
    try {
        await c.post('GitPush', hasLive
            ? { Branch: 'prod-live', NewBranch: '', Force: false, Message: 'drift check: PROD live state', Author: gitUser, Email: `${gitUser}@users.noreply.github.com`, Username: gitUser, Password: token }
            : { Branch: '', NewBranch: 'prod-live', Force: false, Message: 'drift check: PROD live state', Author: gitUser, Email: `${gitUser}@users.noreply.github.com`, Username: gitUser, Password: token })
        pushed = true
    } catch (e) {
        return { server, drift: null, error: `Push to prod-live failed: ${e.response?.data?.error?.message ?? e.message}` }
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
        return { server, deployed, drift: null, error: `git diff failed: ${e.message}` }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

// Revert drift on the target — redeploy the repo state (PROD pulls dev, overwriting the drifted object).
async function revert(server, { branch = 'dev', token, gitUser, ideToken, source } = {}) {
    const { execute } = require('./git-deploy')
    return execute(server, { branch, token, gitUser, ideToken, source })
}

// Promote PROD's live state into dev: merge prod-live → dev, then the source server pulls it.
async function promote(server, { token, gitUser = 'falconbi', ideToken, source } = {}) {
    const c = makeClient(server, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    const repoUrl = st?.URL
    if (!repoUrl) return { ok: false, error: 'no repo URL' }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1promote-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', 'dev', 'prod-live')
        // merge prod-live into a local dev checkout of origin/dev
        git(work, 'checkout', '-q', '-b', 'dev', 'origin/dev')
        git(work, 'merge', '--no-edit', 'origin/prod-live')
        git(work, 'push', 'origin', 'dev:dev')
        // source server pulls the merged state to apply it
        if (source) {
            const sc = makeClient(source, ideToken)
            const plan = await sc.post('GitPull', { Branch: 'dev', ExecutionMode: 'SingleCommit', Force: false, Username: gitUser, Password: token })
            await sc.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        }
        return { ok: true, note: 'prod-live merged into dev; source pulled the merged state' }
    } catch (e) {
        return { ok: false, error: `promote failed: ${e.message}` }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

module.exports = { driftCheck, revert, promote }