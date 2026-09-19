'use strict'

const { z } = require('zod')

// ══════════════════════════════════════════════════════════════════════════════
// DEVELOPMENT — WRITE (existing tools, now change-set gated + logged)
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { client, ok, esc, logChange, requireChangeSet, lintRules, lintTI }) {
    server.tool(
        'update_cube_rules',
        'Write new rules to a cube. The full rules text replaces any existing rules. Requires an open change set. ' +
        'A static lint runs first — errors block the write (pass force:true to override); warnings are reported but do not block. ' +
        'The rules are then CheckRules-validated on the server before writing, so TM1 compiler errors surface here immediately instead of at deploy time.',
        {
            cube:  z.string().describe('Cube name'),
            rules: z.string().describe('Complete rules text to write'),
            force: z.boolean().optional().describe('Write even if the static lint or CheckRules found errors'),
        },
        async ({ cube, rules, force }) => {
            requireChangeSet()
            const lint = lintRules(rules)
            if (lint.errors.length && !force) {
                return ok({
                    refused: 'static rule lint found errors — fix them, or pass force:true to write anyway',
                    errors:  lint.errors,
                    warnings: lint.warnings,
                })
            }
            const c    = client()
            const prev = await c.get(`Cubes('${esc(cube)}')`, { '$select': 'Rules' }).then(d => d.Rules ?? '').catch(() => '')

            // Live TM1 compile check — the real safety net static lint can't provide.
            const check  = await c.post(`Cubes('${esc(cube)}')/tm1.CheckRules`, { Rules: rules }).catch(e => ({ _error: e.message }))
            const errors = check?.value ?? []
            const details = errors.map(e => ({ line: e.LineNumber ?? null, message: e.Message ?? e.Description ?? String(e) }))

            if (check?._error) {
                return ok({
                    refused: `rules NOT written — CheckRules could not run (${check._error}); no change made to "${cube}"`,
                    errors:  [],
                    lint_warnings: lint.warnings,
                })
            }
            if (details.length && !force) {
                return ok({
                    refused: `rules NOT written — TM1 CheckRules found ${details.length} error(s) in "${cube}"; no change made. Fix them, or pass force:true to write anyway.`,
                    errors:  details,
                    lint_warnings: lint.warnings,
                })
            }

            await c.patch(`Cubes('${esc(cube)}')`, { Rules: rules })
            logChange('RULES_SAVED', 'rules', cube, { before: { text: prev }, after: { text: rules } })

            const parts = []
            if (lint.warnings.length) parts.push(`lint warnings: ${lint.warnings.map(w => w.message).join(' | ')}`)
            if (details.length) parts.push(`NOTE: rules written despite ${details.length} CheckRules error(s): ${JSON.stringify(details.slice(0, 10))}`)
            return ok(`Rules updated for cube "${cube}".${parts.length ? ` ${parts.join('. ')}` : ''}`)
        }
    )

    server.tool(
        'update_process',
        'Update one or more sections of a TI process. Only the sections you supply are changed. Requires an open change set. ' +
        'The full merged process is static-linted; errors block the write unless force:true.',
        {
            process:  z.string().describe('Process name'),
            prolog:   z.string().optional(),
            metadata: z.string().optional(),
            data:     z.string().optional(),
            epilog:   z.string().optional(),
            force:    z.boolean().optional().describe('Write even if the static TI lint found errors'),
        },
        async ({ process, prolog, metadata, data, epilog, force }) => {
            requireChangeSet()
            const c   = client()
            const cur = await c.get(`Processes('${esc(process)}')`)
            const patch = {}
            if (prolog   !== undefined) patch.PrologProcedure   = prolog
            if (metadata !== undefined) patch.MetaDataProcedure = metadata
            if (data     !== undefined) patch.DataProcedure     = data
            if (epilog   !== undefined) patch.EpilogProcedure   = epilog

            const lint = lintTI({
                prolog:   patch.PrologProcedure   ?? cur.PrologProcedure   ?? '',
                metadata: patch.MetaDataProcedure ?? cur.MetaDataProcedure ?? '',
                data:     patch.DataProcedure     ?? cur.DataProcedure     ?? '',
                epilog:   patch.EpilogProcedure   ?? cur.EpilogProcedure   ?? '',
            })
            if (lint.errors.length && !force) {
                return ok({ refused: 'static TI lint found errors on the merged process — not written. Fix, or pass force:true.', errors: lint.errors, warnings: lint.warnings })
            }

            await c.patch(`Processes('${esc(process)}')`, patch)
            logChange('PROCESS_SAVED', 'process', process, {
                before: { prolog: cur.PrologProcedure ?? '', metadata: cur.MetaDataProcedure ?? '', data: cur.DataProcedure ?? '', epilog: cur.EpilogProcedure ?? '' },
                after:  { prolog: patch.PrologProcedure ?? cur.PrologProcedure ?? '', metadata: patch.MetaDataProcedure ?? cur.MetaDataProcedure ?? '', data: patch.DataProcedure ?? cur.DataProcedure ?? '', epilog: patch.EpilogProcedure ?? cur.EpilogProcedure ?? '' },
            })
            const note = lint.warnings.length ? ` (lint warnings: ${lint.warnings.map(w => `[${w.section}] ${w.message}`).join(' | ')})` : ''
            return ok(`Process "${process}" updated (sections: ${Object.keys(patch).join(', ') || 'none'}).${note}`)
        }
    )

    server.tool(
        'run_process',
        'Execute a TI process on the server. Returns success or the error message. Does not require a change set (execution, not a metadata change).',
        {
            process:    z.string().describe('Process name'),
            parameters: z.record(z.union([z.string(), z.number()])).optional().describe('Parameter values as {name: value}'),
        },
        async ({ process, parameters }) => {
            const result = await client().executeProcess(process, parameters ?? {})
            const status = result?.ProcessExecuteStatusCode ?? result?.Status ?? 'completed'
            return ok({ status, result })
        }
    )

    server.tool(
        'check_rules_syntax',
        'Validate rules without writing. Runs a static lint (arg counts, hierarchy-function misuse, IF nesting — things TM1\'s own checker misses) AND the live server CheckRules.',
        {
            cube:  z.string().describe('Cube name'),
            rules: z.string().describe('Rules text to validate'),
        },
        async ({ cube, rules }) => {
            const lint   = lintRules(rules)
            const result = await client().post(`Cubes('${esc(cube)}')/tm1.CheckRules`, { Rules: rules }).catch(e => ({ _error: e.message }))
            const tm1Errors = (result?.value ?? []).map(e => ({ line: e.LineNumber, message: e.Message ?? e.Description }))

            const out = {}
            if (lint.errors.length)   out.static_errors   = lint.errors
            if (lint.warnings.length) out.static_warnings = lint.warnings
            if (result?._error)       out.tm1_check       = `could not run: ${result._error}`
            else if (tm1Errors.length) out.tm1_errors     = tm1Errors

            if (!Object.keys(out).length) return ok('OK — static lint and TM1 CheckRules both clean')
            return ok(out)
        }
    )

    server.tool(
        'check_feeders',
        'Recalculate feeder propagation for all of a cube\'s rules (the REST equivalent of Architect "Check Feeders"). ' +
        'Run this after writing or changing feeders — it makes rule-calculated leaf values visible to consolidations and cross-cube reads. Does not need a change set.',
        { cube: z.string().describe('Cube name') },
        async ({ cube }) => {
            try {
                await client().checkFeedersForRules(cube)
                return ok(`Feeders recalculated for "${cube}". Verify consolidated totals with read_cells.`)
            } catch (e) {
                const m = e.response?.data?.error?.message ?? e.message
                if (/not supported|resolved|404/i.test(m)) return ok(`Feeder recalculation is not supported on this TM1 version (${m}).`)
                throw e
            }
        }
    )

    server.tool(
        'trace_feeders',
        'Show which cells feed a given cube intersection — the answer to "is this cell fed, and from where". ' +
        'An empty result for a cell that has a rule value means it is under-fed (the consolidation above it will read blank).',
        {
            cube:        z.string().describe('Cube name'),
            coordinates: z.record(z.string()).describe('{ "DimA": "ElemA", ... } — one entry per cube dimension'),
        },
        async ({ cube, coordinates }) => {
            const c = client()
            const order = ((await c.getCube(cube))?.Dimensions ?? []).map(d => d.Name)
            const missing = order.filter(d => coordinates[d] == null)
            if (missing.length) return ok(`Missing coordinates for: ${missing.join(', ')}. Cube order is [${order.join(', ')}].`)
            const pairs = order.map(d => ({ dim: d, element: coordinates[d] }))
            const feeders = await c.checkFeedersOfCell(cube, pairs).catch(e => ({ _error: e.response?.data?.error?.message ?? e.message }))
            if (feeders?._error) return ok(`Could not trace feeders (${feeders._error}).`)
            if (!feeders.length) return ok({ fed: false, note: 'No feeders reach this cell. If it has a rule value, the consolidations above it will read blank — add a feeder.' })
            return ok({ fed: true, feeder_count: feeders.length, feeders: feeders.slice(0, 50) })
        }
    )
}

module.exports = { register }
