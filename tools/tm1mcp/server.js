#!/usr/bin/env node
'use strict'

// tm1mcp — MCP server exposing TM1 model context and dev tools to AI agents
// Usage:  node tools/tm1mcp/server.js --server <name>
// Claude: claude mcp add tm1 -- node /path/to/tools/tm1mcp/server.js --server 24Retail

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })

const { McpServer }          = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z }                  = require('zod')
const { makeClient }         = require('../../core/adapter_registry')

// ── Config ────────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2)
const srvIdx    = args.indexOf('--server')
const SERVER    = srvIdx !== -1 ? args[srvIdx + 1] : (process.env.TM1_MCP_SERVER ?? null)

if (!SERVER) {
    process.stderr.write('tm1mcp: specify a server with --server <name> or TM1_MCP_SERVER env var\n')
    process.exit(1)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function client() { return makeClient(SERVER, null) }

function ok(data) {
    return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] }
}

const esc = s => encodeURIComponent(s)

// ── Server ────────────────────────────────────────────────────────────────────

const server = new McpServer({
    name:    'tm1-ide',
    version: '1.0.0',
})

// ══════════════════════════════════════════════════════════════════════════════
// MODEL CONTEXT — READ
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
    'list_cubes',
    'List all model (non-control) cube names on the TM1 server',
    {},
    async () => {
        const cubes = await client().getModelCubes()
        return ok(cubes.map(c => c.Name ?? c))
    }
)

server.tool(
    'get_cube_rules',
    'Get the rules text for a cube',
    { cube: z.string().describe('Cube name') },
    async ({ cube }) => {
        const data = await client().get(`Cubes('${esc(cube)}')`, { '$select': 'Name,Rules' })
        return ok(data.Rules ?? '(no rules)')
    }
)

server.tool(
    'get_cube_dimensions',
    'Get the ordered list of dimensions for a cube',
    { cube: z.string().describe('Cube name') },
    async ({ cube }) => {
        const data = await client().get(
            `Cubes('${esc(cube)}')/Dimensions`,
            { '$select': 'Name' }
        )
        return ok((data.value ?? []).map(d => d.Name))
    }
)

server.tool(
    'list_dimensions',
    'List all model (non-control) dimension names',
    {},
    async () => {
        const dims = await client().getModelDimensions()
        return ok(dims.map(d => d.Name ?? d))
    }
)

server.tool(
    'get_elements',
    'Get elements for a dimension with type (N=numeric, C=consolidated, S=string) and level',
    {
        dimension: z.string().describe('Dimension name'),
        include_tree: z.boolean().optional().describe('Include parent/child relationships (slower)'),
    },
    async ({ dimension, include_tree }) => {
        const c = client()
        const elems = include_tree
            ? await c.getElementsWithTree(dimension)
            : await c.getElements(dimension)
        return ok(elems)
    }
)

server.tool(
    'list_processes',
    'List all model (non-control) TI process names',
    {},
    async () => {
        const procs = await client().getProcesses()
        return ok((procs.value ?? procs).map(p => p.Name ?? p).filter(n => !n.startsWith('}')))
    }
)

server.tool(
    'get_process',
    'Get a TI process — all four code sections, parameters, and datasource configuration',
    { process: z.string().describe('Process name') },
    async ({ process }) => {
        const p = await client().get(`Processes('${esc(process)}')`)
        return ok({
            name:       p.Name,
            parameters: p.Parameters ?? [],
            datasource: p.DataSources?.[0] ?? null,
            prolog:     p.PrologProcedure   ?? '',
            metadata:   p.MetaDataProcedure ?? '',
            data:       p.DataProcedure     ?? '',
            epilog:     p.EpilogProcedure   ?? '',
        })
    }
)

server.tool(
    'list_views',
    'List views for a cube',
    { cube: z.string().describe('Cube name') },
    async ({ cube }) => {
        const data = await client().get(`Cubes('${esc(cube)}')/Views`, { '$select': 'Name' })
        return ok((data.value ?? []).map(v => v.Name))
    }
)

server.tool(
    'get_view',
    'Get the definition of a cube view (MDX or native subset references)',
    {
        cube: z.string().describe('Cube name'),
        view: z.string().describe('View name'),
    },
    async ({ cube, view }) => {
        const data = await client().get(`Cubes('${esc(cube)}')/Views('${esc(view)}')`)
        return ok(data)
    }
)

