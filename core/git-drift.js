'use strict'

// ── Drift check (#3) ────────────────────────────────────────────────────────
// PROD pushes its live state to `live-<target>`; git diff against its deployed
// commit shows what's drifted on PROD (out-of-band edits, PROD-only objects).
// Uses the git CLI for the diff (the repo is read-only from the IDE's side here).
//   driftCheck(server)  → { server, deployed, prodLive, entries: [{status, file, diff}] }
//
// There is NO automated Revert/Promote anymore: drift pauses deploys, and the
// fix is to re-apply the change on DEV in a change set and release it.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient } = require('./adapter-registry')
const gitIdentity = require('./git-identity')
const { git, authUrl, sanitize } = require('./git-repo')

// TM1's pull never applies views or subsets — the IDE applies those itself, after
// the pull, and only for objects the release carries. So a change to one *cannot*
// be damaged by a deploy, and blocking on it is pure friction: users save views on
// PROD all the time. Those are reported, not blocked.
//
// Everything else (dimensions, cubes, processes, chores) IS in the pull: a
// difference there means a deploy would replace the target's copy.
const VIEW_FILE   = /^cubes\/[^/]+\.views\/[^/]+\.(json|mdx)$/
const SUBSET_FILE = /^dimensions\/[^/]+\.hierarchies\/[^/]+\.subsets\/[^/]+\.json$/
const HIER_FILE   = /^dimensions\/[^/]+\.hierarchies\/[^/]+\.json$/

function classifyDriftFile(file) {
    const f = String(file ?? '')
    if (VIEW_FILE.test(f))   return { blocking: false, kind: 'view' }
    if (SUBSET_FILE.test(f)) return { blocking: false, kind: 'subset' }
    return { blocking: true, kind: 'object' }
}

// ── Human summary of a changed file ─────────────────────────────────────────
// The check names the object; these add what actually differs, so the screen can
// say "Dimension WFP Employee — 2 elements added: …" instead of only the name.
const parsed = (text) => { try { return text ? JSON.parse(text) : null } catch { return null } }
const elementName = (e) => e?.Name ?? e?.name ?? String(e?.['@id'] ?? '').match(/Elements\('([^']+)'\)/)?.[1] ?? null
const edgeText = (e) => {
    const p = e?.ParentName ?? e?.parent
    const c = e?.ComponentName ?? e?.child
    return p && c ? `${p} → ${c}` : null
}
const listSome = (xs, max = 6) => xs.slice(0, max).join(', ') + (xs.length > max ? `, +${xs.length - max} more` : '')
const countWord = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// A hierarchy file: element and edge differences, both directions.
function describeDimension(beforeText, afterText) {
    const b = parsed(beforeText)
    const a = parsed(afterText)
    const bEls = new Set((b?.Elements ?? []).map(elementName).filter(Boolean))
    const aEls = new Set((a?.Elements ?? []).map(elementName).filter(Boolean))
    if (!b) return a ? `new on PROD (${countWord(aEls.size, 'element')})` : ''
    if (!a) return `removed from PROD (${countWord(bEls.size, 'element')})`

    const added = [...aEls].filter(n => !bEls.has(n))
    const removed = [...bEls].filter(n => !aEls.has(n))
    const bEdges = new Set((b?.Edges ?? []).map(edgeText).filter(Boolean))
    const aEdges = new Set((a?.Edges ?? []).map(edgeText).filter(Boolean))
    const edgesAdded = [...aEdges].filter(k => !bEdges.has(k))
    const edgesRemoved = [...bEdges].filter(k => !aEdges.has(k))

    const parts = []
    if (added.length) parts.push(`+${countWord(added.length, 'element')}: ${listSome(added)}`)
    if (removed.length) parts.push(`-${countWord(removed.length, 'element')}: ${listSome(removed)}`)
    if (edgesAdded.length) parts.push(`+${countWord(edgesAdded.length, 'edge')}: ${listSome(edgesAdded)}`)
    if (edgesRemoved.length) parts.push(`-${countWord(edgesRemoved.length, 'edge')}: ${listSome(edgesRemoved)}`)
    return parts.join(' · ')
}

