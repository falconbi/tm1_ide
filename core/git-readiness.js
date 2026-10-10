'use strict'

// ── Git readiness check (IMPROVEMENTS 10.2) ─────────────────────────────────
// Must pass before any push. TM1 tolerates stale references at runtime but its
// Git import does not — one view with a member-less or stale title blocks the
// whole pull. This scan finds the problems so the deploy risk check can block
// before anything is pushed, and it runs on demand / cross-server too.
//
//   scan(server, opts)          — four checks; returns findings
//   firstPullAnalysis(server)   — pull-plan operations + full-overwrite warning
//                                 (+ element-loss comparison when repoDir given)

const { makeClient } = require('./adapter_registry')
const gitIdentity = require('./git-identity')
const { odataKey } = require('./odata-key')

// Names TM1 Git is known not to round-trip (check #3): a comma in a subset/view name.
function roundTripProblem(name) {
    if (typeof name === 'string' && name.includes(',')) return 'comma in name'
    return null
}

// Extract [Dim].[Hier].[Member] triplets from an MDX expression.
function memberRefs(expr) {
    const out = []
    if (!expr) return out
    const re = /\[([^\]\[]+)\]\.\[([^\]\[]+)\]\.\[([^\]\[]+)\]/g
    let m
    while ((m = re.exec(expr))) out.push({ dim: m[1], hier: m[2], member: m[3] })
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
        let views = []
        try { views = ((await c.get(`Cubes('${odataKey(cube)}')/Views?$select=Name`)).value ?? []).map(v => v.Name) } catch { continue }
        for (const view of views) {
            const bad = roundTripProblem(view)
            if (bad) out.roundTripNames.push({ kind: 'view', name: view, cube, problem: bad })
            let rows = [], cols = [], titles = []
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

// ── First-pull safety analysis (IMPROVEMENTS 10.2) ──────────────────────────
// For a populated target that is about to receive its first pull: TM1 Git has no
// "adopt current state" action, so the first pull is a full overwrite. Analyze the
// pull plan and (when a repo clone is available) element-loss risk.
async function firstPullAnalysis(server, opts = {}) {
    const c = _clientFor(server, opts)
    const token = opts.token ?? process.env.TM1_GIT_TOKEN ?? ''
    const repoDir = opts.repoDir ?? null
    const out = { server, warnings: [], notes: [], ok: true }

    let status
    try { status = await c.post('GitStatus', { Username: opts.gitUser ?? gitIdentity.user(), Password: token }) }
    catch (e) { out.warnings.push(`GitStatus failed: ${e.response?.data?.error?.message ?? e.message}`); return out }

    const deployed = status?.DeployedCommit
    if (deployed?.ID) {
        out.notes.push(`Target has a baseline (deployed commit ${deployed.ID}) — a pull would show only the change, not a full overwrite.`)
    } else {
        out.warnings.push('Target has NO deployed commit — its first pull will be a FULL OVERWRITE of every object. No "adopt current state" action exists in TM1 Git.')
    }

    const branch = opts.branch ?? 'dev'
    let plan
    try { plan = await c.post('GitPull', { Branch: branch, ExecutionMode: 'SingleCommit', Force: false, Username: opts.gitUser ?? gitIdentity.user(), Password: token }) }
    catch (e) { out.warnings.push(`GitPull plan failed: ${e.response?.data?.error?.message ?? e.message} (the repo may not be initialized, or a view in the source breaks the pull — run the readiness scan).`); return out }

    const ops = plan.Operations ?? []
    const byType = {}
    for (const op of ops) {
        const m = String(op).match(/^(Create|Update|Delete|Skip)\s+(.+)$/) || [null, 'Other', String(op)]
        ;(byType[m[1]] ??= []).push(m[2])
    }
    out.plan = { total: ops.length, create: (byType.Create ?? []).length, update: (byType.Update ?? []).length, delete: (byType.Delete ?? []).length, skip: (byType.Skip ?? []).length }
    if (byType.Delete?.length) {
        out.warnings.push(`Pull plan contains ${byType.Delete.length} DELETE operations (TM1 Git normally emits none — deletes may not propagate; verify by hand).`)
        out.ok = false
    }

    // Element-loss comparison (needs a repo clone — the pull plan itself is object-level)
    if (repoDir) {
        const fs = require('fs')
        const path = require('path')
        const dimDirs = fs.existsSync(path.join(repoDir, 'dimensions')) ? fs.readdirSync(path.join(repoDir, 'dimensions')) : []
        const lost = []
        for (const f of dimDirs.filter(x => x.endsWith('.json') && !x.includes('.hierarchies'))) {
            const dim = f.slice(0, -5)
            let repoEls = []
            try { repoEls = JSON.parse(fs.readFileSync(path.join(repoDir, 'dimensions', dim, `${dim}.hierarchies`, `${dim}.json`))).Elements.map(e => e.Name) } catch { continue }
            let targetEls = []
            try { targetEls = (await c.get(`Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(dim)}')/Elements?$select=Name`)).value.map(e => e.Name) } catch { continue }
            const missing = targetEls.filter(e => !repoEls.includes(e))
            if (missing.length) lost.push({ dim, count: missing.length, sample: missing.slice(0, 8) })
        }
        out.elementLoss = lost
        if (lost.length) out.warnings.push(`Element loss risk: ${lost.map(l => `${l.dim} (${l.count})`).join(', ')} — these target elements are not in the repo and would be removed with their data.`)
    } else {
        out.notes.push('Element-loss comparison skipped (no repoDir provided). Provide a repo clone to check for target elements missing from the repo.')
    }

    return out
}

module.exports = { scan, firstPullAnalysis, memberRefs }