server.tool(
    'list_subsets',
    'List public subsets for a dimension',
    { dimension: z.string().describe('Dimension name') },
    async ({ dimension }) => {
        const data = await client().get(
            `Dimensions('${esc(dimension)}')/Hierarchies('${esc(dimension)}')/Subsets`,
            { '$select': 'Name' }
        )
        return ok((data.value ?? []).map(s => s.Name))
    }
)

server.tool(
    'get_subset',
    'Get a subset — returns MDX expression (if MDX) or list of element names (if static)',
    {
        dimension: z.string().describe('Dimension name'),
        subset:    z.string().describe('Subset name'),
    },
    async ({ dimension, subset }) => {
        const data = await client().get(
            `Dimensions('${esc(dimension)}')/Hierarchies('${esc(dimension)}')/Subsets('${esc(subset)}')`
        )
        if (data.Expression) return ok({ type: 'mdx', expression: data.Expression })
        // Static subset — fetch element list
        const elems = await client().get(
            `Dimensions('${esc(dimension)}')/Hierarchies('${esc(dimension)}')/Subsets('${esc(subset)}')/Elements`,
            { '$select': 'Name' }
        )
        return ok({ type: 'static', elements: (elems.value ?? []).map(e => e.Name) })
    }
)

server.tool(
    'list_chores',
    'List all chores with their active/running status and next execution time',
    {},
    async () => {
        const names  = await client().getChores()
        const chores = await Promise.all(
            names.map(n => client().getChore(n).then(c => ({
                name:       n,
                active:     c.Active ?? false,
                running:    !!(c.IsRunning),
                next_start: c.StartTime ?? null,
            })).catch(() => ({ name: n, active: null, running: null })))
        )
        return ok(chores)
    }
)

server.tool(
    'get_chore',
    'Get chore details — steps (processes it runs) and schedule configuration',
    { chore: z.string().describe('Chore name') },
    async ({ chore }) => {
        const c = await client().getChore(chore)
        return ok({
            name:       c.Name ?? chore,
            active:     c.Active,
            frequency:  c.Frequency,
            start_time: c.StartTime,
            steps:      (c.Steps ?? []).map(s => ({
                step:    s.StepNumber,
                process: s.Process?.Name ?? s.ProcessName,
                params:  s.Parameters,
            })),
        })
    }
)

server.tool(
    'find_cubes_using_dimension',
    'Find all cubes that use a given dimension — useful for impact analysis before changing a dimension',
    { dimension: z.string().describe('Dimension name') },
    async ({ dimension }) => {
        const cubes = await client().getCubesForDimension(dimension)
        return ok((cubes.value ?? cubes).map(c => c.Name ?? c))
    }
)

// ══════════════════════════════════════════════════════════════════════════════
// DEVELOPMENT — WRITE
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
    'update_cube_rules',
    'Write new rules to a cube. The full rules text replaces any existing rules.',
    {
        cube:  z.string().describe('Cube name'),
        rules: z.string().describe('Complete rules text to write'),
    },
    async ({ cube, rules }) => {
        await client().patch(`Cubes('${esc(cube)}')`, { Rules: rules })
        return ok(`Rules updated for cube "${cube}"`)
    }
)

server.tool(
    'update_process',
    'Update one or more sections of a TI process. Only the sections you supply are changed; others are preserved.',
    {
        process:  z.string().describe('Process name'),
        prolog:   z.string().optional().describe('Prolog section code'),
        metadata: z.string().optional().describe('Metadata section code'),
        data:     z.string().optional().describe('Data section code'),
        epilog:   z.string().optional().describe('Epilog section code'),
    },
    async ({ process, prolog, metadata, data, epilog }) => {
        const c   = client()
        const cur = await c.get(`Processes('${esc(process)}')`)
        const patch = {}
        if (prolog   !== undefined) patch.PrologProcedure   = prolog
        if (metadata !== undefined) patch.MetaDataProcedure = metadata
        if (data     !== undefined) patch.DataProcedure     = data
        if (epilog   !== undefined) patch.EpilogProcedure   = epilog
        await c.patch(`Processes('${esc(process)}')`, patch)
        return ok(`Process "${process}" updated (sections: ${Object.keys(patch).join(', ')})`)
    }
)