// What PROD gained since the last deploy, for comparing with DEV without shipping
// the whole file. Only additions: a full live snapshot would report every edge DEV
// deliberately removed (this change set's own move) as "missing on DEV".
function dimensionSnapshot(beforeText, afterText) {
    const b = parsed(beforeText)
    const a = parsed(afterText)
    const bEls = new Set((b?.Elements ?? []).map(elementName).filter(Boolean))
    const aEls = new Set((a?.Elements ?? []).map(elementName).filter(Boolean))
    const bEdges = new Set((b?.Edges ?? []).map(edgeText).filter(Boolean))
    const aEdges = new Set((a?.Edges ?? []).map(edgeText).filter(Boolean))
    return {
        elements: [...aEls].filter(n => !bEls.has(n)),
        edges: [...aEdges].filter(k => !bEdges.has(k)).map(e => e.replace(' → ', '::')),
    }
}

function subsetMembers(text) {
    const d = parsed(text)
    return [...new Set((d?.Elements ?? []).map(elementName).filter(Boolean))]
}

// A subset file: its members (static) or the MDX expression.
function describeSubset(text) {
    const d = parsed(text)
    const els = (d?.Elements ?? []).map(elementName).filter(Boolean)
    if (els.length) return `${countWord(els.length, 'member')}: ${listSome(els, 8)}`
    if (d?.Expression) return `MDX: ${String(d.Expression).slice(0, 100)}`
    return ''
}

// Canonical JSON, so key order and whitespace cannot be mistaken for a change.
// TM1's Git writer and the IDE's differ in formatting (`"a": 1` vs `"a":1`); a
// formatting-only file is not drift.
function stableValue(v) {
    if (Array.isArray(v)) return v.map(stableValue)
    if (v && typeof v === 'object') {
        const out = {}
        for (const k of Object.keys(v).sort()) out[k] = stableValue(v[k])
        return out
    }
    return v
}
function sameJson(a, b) {
    try { return JSON.stringify(stableValue(JSON.parse(a))) === JSON.stringify(stableValue(JSON.parse(b))) }
    catch { return false }
}

