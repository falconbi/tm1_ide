'use strict'

// ── Git readiness check (IMPROVEMENTS 10.2) ─────────────────────────────────
// Must pass before any push. TM1 tolerates stale references at runtime but its
// Git import does not — one view with a member-less or stale title blocks the
// whole pull. This scan finds the problems so the deploy risk check can block
// before anything is pushed, and it runs on demand / cross-server too.
//
//   scan(server, opts)          — four checks; returns findings
//   firstPullAnalysis(server)   — the first-pull plan, target-only objects and
//                                 element loss from every hierarchy; fails closed

const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeClient } = require('./adapter-registry')
const gitIdentity = require('./git-identity')
const gitSecrets = require('./git-secrets')
const { odataKey } = require('./odata-key')
const { git, authUrl, sanitize } = require('./git-repo')

// Names TM1 Git is known not to round-trip (check #3): a comma in a subset/view name.
function roundTripProblem(name) {
    if (typeof name === 'string' && name.includes(',')) return 'comma in name'
    return null
}

// Extract [Dim].[Hier].[Member] triplets from an MDX expression.
function memberRefs(expr) {
    const out = []
    if (!expr) return out
    // Element names may contain ]] (same encoding as shared/pivot/cellset.js).
    const re = /\[((?:[^\]]|\]\])*)\]\.\[((?:[^\]]|\]\])*)\]\.\[((?:[^\]]|\]\])*)\]/g
    let m
    const unescape = s => s.replace(/\]\]/g, ']')
    while ((m = re.exec(expr))) out.push({ dim: unescape(m[1]), hier: unescape(m[2]), member: unescape(m[3]) })
    return out
}

function _clientFor(server, opts = {}) {
    if (opts.client) return opts.client
    return makeClient(server, opts.ideToken ?? null)
}

// ── Scan ────────────────────────────────────────────────────────────────────