server.tool(
    'create_or_update_subset',
    'Create or replace a public subset with an MDX expression',
    {
        dimension:  z.string().describe('Dimension name'),
        subset:     z.string().describe('Subset name'),
        expression: z.string().describe('MDX set expression, e.g. {[Time].[2024],[Time].[2025]}'),
    },
    async ({ dimension, subset, expression }) => {
        const c    = client()
        const base = `Dimensions('${esc(dimension)}')/Hierarchies('${esc(dimension)}')/Subsets`
        // Try to delete existing first (ignore 404)
        await c.delete(`${base}('${esc(subset)}')`).catch(() => {})
        await c.post(base, {
            '@odata.type': '#ibm.tm1.api.v1.Subset',
            Name:          subset,
            Expression:    expression,
            Hierarchy:     { '@odata.id': `Dimensions('${esc(dimension)}')/Hierarchies('${esc(dimension)}')` },
        })
        return ok(`Subset "${subset}" saved in dimension "${dimension}"`)
    }
)

server.tool(
    'run_process',
    'Execute a TI process on the server. Returns success or the error message.',
    {
        process:    z.string().describe('Process name'),
        parameters: z.record(z.union([z.string(), z.number()])).optional().describe('Parameter values as {name: value}'),
    },
    async ({ process, parameters }) => {
        const result = await client().executeProcess(process, parameters ?? {})
        const status = result?.ProcessExecuteStatusCode ?? result?.['@odata.context'] ?? 'completed'
        return ok({ status, result })
    }
)

server.tool(
    'check_rules_syntax',
    'Validate rules syntax against the live server without writing anything. Returns errors or OK.',
    {
        cube:  z.string().describe('Cube name'),
        rules: z.string().describe('Rules text to validate'),
    },
    async ({ cube, rules }) => {
        const result = await client().post(`Cubes('${esc(cube)}')/tm1.CheckRules`, { Rules: rules })
        const errors = result?.value ?? []
        if (!errors.length) return ok('Syntax OK — no errors found')
        return ok(errors.map(e => ({ line: e.LineNumber, message: e.Message ?? e.Description })))
    }
)

// ══════════════════════════════════════════════════════════════════════════════
// DIAGNOSTICS
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
    'get_process_log',
    'Get the recent execution log entries for a TI process',
    {
        process: z.string().describe('Process name'),
        lines:   z.number().int().min(1).max(500).optional().describe('Number of log lines to return (default 50)'),
    },
    async ({ process, lines = 50 }) => {
        const data = await client().get('ProcessExecutionLogs', {
            '$filter':  `ProcessName eq '${process}'`,
            '$orderby': 'TimeStamp desc',
            '$top':     lines,
        })
        return ok(data.value ?? [])
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
    'Get recent cell write transactions for a cube — shows who changed what and when',
    {
        cube:  z.string().describe('Cube name'),
        limit: z.number().int().min(1).max(500).optional().describe('Number of entries to return (default 100)'),
    },
    async ({ cube, limit = 100 }) => {
        const entries = await client().getTransactionLog(cube, { top: limit })
        return ok(entries)
    }
)

server.tool(
    'list_error_logs',
    'List server error log files available on the TM1 server',
    {},
    async () => {
        const files = await client().getErrorLogFiles()
        return ok(files)
    }
)

server.tool(
    'execute_view',
    'Run a cube view and return a sample of data — useful for understanding what is in a cube',
    {
        cube:  z.string().describe('Cube name'),
        view:  z.string().describe('View name'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max cell count to return (default 200)'),
    },
    async ({ cube, view, limit = 200 }) => {
        const data = await client().post(
            `Cubes('${esc(cube)}')/Views('${esc(view)}')/tm1.ExecuteMDX`,
            { '$top': limit }
        ).catch(() =>
            client().get(
                `Cubes('${esc(cube)}')/Views('${esc(view)}')/Result`,
                { '$top': limit }
            )
        )
        return ok(data)
    }
)

// ══════════════════════════════════════════════════════════════════════════════
// Start
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
    const transport = new StdioServerTransport()
    await server.connect(transport)
    process.stderr.write(`tm1mcp: connected to "${SERVER}"\n`)
}

main().catch(e => {
    process.stderr.write(`tm1mcp: fatal: ${e.message}\n`)
    process.exit(1)
})
