'use strict'

const { z } = require('zod')

// ══════════════════════════════════════════════════════════════════════════════
// DIAGNOSTICS
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { client, ok }) {
    server.tool(
        'get_process_log',
        'Get the most recent error-log file(s) for a TI process (TM1 v11 has no execution-log entity — this reads TM1ProcessError_*.log files)',
        {
            process: z.string().describe('Process name'),
            files:   z.number().int().min(1).max(10).optional().describe('How many recent log files to return content for (default 1)'),
        },
        async ({ process, files = 1 }) => {
            const c   = client()
            const all = await c.getErrorLogFiles()
            const mine = (all ?? [])
                .map(f => f.Filename ?? f)
                .filter(fn => fn.toLowerCase().includes(process.toLowerCase()))
                .sort()
                .reverse()
            if (!mine.length) return ok(`No error-log files found for process "${process}".`)
            const pick = mine.slice(0, files)
            const out  = []
            for (const fn of pick) {
                const content = await c.getErrorLogContent(fn).catch(e => `(could not read: ${e.message})`)
                out.push({ file: fn, content })
            }
            return ok(out)
        }
    )

    server.tool(
        'get_active_threads',
        'List currently active threads on the TM1 server — useful for spotting long-running processes',
        {},
        async () => {
            const threads = await client().getThreads()
            return ok(threads.value ?? threads)
        }
    )

    server.tool(
        'get_transaction_log',
        'Get recent cell-write transactions for a cube — who changed what and when. ' +
        'On a busy server, a cube with no writes in the last ~10k transactions may return nothing.',
        {
            cube:  z.string().describe('Cube name'),
            limit: z.number().int().min(1).max(500).optional().describe('Max entries (default 100)'),
            coordinates: z.record(z.string()).optional().describe('{ "DimA": "ElemA", ... } to filter to one cell intersection'),
        },
        async ({ cube, limit = 100, coordinates }) => {
            const c = client()
            let elements = null
            if (coordinates) {
                const order = ((await c.getCube(cube))?.Dimensions ?? []).map(d => d.Name)
                elements = order.map(d => coordinates[d] ?? null)
            }
            const rows = await c.getTransactionLog(cube, { top: limit, elements })
            return ok(rows.map(r => ({
                time: r.TimeStamp, user: r.User, tuple: r.Tuple,
                old: r.OldValue, new: r.NewValue,
            })))
        }
    )

    server.tool(
        'list_error_logs',
        'List server error-log files available on the TM1 server',
        {},
        async () => {
            const files = await client().getErrorLogFiles()
            return ok(files)
        }
    )

    server.tool(
        'execute_view',
        'Run a cube view and return the cell data — useful for understanding what is in a cube or verifying a build',
        {
            cube:  z.string().describe('Cube name'),
            view:  z.string().describe('View name'),
            limit: z.number().int().min(1).max(50_000).optional().describe('Max cell count (default 2000)'),
        },
        async ({ cube, view, limit = 2000 }) => {
            const res   = await client().executeView(cube, view, limit)
            const cells = (res.Cells ?? []).map(x => ({ ordinal: x.Ordinal, value: x.Value, formatted: x.FormattedValue }))
            return ok({ view_type: res.ViewType ?? null, cell_count: cells.length, truncated: res.truncated ?? false, cells })
        }
    )

    server.tool(
        'find_dimension_usage',
        'Find every cube that uses a dimension, and every TI process whose code references it — useful before renaming or deleting a dimension',
        { dimension: z.string().describe('Dimension name') },
        async ({ dimension }) => ok(await client().scanDimensionUsage(dimension))
    )

    server.tool(
        'find_cube_usage',
        'Find every TI process whose code references a cube by name — useful before renaming or deleting a cube',
        { cube: z.string().describe('Cube name') },
        async ({ cube }) => ok(await client().scanCubeUsage(cube))
    )

    server.tool(
        'find_process_usage',
        'Find every chore that runs a given TI process',
        { process: z.string().describe('Process name') },
        async ({ process }) => ok(await client().scanProcessUsage(process))
    )

    server.tool(
        'search_ti_code',
        'Regex search across all TI process code (Prolog, Metadata, Data, Epilog) — find which processes reference a cube, dimension, variable, or any text pattern',
        {
            pattern:        z.string().describe('Search string or regex pattern'),
            case_sensitive: z.boolean().optional().describe('Case sensitive search (default false)'),
        },
        async ({ pattern, case_sensitive = false }) => {
            const processes = await client().getProcesses()
            const regex = new RegExp(pattern, case_sensitive ? '' : 'i')
            const hits = []
            for (const name of processes) {
                try {
                    const p = await client().getProcess(name)
                    const sections = {
                        Prolog:   p.PrologProcedure ?? '',
                        Metadata: p.MetaDataProcedure ?? '',
                        Data:     p.DataProcedure ?? '',
                        Epilog:   p.EpilogProcedure ?? '',
                    }
                    const matched = []
                    for (const [section, code] of Object.entries(sections)) {
                        code.split('\n').forEach((line, i) => {
                            if (regex.test(line)) matched.push({ section, line: i + 1, text: line.trim() })
                        })
                    }
                    if (matched.length) hits.push({ process: name, matches: matched })
                } catch { /* skip */ }
            }
            return ok(hits)
        }
    )
}

module.exports = { register }