async function driftCheckUnlocked(server, { token, gitUser = gitIdentity.user(), ideToken } = {}) {
    const c = makeClient(server, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    const repoUrl = st?.URL
    // Reference: what the server last RECEIVED. TM1's DeployedCommit is the last
    // git operation's target (a live-<target> push clobbers it), so prefer the IDE's
    // recorded deploy commit, falling back to DeployedCommit.
    let deployed = null
    try {
        const { lastDeployed } = require('./git-state')
        deployed = lastDeployed(server)?.lastDeployedCommit ?? null
    } catch { /* ignore */ }
    deployed = deployed ?? st?.DeployedCommit?.ID ?? null
    if (!deployed) return { server, drift: null, note: 'no deployed commit — the target has never pulled' }
    if (!repoUrl) return { server, drift: null, note: 'no repo URL' }

    // Push the target's live state to live-<target> (a drift report — does not change its deployed commit).
    // NewBranch on first push; Branch on subsequent pushes (the branch then exists).
    // Plans are ephemeral (expire in seconds), so create AND execute atomically —
    // the push must actually land for live-<target> to reflect the live state; a
    // created-but-unexecuted plan leaves live-<target> stale and the diff below a
    // false positive.
    // Each target has its own live snapshot branch (Part B.1): one branch per
    // server, so two targets never overwrite each other's drift reference.
    const liveBranch = `live-${server}`
    const branches = st?.Remote?.Branches ?? []
    const hasLive = branches.includes(liveBranch)
    let pushed
    try {
        const plan = await c.post('GitPush', hasLive
            ? { Branch: liveBranch, NewBranch: '', Force: false, Message: `drift check: ${server} live state`, Author: gitUser, Email: gitIdentity.email(), Username: gitUser, Password: token }
            : { Branch: '', NewBranch: liveBranch, Force: false, Message: `drift check: ${server} live state`, Author: gitUser, Email: gitIdentity.email(), Username: gitUser, Password: token })
        await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        pushed = true
    } catch (e) {
        return { server, drift: null, error: `Push to ${liveBranch} failed: ${sanitize(e.response?.data?.error?.message ?? e.message, token)}` }
    }

    // Diff via git CLI in a throwaway checkout.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1drift-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        // the deployed commit lives on dev — fetch every branch and diff locally
        // Fetch every branch, not just dev+live-<target>: the recorded deployed commit
        // can live on a release-* branch (a release deployment), and the diff below
        // must be able to resolve it.
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        const nameStatus = git(work, 'diff', '--name-status', `${deployed}..origin/${liveBranch}`).trim()
        const entries = []
        if (nameStatus) {
            const full = git(work, 'diff', `${deployed}..origin/${liveBranch}`)
            for (const line of nameStatus.split('\n')) {
                const [status, file] = line.split('\t')
                entries.push({ status, file, diff: status === 'A' ? '(new on PROD)' : '', ...classifyDriftFile(file) })
            }
            // attach the readable diff for modified/deleted files
            if (full) {
                const blocks = full.split(/^diff --git /m).filter(Boolean)
                for (const b of blocks) {
                    // A path can contain spaces ("cubes/WFP Headcount.json"), so the
                    // match cannot stop at the first space — take the line's tail.
                    const f = b.match(/^a\/(.+?)(?: b\/.+)?\n/)?.[1]
                    if (f) {
                        const e = entries.find(x => x.file === f)
                        if (e) e.diff = 'diff --git ' + b.slice(0, 400)
                    }
                }
            }

            // Drop formatting-only JSON differences before anything classifies them.
            for (let i = entries.length - 1; i >= 0; i--) {
                const e = entries[i]
                if (e.status !== 'M' || !/\.json$/i.test(e.file)) continue
                try {
                    const before = git(work, 'show', `${deployed}:${e.file}`)
                    const after = git(work, 'show', `origin/${liveBranch}:${e.file}`)
                    if (sameJson(before, after)) entries.splice(i, 1)
                } catch { /* unreadable: keep the entry */ }
            }

            // A cube file also lists its views (`Views@Code.links`). If that list is
            // the ONLY difference, the drift belongs to the view family: TM1's pull
            // never applies views, the IDE applies them over REST, and the release
            // that carries the cube file replaces the list with one that already has
            // the target's views. Blocking on it made a target whose cube file was
            // out of date permanently undeployable — the fix deploy was exactly what
            // the gate refused.
            for (const e of entries) {
                if (e.blocking === false) continue
                if (!/^cubes\/[^/]+\.json$/i.test(e.file)) continue
                try {
                    const { cubeDiffBeyondViews } = require('./git-release')
                    const before = JSON.parse(git(work, 'show', `${deployed}:${e.file}`))
                    const after = JSON.parse(git(work, 'show', `origin/${liveBranch}:${e.file}`))
                    if (!cubeDiffBeyondViews(before, after).differs) {
                        e.blocking = false
                        e.kind = 'cube-views'
                        e.note = 'only its list of views differs — the deploy applies views over REST'
                    }
                } catch { /* unreadable: it stays blocking */ }
            }

            // What actually differs, for the pre-deploy screen. Best effort: a file
            // that cannot be read leaves the summary empty rather than failing.
            for (const e of entries) {
                try {
                    if (e.kind === 'subset') {
                        const text = git(work, 'show', `origin/${liveBranch}:${e.file}`)
                        e.summary = describeSubset(text)
                        e.prodMembers = subsetMembers(text)
                    } else if (HIER_FILE.test(e.file)) {
                        const before = e.status === 'A' ? null : git(work, 'show', `${deployed}:${e.file}`)
                        const after = e.status === 'D' ? null : git(work, 'show', `origin/${liveBranch}:${e.file}`)
                        e.summary = describeDimension(before, after)
                        e.prodAdded = dimensionSnapshot(before, after)
                    }
                } catch { /* leave the summary empty */ }
            }
        }
        let liveCommit = null
        try { liveCommit = git(work, 'rev-parse', `origin/${liveBranch}`).trim() } catch { liveCommit = null }
        return { server, deployed, liveBranch, liveCommit, prodLive: `origin/${liveBranch}`, pushed, entries }
    } catch (e) {
        return { server, deployed, drift: null, error: `git diff failed: ${sanitize(e.message, token)}` }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

// One drift check per target at a time. The live snapshot is a repo push, so it
// must not race another check or a deploy. Deploy's internal targetDrift passes
// lock:false because execute() already holds the target lock.
async function driftCheck(server, { lock = true, ...opts } = {}) {
    if (!lock) return driftCheckUnlocked(server, opts)
    const lockMod = require('./git-lock')
    try {
        await lockMod.acquire(server, { by: opts.by ?? 'drift check', ideToken: opts.ideToken })
    } catch (e) {
        return { server, drift: null, busy: !!e.refused, error: e.message }
    }
    try {
        return await driftCheckUnlocked(server, opts)
    } finally {
        await lockMod.release(server, { ideToken: opts.ideToken }).catch(() => {})
    }
}

module.exports = { driftCheck, classifyDriftFile, describeDimension, describeSubset, dimensionSnapshot, subsetMembers }