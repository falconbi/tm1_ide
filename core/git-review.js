'use strict'

// ── Review — the actual content diff for a deploy ───────────────────────────
// What the target will receive vs what it already has: a git diff between the
// commit the target last received and the incoming commit, per changed file.
// Read-only. Same idea as the drift check, different pair of commits.
// Also reports the change set's manifest deletes, and flags anything in the
// commit diff that did NOT come from this change set (dev moved, or other work).

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient } = require('./adapter_registry')
const { lastDeployed } = require('./git-state')
const gitIdentity = require('./git-identity')
const { git, authUrl, sanitize } = require('./git-repo')

async function review(source, target, { branch = 'dev', token, gitUser = gitIdentity.user(), ideToken, session = null } = {}) {
    const c = makeClient(target, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    const repoUrl = st?.URL
    if (!repoUrl) return { error: 'no repo URL', entries: [] }

    const from = lastDeployed(target)?.lastDeployedCommit ?? st?.DeployedCommit?.ID ?? null
    let plan
    try {
        plan = await c.post('GitPull', { Branch: branch, ExecutionMode: 'SingleCommit', Force: false, Username: gitUser, Password: token })
    } catch (e) {
        return { error: `Pull plan failed: ${sanitize(e.response?.data?.error?.message ?? e.message, token)}`, entries: [] }
    }
    const to = plan.Commit?.ID ?? null
    if (!to) return { from, to, entries: [], note: 'nothing to receive' }

    // Change-set scope (deletes + what the change set touched) for flagging.
    let manifest = { deletes: [], dims: [], attrElements: [], wholesaleDims: [] }
    let setObjects = []
    if (session) {
        try {
            const cl = require('./change_log')
            manifest = cl.getSessionManifest(session) ?? manifest
            setObjects = cl.getSessionLog(session).map(e => [String(e.object_type ?? '').toLowerCase(), String(e.object_name ?? '')])
        } catch { /* not available */ }
    }

    // Match repo file paths (and plan-op strings) to change-log objects properly.
    const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
    const fileToObject = (file) => {
        const f = String(file ?? '')
        let m
        if ((m = f.match(/^processes\/(.+)\.(json|ti)$/))) return { type: 'process', name: m[1] }
        if ((m = f.match(/^dimensions\/(.+)\.hierarchies\/(.+)\.subsets\/(.+)\.json$/))) return { type: 'subset', name: m[3] }
        if ((m = f.match(/^dimensions\/(.+)\.hierarchies\/(.+)\.json$/)) || (m = f.match(/^dimensions\/(.+)\.json$/))) return { type: 'dimension', name: m[1] }
        if ((m = f.match(/^cubes\/(.+)\.views\/(.+)\.json$/))) return { type: 'view', name: m[2] }
        if ((m = f.match(/^cubes\/(.+)\.rules$/))) return { type: 'rules', name: m[1] }
        if ((m = f.match(/^cubes\/(.+)\.json$/))) return { type: 'cube', name: m[1] }
        return null
    }
    const inSet = (o) => o && setObjects.some(([t, n]) => t === o.type && norm(n) === norm(o.name))

    // Plan objects (object-level) for the first-deploy listing + flagging.
    const planObjects = (plan.Operations ?? []).map(op => {
        const m = String(op).match(/^(Create|Update|Delete|Skip)\s+([^(']+)\('?([^')]*)'?\)?/)
        return m ? { action: m[1], type: m[2].toLowerCase(), name: m[3], rest: op } : null
    }).filter(Boolean)

    // First deploy: nothing to diff against — list the pull-plan objects.
    if (!from) {
        return {
            from: null, to, firstDeploy: true,
            entries: planObjects
                .filter(p => p.action !== 'Skip')
                .map(p => ({ status: 'A', file: p.rest, diff: '(new object on first deploy)' })),
            manifest,
            outOfChangeSet: planObjects.filter(p => p.action !== 'Skip' && session && !inSet({ type: p.type, name: p.name })).map(p => p.rest),
        }
    }

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
                const lines = diff.split('\n')
                if (lines.length > 300) diff = lines.slice(0, 300).join('\n') + '\n… (truncated)'
                entries.push({ status, file, diff: status === 'A' ? '(new object)' : diff })
            }
        }
        // Flag commit-diff objects the change set did not touch (proper matching).
        const outOfChangeSet = entries.filter(e2 => !inSet(fileToObject(e2.file))).map(e2 => e2.file)
        return { from, to, entries, manifest, outOfChangeSet }
    } catch (e) {
        return { error: sanitize(e.message, token), entries: [] }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

module.exports = { review }