async function scan(server, opts = {}) {
    const c = _clientFor(server, opts)
    const out = {
        server,
        memberLessTitles: [], staleViewMembers: [], staleSubsetElements: [],
        roundTripNames: [], tm1projectIgnore: [], ok: true,
    }
    const dimElements = new Map()
    const dimSubsets = new Map()

    const dims = ((await c.get('Dimensions', { '$select': 'Name' })).value ?? []).map(d => d.Name)
    for (const dim of dims) {
        const els = new Set()
        try {
            const r = await c.get(`Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(dim)}')/Elements?$select=Name`)
            ;(r.value ?? []).forEach(e => els.add(e.Name))
        } catch { /* hierarchy may not match dim name */ }
        dimElements.set(dim, els)

        const subs = new Set()
        try {
            const r = await c.get(`Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(dim)}')/Subsets?$select=Name,Expression`)
            ;(r.value ?? []).forEach(s => subs.add({ name: s.Name, expression: s.Expression ?? null }))
        } catch { /* none */ }
        dimSubsets.set(dim, subs)
    }

    // Static subset elements + dynamic subset expressions
    for (const [dim, subs] of dimSubsets) {
        const els = dimElements.get(dim)
        for (const s of subs) {
            const bad = roundTripProblem(s.name)
            if (bad) out.roundTripNames.push({ dim, kind: 'subset', name: s.name, problem: bad })
            if (s.expression) {
                for (const ref of memberRefs(s.expression)) {
                    const dEls = dimElements.get(ref.dim)
                    if (dEls && !dEls.has(ref.member)) out.staleViewMembers.push({ where: `${dim}/${s.name}`, kind: 'subset-expr', dim: ref.dim, member: ref.member, expr: s.expression.slice(0, 90) })
                }
                continue
            }
            try {
                const r = await c.get(`Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(dim)}')/Subsets('${odataKey(s.name)}')/Elements?$select=Name`)
                for (const e of r.value ?? []) if (!els.has(e.Name)) out.staleSubsetElements.push({ dim, subset: s.name, element: e.Name })
            } catch { /* ignore */ }
        }
    }

    // Cubes + views + placements
    const cubes = ((await c.get('Cubes', { '$select': 'Name' })).value ?? []).map(x => x.Name)
    for (const cube of cubes) {
        let views
        try { views = ((await c.get(`Cubes('${odataKey(cube)}')/Views?$select=Name`)).value ?? []).map(v => v.Name) } catch { continue }
        for (const view of views) {
            const bad = roundTripProblem(view)
            if (bad) out.roundTripNames.push({ kind: 'view', name: view, cube, problem: bad })
            let rows, cols, titles
            try {
                const [rr, cc, tt] = await Promise.all([
                    c.get(`Cubes('${odataKey(cube)}')/Views('${odataKey(view)}')/Rows?$expand=Subset`),
                    c.get(`Cubes('${odataKey(cube)}')/Views('${odataKey(view)}')/Columns?$expand=Subset`),
                    c.get(`Cubes('${odataKey(cube)}')/Views('${odataKey(view)}')/Titles?$expand=Subset,Selected`),
                ])
                rows = rr.value ?? []; cols = cc.value ?? []; titles = tt.value ?? []
            } catch { continue }

            for (const p of titles) {
                const exprDim = memberRefs(p.Subset?.Expression ?? '')[0]?.dim ?? null
                const dim = p.DimensionName ?? p.Name ?? exprDim ?? '?'
                if (p.Selected == null) {
                    out.memberLessTitles.push({ cube, view, dim, expr: p.Subset?.Expression ?? null })
                } else {
                    const id = p.Selected['@odata.id'] ?? (typeof p.Selected === 'string' ? p.Selected : null)
                    const mm = id ? (id.match(/Elements\('([^']+)'\)$/) ?? []) : []
                    if (mm.length) {
                        const els = dimElements.get(dim)
                        if (els && !els.has(mm[1])) out.staleViewMembers.push({ where: `${cube}/${view}`, kind: 'title-selected', dim, member: mm[1], expr: id })
                    }
                }
            }
            for (const [axis, placements] of [['title', titles], ['row', rows], ['col', cols]]) {
                for (const p of placements) {
                    const expr = p.Subset?.Expression
                    if (!expr) continue
                    for (const ref of memberRefs(expr)) {
                        const els = dimElements.get(ref.dim)
                        if (els && !els.has(ref.member)) out.staleViewMembers.push({ where: `${cube}/${view}`, kind: `view-${axis}`, dim: ref.dim, member: ref.member, expr: expr.slice(0, 90) })
                    }
                }
            }
        }
    }

    // tm1project Ignore (check #4) — reported, informational, not a blocker
    try {
        const p = await c.get('!tm1project')
        if (p && typeof p === 'object' && Array.isArray(p.Ignore)) out.tm1projectIgnore = p.Ignore
        else if (typeof p === 'string' && p.trim()) {
            try { const j = JSON.parse(p); if (Array.isArray(j.Ignore)) out.tm1projectIgnore = j.Ignore } catch { /* not json */ }
        }
    } catch { /* no project file */ }

    const dedupe = arr => [...new Map(arr.map(x => [JSON.stringify(x), x])).values()]
    out.memberLessTitles = dedupe(out.memberLessTitles)
    out.staleViewMembers = dedupe(out.staleViewMembers)
    out.staleSubsetElements = dedupe(out.staleSubsetElements)
    out.roundTripNames = dedupe(out.roundTripNames)

    // Blocking = checks 1-3 (member-less, stale refs, round-trip names). Ignore is informational.
    const blockers = [...out.memberLessTitles.map(x => `view title without a selected member: ${x.cube}/${x.view} (dim ${x.dim})`),
        ...out.staleViewMembers.map(x => `stale member reference ${x.dim}.${x.member} (${x.where})`),
        ...out.staleSubsetElements.map(x => `static subset ${x.dim}/${x.subset} references missing element ${x.element}`),
        ...out.roundTripNames.map(x => `${x.kind} "${x.name}" — ${x.problem} (TM1 Git won't round-trip)`)]
    out.blockers = blockers
    out.ok = blockers.length === 0
    return out
}

// The Git push route's gate: run the readiness scan and return blockers verbatim.
async function pushReadiness(server, opts = {}) {
    const result = await scan(server, opts)
    return { ok: result.ok, blockers: result.blockers ?? [], readiness: result }
}

// ── First-pull safety analysis (IMPROVEMENTS 10.2) ──────────────────────────
// A first pull is TM1 Git's full overwrite — there is no "adopt current state".
// This clones the branch into a throwaway folder and compares it with the target:
// the pull-plan counts, objects that exist only on the target, and every element
// (in every hierarchy) the target would lose. Any read that fails makes the whole
// analysis incomplete; "couldn't check" is never reported as safe.

const EMPTY_PLAN = () => ({ create: 0, update: 0, delete: 0, skip: 0 })
const EMPTY_TARGET_ONLY = () => ({ cubes: [], dimensions: [], processes: [], chores: [] })
const EMPTY_RESULT = (reason, extra = {}) => ({
    complete: false,
    reason,
    deployedCommit: extra.deployedCommit ?? null,
    plan: extra.plan ?? EMPTY_PLAN(),
    targetOnly: EMPTY_TARGET_ONLY(),
    elementLoss: [],
    loss: { elements: 0, dimensions: 0 },
    confirmText: null,
})

const _tm1Message = (e) => e.response?.data?.error?.message ?? e.message
const _isControl = (name) => typeof name === 'string' && name.startsWith('}')
const _clean = (names) => names.filter(n => typeof n === 'string' && !_isControl(n))

function _readdir(dir) {
    try { return fs.readdirSync(dir, { withFileTypes: true }) }
    catch (e) { if (e.code === 'ENOENT') return []; throw e }
}

function _repoObjectNames(repoDir, folder, extensions) {
    const names = new Set()
    for (const ent of _readdir(path.join(repoDir, folder))) {
        if (!ent.isFile()) continue
        for (const ext of extensions) {
            if (ent.name.endsWith(ext)) names.add(ent.name.slice(0, -ext.length))
        }
    }
    return [...names]
}

// Read the cloned repo's objects. Every hierarchy file is parsed here, so a
// damaged file stops the analysis rather than looking like "no elements".
function _readRepo(repoDir) {
    const dimensions = new Set()
    const hierarchies = new Map()
    const dimDir = path.join(repoDir, 'dimensions')
    for (const ent of _readdir(dimDir)) {
        if (ent.isFile() && ent.name.endsWith('.json')) {
            dimensions.add(ent.name.slice(0, -'.json'.length))
        } else if (ent.isDirectory() && ent.name.endsWith('.hierarchies')) {
            const dim = ent.name.slice(0, -'.hierarchies'.length)
            dimensions.add(dim)
            const byHierarchy = new Map()
            const hDir = path.join(dimDir, ent.name)
            for (const h of _readdir(hDir)) {
                if (!h.isFile() || !h.name.endsWith('.json')) continue
                const hierarchy = h.name.slice(0, -'.json'.length)
                const full = path.join(hDir, h.name)
                let data
                try { data = JSON.parse(fs.readFileSync(full, 'utf8')) }
                catch (e) { throw new Error(`could not read repo file ${path.relative(repoDir, full)}: ${e.message}`, { cause: e }) }
                const els = Array.isArray(data?.Elements) ? data.Elements : Array.isArray(data?.elements) ? data.elements : []
                byHierarchy.set(hierarchy, els.map(e => e?.Name ?? e?.name).filter(n => typeof n === 'string'))
            }
            hierarchies.set(dim, byHierarchy)
        }
    }
    return {
        cubes: _repoObjectNames(repoDir, 'cubes', ['.json']),
        dimensions: [...dimensions],
        processes: _repoObjectNames(repoDir, 'processes', ['.json', '.ti']),
        chores: _repoObjectNames(repoDir, 'chores', ['.json', '.ti']),
        hierarchies,
    }
}

// Read the target's objects and every non-Leaves hierarchy's element names.
// Each read names its object in the error so the reason says what could not be
// checked.
async function _readTarget(c) {
    const get = async (route, object) => {
        try { return await c.get(route, { '$select': 'Name' }) }
        catch (e) { throw new Error(`${object}: ${_tm1Message(e)}`, { cause: e }) }
    }
    const names = async (route, object) => _clean(((await get(route, object)).value ?? []).map(x => x.Name))

    const cubes = await names('Cubes', 'Cubes')
    const processes = await names('Processes', 'Processes')
    const chores = await names('Chores', 'Chores')
    const dimensions = await names('Dimensions', 'Dimensions')

    const hierarchies = new Map()
    for (const dim of dimensions) {
        const hs = (await get(`Dimensions('${odataKey(dim)}')/Hierarchies`, `hierarchies of dimension ${dim}`)).value ?? []
        const byHierarchy = new Map()
        for (const h of hs.map(x => x.Name)) {
            if (String(h).toLowerCase() === 'leaves') continue
            const els = (await get(`Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(h)}')/Elements`, `elements of ${dim}/${h}`)).value ?? []
            byHierarchy.set(h, els.map(e => e.Name))
        }
        hierarchies.set(dim, byHierarchy)
    }
    return { cubes, dimensions, processes, chores, hierarchies }
}

function _planCounts(operations) {
    const plan = EMPTY_PLAN()
    for (const op of operations ?? []) {
        const m = String(op).match(/^(Create|Update|Delete|Skip)\s+(.+)$/)
        if (m) plan[m[1].toLowerCase()]++
    }
    return plan
}

async function firstPullAnalysis(server, opts = {}) {
    const c = _clientFor(server, opts)
    const token = opts.token ?? gitSecrets.getToken()
    const gitUser = opts.gitUser ?? gitIdentity.user()
    const branch = opts.branch ?? 'dev'
    let work = null

    try {
        let status
        try { status = await c.post('GitStatus', { Username: gitUser, Password: token }) }
        catch (e) { return EMPTY_RESULT(`GitStatus failed on ${server}: ${sanitize(_tm1Message(e), token)}`) }
        const deployedCommit = status?.DeployedCommit?.ID ?? null

        let pull
        try { pull = await c.post('GitPull', { Branch: branch, ExecutionMode: 'SingleCommit', Force: false, Username: gitUser, Password: token }) }
        catch (e) { return EMPTY_RESULT(`GitPull plan failed on ${server}: ${sanitize(_tm1Message(e), token)}`, { deployedCommit }) }
        const plan = _planCounts(pull.Operations)

        const repoUrl = opts.repoUrl ?? status?.URL
        if (!repoUrl) return EMPTY_RESULT(`Cannot compare ${server} with the repo: GitStatus returned no repository URL`, { deployedCommit, plan })

        work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1firstpull-'))
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token))
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        git(work, 'checkout', '-q', `origin/${branch}`)

        const repo = _readRepo(work)
        const target = await _readTarget(c)

        // Objects that exist only on the target. A target hierarchy the repo does
        // not have also makes its dimension target-only.
        const repoSets = {
            cubes: new Set(repo.cubes),
            dimensions: new Set(repo.dimensions),
            processes: new Set(repo.processes),
            chores: new Set(repo.chores),
        }
        const targetOnly = {
            cubes: target.cubes.filter(n => !repoSets.cubes.has(n)),
            dimensions: target.dimensions.filter(n => !repoSets.dimensions.has(n)),
            processes: target.processes.filter(n => !repoSets.processes.has(n)),
            chores: target.chores.filter(n => !repoSets.chores.has(n)),
        }
        for (const [dim, byHierarchy] of target.hierarchies) {
            const repoHierarchies = repo.hierarchies.get(dim)
            if (!repoHierarchies) continue
            for (const hierarchy of byHierarchy.keys()) {
                if (!repoHierarchies.has(hierarchy) && !targetOnly.dimensions.includes(dim)) targetOnly.dimensions.push(dim)
            }
        }
        for (const key of Object.keys(targetOnly)) targetOnly[key].sort()

        // Every repo hierarchy vs the same hierarchy on the target. Leaves is a
        // server-generated hierarchy and is never compared.
        const elementLoss = []
        for (const [dim, byHierarchy] of repo.hierarchies) {
            const targetHierarchies = target.hierarchies.get(dim)
            if (!targetHierarchies) continue
            for (const [hierarchy, repoElements] of byHierarchy) {
                if (String(hierarchy).toLowerCase() === 'leaves') continue
                const targetElements = targetHierarchies.get(hierarchy)
                if (!targetElements) continue
                const inRepo = new Set(repoElements)
                const missing = targetElements.filter(e => !inRepo.has(e))
                if (missing.length) {
                    elementLoss.push({ dimension: dim, hierarchy, count: missing.length, sample: missing.slice(0, 8) })
                }
            }
        }
        elementLoss.sort((a, b) => a.dimension.localeCompare(b.dimension) || a.hierarchy.localeCompare(b.hierarchy))
        const loss = {
            elements: elementLoss.reduce((sum, e) => sum + e.count, 0),
            dimensions: new Set(elementLoss.map(e => e.dimension)).size,
        }
        const confirmText = loss.elements
            ? `I understand this overwrites ${server} and removes ${loss.elements} elements in ${loss.dimensions} dimensions`
            : `I understand this overwrites ${server}`

        return { complete: true, reason: null, deployedCommit, plan, targetOnly, elementLoss, loss, confirmText }
    } catch (e) {
        return EMPTY_RESULT(`Could not analyse ${server}: ${sanitize(e.message, token)}`)
    } finally {
        if (work) fs.rmSync(work, { recursive: true, force: true })
    }
}

module.exports = { scan, pushReadiness, firstPullAnalysis, memberRefs }