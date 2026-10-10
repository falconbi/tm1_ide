'use strict'

// ── Model health (v1) ────────────────────────────────────────────────────────
// One screen: "does the model compute right, would TM1 Git accept it, and does
// it meet the house standards". Aggregates:
//   assertions  — the model's own tests (from the model store)
//   git_readiness — IMPROVEMENTS 10.2 four checks
//   house_standards — every cube has a view named "Default", every dimension a
//                     subset named "Default" (the non-negotiable rule)
// Checks run on demand (POST /api/model-health) — never on screen open.

const { makeClient } = require('./adapter_registry')
const assertions = require('./assertions')
const { scan: gitScan } = require('./git-readiness')
const { odataKey } = require('./odata-key')

// House standards: cubes without a view named "Default", dimensions without a
// subset named "Default". Control objects (}) are excluded.
async function houseStandards(server, opts = {}) {
    const c = opts.client ?? makeClient(server, opts.ideToken ?? null)
    const out = { ok: true, cubesWithoutDefaultView: [], dimsWithoutDefaultSubset: [] }

    const cubes = ((await c.get('Cubes', { '$select': 'Name' })).value ?? []).map(x => x.Name).filter(n => !n.startsWith('}'))
    for (const cube of cubes) {
        let views = []
        try { views = ((await c.get(`Cubes('${odataKey(cube)}')/Views?$select=Name`)).value ?? []).map(v => v.Name) } catch { continue }
        if (!views.includes('Default')) out.cubesWithoutDefaultView.push(cube)
    }

    const dims = ((await c.get('Dimensions', { '$select': 'Name' })).value ?? []).map(d => d.Name).filter(n => !n.startsWith('}'))
    for (const dim of dims) {
        let subs = []
        try { subs = ((await c.get(`Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(dim)}')/Subsets?$select=Name`)).value ?? []).map(s => s.Name) } catch { continue }
        if (!subs.includes('Default')) out.dimsWithoutDefaultSubset.push(dim)
    }

    out.ok = out.cubesWithoutDefaultView.length === 0 && out.dimsWithoutDefaultSubset.length === 0
    return out
}

// Run the full health check for a server.
async function check(server, opts = {}) {
    const ideToken = opts.ideToken
    const results = { server, checked_at: new Date().toISOString(), sections: {}, ok: true }

    // Assertions (from the model store; config fallback). Run, don't just list.
    try {
        const a = await assertions.run(server, { ideToken })
        const byKind = { behaviour: { total: 0, passed: 0, failed: 0 }, control: { total: 0, passed: 0, failed: 0 } }
        for (const r of a.results ?? []) {
            const k = (r.kind ?? 'behaviour') === 'control' ? 'control' : 'behaviour'
            byKind[k].total++
            if (r.pass) byKind[k].passed++; else byKind[k].failed++
        }
        results.sections.assertions = {
            ok: a.failed.length === 0,
            source: a.source,
            total: a.total, passed: a.passed, failed: a.failed.length,
            by_kind: byKind,
            failures: a.failed.map(f => ({ id: f.id, description: f.description, mdx: f.mdx ?? '', tags: f.tags ?? [], kind: f.kind ?? 'behaviour', severity: f.severity ?? 'block', expected: f.expected, actual: f.actual, error: f.error ?? null })),
        }
        if (!results.sections.assertions.ok) results.ok = false
    } catch (e) {
        results.sections.assertions = { ok: false, error: e.message }
        results.ok = false
    }

    // Git readiness — the four checks
    try {
        const r = await gitScan(server, { ideToken })
        results.sections.git_readiness = {
            ok: r.ok,
            memberLessTitles: r.memberLessTitles,
            staleViewMembers: r.staleViewMembers,
            staleSubsetElements: r.staleSubsetElements,
            roundTripNames: r.roundTripNames,
            tm1projectIgnore: r.tm1projectIgnore,
        }
        if (!r.ok) results.ok = false
    } catch (e) {
        results.sections.git_readiness = { ok: false, error: e.message }
        results.ok = false
    }

    // House standards — Default view per cube, Default subset per dimension
    try {
        results.sections.house_standards = await houseStandards(server, { ideToken })
        if (!results.sections.house_standards.ok) results.ok = false
    } catch (e) {
        results.sections.house_standards = { ok: false, error: e.message }
        results.ok = false
    }

    return results
}

module.exports = { check, houseStandards }