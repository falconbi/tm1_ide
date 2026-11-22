'use strict'

// ── The baseline: what the target was last given ────────────────────────────
// Refresh must be able to say "PROD added this" rather than "this is different",
// and it cannot do that by comparing two live servers — a deliberate deletion on
// DEV looks identical to an addition on PROD. (On the WFP cut that meant Refresh
// offered to put back the 2,295 employees and 2,503 positions the cut removed.)
//
// The baseline is the TREE of the release the target last received:
//
//   the release branch head   origin/release-<target>, the authoritative copy
//   the local record          data/git-deploy-state.json, one IDE's memory of it
//
// Both are read, and if they DISAGREE the baseline is refused outright — a deploy
// from another IDE has moved the branch, and picking one silently would compare
// against the wrong past. Two people and two IDEs is the normal case, not the
// exceptional one.
//
// Reading is `git show <commit>:<path>` from a throwaway clone, cached per commit
// for the life of the process — a baseline only changes when the target receives
// a release (or is returned to one: return moves the release line AND the record
// to the restore commit, whose tree is the release returned to).

const fs = require('fs')
const os = require('os')
const path = require('path')

const { makeClient } = require('./adapter-registry')
const gitIdentity = require('./git-identity')
const gitSecrets = require('./git-secrets')
const { git, authUrl, sanitize } = require('./git-repo')

const readers = new Map()   // `${repoUrl}#${commit}` → { dir, show }

function releaseBranch(target) {
    return `release-${target}`
}

async function resolveBase(target, { ideToken } = {}) {
    let local
    try { local = require('./git-state').lastDeployed(target)?.lastDeployedCommit ?? null } catch { local = null }

    const c = makeClient(target, ideToken)
    const token = gitSecrets.getToken()
    let repoUrl
    try {
        const st = await c.post('GitStatus', { Username: gitIdentity.user(), Password: token })
        repoUrl = st?.URL ?? null
    } catch (e) {
        return { ok: false, target, reason: `Could not read ${target}'s Git link: ${sanitize(e.message, token)}` }
    }
    if (!repoUrl) return { ok: false, target, reason: `${target} is not linked to a repository, so there is no baseline to compare against.` }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1base-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitIdentity.user(), token))
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        let branch = null
        try { branch = git(work, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${releaseBranch(target)}`).trim() || null } catch { branch = null }

        if (branch && local && branch !== local) {
            return {
                ok: false, target, repoUrl, branch, local, mismatch: true,
                reason: `The release branch for ${target} is at ${branch.slice(0, 10)}, but this IDE recorded ${local.slice(0, 10)} as the last deploy. ` +
                    `A deploy from another IDE (or a history change) has moved it, so "what PROD changed since the last deploy" has two answers. ` +
                    `Nothing can be compared safely until that is settled — refresh is refused rather than guessing.`,
            }
        }
        if (!branch && !local) {
            return { ok: false, target, repoUrl, missing: true, reason: `${target} has never received a release, so there is no baseline: every difference is shown with nothing selected.` }
        }
        if (!branch) {
            return {
                ok: false, target, repoUrl, local, missing: true,
                reason: `This IDE recorded ${String(local).slice(0, 10)} as ${target}'s last deploy, but the repository has no release branch for ${target} — the baseline cannot be confirmed from Git.`,
            }
        }
        return { ok: true, target, repoUrl, commit: branch, local, branch, source: local ? 'release-branch' : 'release-branch-only' }
    } catch (e) {
        return { ok: false, target, repoUrl, reason: `Could not read ${target}'s release branch: ${sanitize(e.message, token)}` }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

// A reader for one commit. Parsed values are cached; the checkout stays for the
// life of the process (there is one committing baseline per target at a time).
function openBase(repoUrl, commit) {
    const key = `${repoUrl}#${commit}`
    if (readers.has(key)) return readers.get(key)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1base-'))
    const token = gitSecrets.getToken()
    git(dir, 'init', '-q')
    git(dir, 'remote', 'add', 'origin', authUrl(repoUrl, gitIdentity.user(), token))
    // Fetch every branch: a release commit is reachable from release-<target>, but the
    // server may not allow fetching an arbitrary SHA directly.
    git(dir, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
    const show = (p) => git(dir, 'show', `${commit}:${p}`)
    const has = (p) => { try { show(p); return true } catch { return false } }
    const list = (prefix) => {
        try {
            return git(dir, 'ls-tree', '-r', '--name-only', commit).split('\n').filter(f => f && f.startsWith(prefix))
        } catch { return [] }
    }
    const reader = { commit, dir, show, has, list }
    readers.set(key, reader)
    return reader
}

const splitId = (s) => String(s ?? '').match(/Elements\('([^']+)'\)/)?.[1] ?? null

// A hierarchy as the baseline holds it: elements with their types, edges with
// their weights. Missing file → null (the object did not exist in that release).
function baseHierarchy(reader, dim, hier = dim) {
    const p = `dimensions/${dim}.hierarchies/${hier}.json`
    let doc
    try { doc = JSON.parse(reader.show(p)) } catch { return null }
    const elements = new Map()
    for (const e of doc.Elements ?? []) {
        const name = e?.Name ?? splitId(e?.['@id'])
        if (name) elements.set(name, String(e?.Type ?? '').toLowerCase() === 'consolidated' ? 'Consolidated' : (e?.Type ?? 'Numeric'))
    }
    const edges = new Map()
    for (const e of doc.Edges ?? []) {
        if (!e?.ParentName || !e?.ComponentName) continue
        edges.set(`${e.ParentName}::${e.ComponentName}`, Number(e.Weight ?? 1))
    }
    return { elements, edges }
}

function baseSubset(reader, dim, hier, name) {
    const p = `dimensions/${dim}.hierarchies/${hier}.subsets/${name}.json`
    let doc
    try { doc = JSON.parse(reader.show(p)) } catch { return null }
    const expr = String(doc.Expression ?? '').trim()
    if (expr) return { mode: 'mdx', expression: expr }
    return { mode: 'static', members: (doc.Elements ?? []).map(e => e?.Name ?? splitId(e?.['@id'])).filter(Boolean) }
}

function baseView(reader, cube, name) {
    const p = `cubes/${cube}.views/${name}.json`
    let doc
    try { doc = JSON.parse(reader.show(p)) } catch { return null }
    if (String(doc['@type'] ?? '').includes('MDXView') || doc['MDX@Code.link']) {
        let text = doc.MDX ?? null
        if (text == null) { try { text = reader.show(`cubes/${cube}.views/${name}.mdx`) } catch { text = null } }
        return { mode: 'mdx', expression: String(text ?? '') }
    }
    const axis = (a) => ({
        dimension: a?.DimensionName ?? a?.Name ?? null,
        subset: a?.Subset?.Name || null,
        expression: (a?.Subset?.Name ? null : (a?.Subset?.Expression ?? null)),
    })
    return { mode: 'native', rows: (doc.Rows ?? []).map(axis), columns: (doc.Columns ?? []).map(axis), titles: (doc.Titles ?? []).map(axis) }
}

function baseChore(reader, name) {
    const p = `chores/${name}.json`
    let doc
    try { doc = JSON.parse(reader.show(p)) } catch { return null }
    return { StartTime: doc.StartTime ?? null, Frequency: doc.Frequency ?? null, ExecutionMode: doc.ExecutionMode ?? null }
}

module.exports = { resolveBase, openBase, baseHierarchy, baseSubset, baseView, baseChore, releaseBranch }
