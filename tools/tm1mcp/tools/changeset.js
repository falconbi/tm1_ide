'use strict'

const { z } = require('zod')

// ══════════════════════════════════════════════════════════════════════════════
// CHANGE SET — the deployment-workflow gate
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { SERVER, AGENT_USER, cl, assertions, runAssertions, ok }) {
    server.tool(
        'seed_baseline',
        'Snapshot the current server state as a new deployment baseline (append-only — nothing is overwritten). ' +
        'Run this at the start of a release window and again AFTER a deploy. The snapshot is stamped with the ' +
        'change-log position so releases window on change-set id, not a timestamp. Use list_baselines / ' +
        'set_baseline_head to inspect history or roll the reference point back.',
        {
            label: z.string().optional().describe('Short label for this baseline, e.g. "post rev D" or "release 2026-09"'),
        },
        async ({ label }) => {
            let seed
            try { ({ seed } = require('../../../tools/tm1deploy/src/snapshot')) }
            catch (e) { return ok(`Deploy tooling not available: ${e.message}`) }
            const extraMeta = { last_entry_id: cl.getMaxEntryId(SERVER) }
            if (label) extraMeta.label = label
            const result = await seed(SERVER, null, null, extraMeta)
            const c = result?._meta?.counts ?? {}
            return ok(`Baseline seeded from "${SERVER}" at ${result?._meta?.seeded_at ?? 'now'} ` +
                `(change-log position ${result?._meta?.last_entry_id ?? '?'}${label ? `, "${label}"` : ''}) — ` +
                `${c.dimensions ?? '?'} dims, ${c.cubes ?? '?'} cubes, ${c.processes ?? '?'} processes. Append-only; HEAD moved to it.`)
        }
    )

    server.tool(
        'list_baselines',
        'List this server\'s append-only baseline history — timestamp, label, change-log position, object counts, and which one is HEAD.',
        {},
        async () => {
            try {
                const { listBaselines } = require('../../../tools/tm1deploy/src/diff')
                const rows = listBaselines(SERVER)
                return rows.length ? ok(rows) : ok(`No baselines for "${SERVER}" yet — run seed_baseline.`)
            } catch (e) { return ok(`list failed: ${e.message}`) }
        }
    )

    server.tool(
        'set_baseline_head',
        'Move the baseline HEAD to an earlier snapshot from list_baselines. Reference-only — it does not touch the server, ' +
        'it changes which baseline diff / release / drift compare against. Use it to recover from a mistimed seed_baseline.',
        {
            file: z.string().describe('Baseline file name from list_baselines, e.g. "2026-09-07T01-30-00-000Z.json"'),
        },
        async ({ file }) => {
            try {
                const { setBaselineHead } = require('../../../tools/tm1deploy/src/diff')
                const r = setBaselineHead(SERVER, file)
                return ok(`HEAD for "${SERVER}" → ${r.head} (position ${r._meta?.last_entry_id ?? '?'}, seeded ${r._meta?.seeded_at ?? '?'}).`)
            } catch (e) { return ok(`set failed: ${e.message}`) }
        }
    )

    server.tool(
        'start_change_set',
        'Open a new change set on this server. Call this FIRST, before any model changes. Every create/update/delete is recorded against the open change set so it can be reviewed and deployed through the IDE pipeline.',
        {
            name: z.string().describe('Change set name — e.g. "AI: Working Capital model". Prefix with "AI:" so it is identifiable in the IDE.'),
        },
        async ({ name }) => {
            const existing = cl.getActiveSession(SERVER)
            if (existing) {
                return ok(`A change set is already open on "${SERVER}": "${existing.name}" (id ${existing.id}, started ${existing.started_at}). Close it first, or continue using it.`)
            }
            const s = cl.startSession(name, SERVER, AGENT_USER)
            return ok(`Change set opened: "${s.name}" (id ${s.id}) on server "${SERVER}". All subsequent model changes will be recorded here.`)
        }
    )

    server.tool(
        'close_change_set',
        'Close the open change set on this server. Do this when the model build is complete and ready for review. ' +
        'If the server has stored assertions, they are run and the result is included.',
        {},
        async () => {
            const s = cl.getActiveSession(SERVER)
            if (!s) return ok(`No change set is open on "${SERVER}".`)
            cl.closeSession(s.id)
            const entries = cl.getSessionLog(s.id)

            let assertLine = ''
            if (assertions.list(SERVER).length) {
                const a = await runAssertions()
                assertLine = `\nAssertions: ${a.passed}/${a.total} passing.`
                if (a.failed.length) {
                    assertLine += ' FAILING — ' + a.failed.map(f =>
                        `${f.description || f.id}: ${f.error ? `error (${f.error})` : `expected ${f.expected}, got ${f.actual}`}`
                    ).join(' | ')
                }
            }

            return ok(`Change set "${s.name}" (id ${s.id}) closed with ${entries.length} object change(s).${assertLine}\n` +
                `Next: package_change_set to build the deployable, then check_deploy_risk / check_target_drift against a target. Deploy is a human step (IDE Deploy panel).`)
        }
    )

    server.tool(
        'get_change_set',
        'Show the open change set and every object change recorded in it so far',
        {},
        async () => {
            const s = cl.getActiveSession(SERVER)
            if (!s) return ok(`No change set is open on "${SERVER}". Call start_change_set to begin.`)
            const entries = cl.getSessionLog(s.id)
            const grouped = {}
            for (const e of entries) {
                (grouped[e.object_type] ??= []).push({ action: e.action, name: e.object_name, detail: e.detail })
            }
            return ok({ change_set: { id: s.id, name: s.name, started_at: s.started_at }, object_count: entries.length, changes: grouped })
        }
    )

    server.tool(
        'diff_change_set',
        'Diff the open change set against the deployment baseline (if one has been seeded in the IDE). Use this to self-review before handing the model off for deployment.',
        {},
        async () => {
            const s = cl.getActiveSession(SERVER)
            if (!s) return ok(`No change set is open on "${SERVER}".`)
            const entries = cl.getSessionLog(s.id)
            let diffMod
            try { diffMod = require('../../../tools/tm1deploy/src/diff') } catch { diffMod = null }
            if (!diffMod || !diffMod.loadBaseline(null, SERVER)) {
                return ok({
                    note: `No baseline seeded for "${SERVER}" yet — call seed_baseline first for a full diff. Raw change set contents:`,
                    changes: entries.map(e => ({ type: e.object_type, action: e.action, name: e.object_name, detail: e.detail })),
                })
            }
            try {
                const result = await diffMod.diff(SERVER, entries, undefined, null)
                return ok(result)
            } catch (e) {
                return ok({ error: `diff failed: ${e.message}`, changes: entries.map(x => ({ type: x.object_type, action: x.action, name: x.object_name })) })
            }
        }
    )

    server.tool(
        'package_change_set',
        'Build a deployable package from the open change set (or, with release:true, every object changed since the baseline was seeded). Writes a self-contained folder under packages/ — the same artifact the IDE Deploy panel produces, including a bundled baseline. Does NOT deploy anything. Hand the returned path to a human to review and deploy, or run check_deploy_risk against a target first.',
        {
            release: z.boolean().optional().describe('Package every object changed since the baseline, not just the open change set'),
        },
        async ({ release }) => {
            let pack
            try { ({ pack } = require('../../../tools/tm1deploy/src/packager')) }
            catch (e) { return ok(`Deploy tooling not available: ${e.message}`) }

            let entries, name
            if (release) {
                let base = null
                try {
                    const { loadBaseline } = require('../../../tools/tm1deploy/src/diff')
                    base = loadBaseline(null, SERVER)
                } catch { /* no baseline — fall back to all-time */ }
                const sinceId = base?._meta?.last_entry_id
                entries = sinceId != null
                    ? cl.getEntriesSinceId(SERVER, sinceId)
                    : cl.getEntriesSince(SERVER, base?._meta?.seeded_at ?? null)
                name = `Release ${new Date().toISOString().slice(0, 10)}`
            } else {
                const s = cl.getActiveSession(SERVER)
                if (!s) return ok(`No change set is open on "${SERVER}". Open one, or call with release:true.`)
                entries = cl.getSessionLog(s.id)
                name = s.name
            }
            if (!entries.length) return ok(`Nothing to package — no recorded changes${release ? ' since the baseline' : ' in the open change set'}.`)

            try {
                const result = await pack(SERVER, entries, name, {}, null)
                if (!result.packaged) {
                    return ok({ packaged: 0, outputDir: null, note: 'Every changed object already matches the baseline — nothing to deploy.' })
                }
                return ok({
                    packaged:  result.packaged,
                    skipped:   result.skipped,
                    outputDir: result.outputDir,
                    objects:   (result.manifest?.objects ?? []).map(o => ({ type: o.type, name: o.name, detail: o.detail ?? undefined, outcome: o.outcome })),
                    next: 'Review this package. Deploy it from the IDE (Import Package tab if on another machine), or run check_deploy_risk / check_target_drift against a target first. This tool does not deploy.',
                })
            } catch (e) { return ok(`package failed: ${e.message}`) }
        }
    )
}

module.exports = { register }
