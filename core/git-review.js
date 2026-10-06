'use strict'

// ── Review — the actual content diff for a deploy ───────────────────────────
// What the target will receive vs what it already has: a git diff between the
// commit the target last received and the incoming commit, per changed file.
// Read-only. Same idea as the drift check, different pair of commits.

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient } = require('./adapter_registry')
const { lastDeployed } = require('./git-state')

function git(cwd, ...args) {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
}
function authUrl(url, user, token) {
    return url.replace(/^https:\/\//i, `https://${user}:${token}@`)
}

async function review(source, target, { branch = 'dev', token, gitUser = 'falconbi', ideToken } = {}) {
    const c = makeClient(target, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    const repoUrl = st?.URL
    if (!repoUrl) return { error: 'no repo URL', entries: [] }

    // from = what the target last received; to = the incoming commit (pull plan).
    const from = lastDeployed(target)?.lastDeployedCommit ?? st?.DeployedCommit?.ID ?? null
    let plan
    try {
        plan = await c.post('GitPull', { Branch: branch, ExecutionMode: 'SingleCommit', Force: false, Username: gitUser, Password: token })
    } catch (e) {
        return { error: `Pull plan failed: ${e.response?.data?.error?.message ?? e.message}`, entries: [] }
    }
    const to = plan.Commit?.ID ?? null
    if (!from) return { from, to, entries: [], note: 'target has never received a deploy' }
    if (!to)   return { from, to, entries: [], note: 'nothing to receive' }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1review-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', branch)
        const nameStatus = git(work, 'diff', '--name-status', `${from}..${to}`).trim()
        const entries = []
        if (nameStatus) {
            for (const line of nameStatus.split('\n')) {
                const [status, file] = line.split('\t')
                let diff = ''
                if (status !== 'A') {
                    try { diff = git(work, 'diff', `${from}..${to}`, '--', file) } catch { diff = '' }
                }
                // Cap very large diffs so the UI stays responsive.
                const lines = diff.split('\n')
                if (lines.length > 300) diff = lines.slice(0, 300).join('\n') + '\n… (truncated)'
                entries.push({ status, file, diff: status === 'A' ? '(new object)' : diff })
            }
        }
        return { from, to, entries }
    } catch (e) {
        return { error: `git diff failed: ${e.message}`, entries: [] }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

module.exports = { review }
