#!/usr/bin/env node
'use strict'

// tm1mcp — MCP server exposing TM1 model context and dev tools to AI agents
// Usage:  node tools/tm1mcp/server.js --server <name>
// Claude: claude mcp add tm1 -- node /path/to/tools/tm1mcp/server.js --server 24Retail
//
// Model-building tools (build_dimension, build_cube, build_process, …) and every
// other metadata write require an open change set — call start_change_set first.
// All writes are logged to change_log.db so they surface in the IDE deploy pipeline
// (diff → package → risk → deploy) exactly like changes made in the IDE itself.

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })

const { McpServer }            = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z }                    = require('zod')
const fs                       = require('fs')
const { makeClient }           = require('../../core/adapter_registry')
const cl                       = require('../../core/change_log')
const { lintRules }            = require('../../core/rules-lint')
const { lintTI }               = require('../../core/ti-lint')
const assertions               = require('../../core/assertions')

// ── Config ────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2)
const srvIdx = args.indexOf('--server')
const SERVER = srvIdx !== -1 ? args[srvIdx + 1] : (process.env.TM1_MCP_SERVER ?? null)

if (!SERVER) {
    process.stderr.write('tm1mcp: specify a server with --server <name> or TM1_MCP_SERVER env var\n')
    process.exit(1)
}

const AGENT_USER = 'ai-agent'

// ── Helpers ───────────────────────────────────────────────────────────────────

function client() { return makeClient(SERVER, null) }

function ok(data) {
    return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] }
}

const esc = s => encodeURIComponent(s)

// Every metadata write goes through here so it lands in the active change set.
function logChange(action, objectType, objectName, opts = {}) {
    return cl.writeLog({
        server:      SERVER,
        action,
        objectType,
        objectName,
        detail:      opts.detail ?? null,
        beforeState: opts.before ?? null,
        afterState:  opts.after  ?? null,
    })
}

// Run the server's stored assertions: execute each MDX, sum the returned cells,
// compare to the expected value within tolerance.
async function runAssertions(tags) {
    const set = assertions.list(SERVER).filter(a => !tags?.length || a.tags.some(t => tags.includes(t)))
    const c = client()
    const results = []
    for (const a of set) {
        let actual = null, error = null
        try {
            const r = await c.executeMDX(a.mdx, 5000)
            actual = (r.Cells ?? []).reduce((s, x) => s + (x.Value ?? 0), 0)
        } catch (e) {
            error = e.response?.data?.error?.message ?? e.message
        }
        const pass = error == null && Math.abs(actual - a.expected) <= a.tolerance
        results.push({
            id: a.id, description: a.description,
            expected: a.expected, actual, diff: error ? null : actual - a.expected,
            pass, error,
        })
    }
    return {
        total:  results.length,
        passed: results.filter(r => r.pass).length,
        failed: results.filter(r => !r.pass),
        results,
    }
}

// Metadata writes are refused unless a change set is open — this is the workflow gate.
function requireChangeSet() {
    const s = cl.getActiveSession(SERVER)
    if (!s) {
        throw new Error(
            'No change set is open for this server. Call start_change_set first — every model ' +
            'change must be captured in a change set so it can be reviewed and deployed.'
        )
    }
    return s
}

// ── Server ────────────────────────────────────────────────────────────────────

const _server = new McpServer({
    name:    'tm1-ide',
    version: '2.0.0',
})

// Wrap every tool handler so TM1/OData error detail reaches the agent instead of
// the opaque "Request failed with status code 400".
const server = {
    tool(name, description, schema, handler) {
        return _server.tool(name, description, schema, async (args) => {
            try {
                return await handler(args)
            } catch (e) {
                const d = e.response?.data?.error?.message ?? e.response?.data?.error ?? e.response?.data
                const msg = typeof d === 'string' ? d : d ? JSON.stringify(d) : e.message
                return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
            }
        })
    },
}

// ══════════════════════════════════════════════════════════════════════════════
// ORIENTATION
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
    'read_build_guide',
    'Read docs/BUILDING_MODELS.md — the method for building a TM1 model from a requirements document (dimensionality first, verify every worked example with read_cells, native vs MDX views, the change-set workflow, v11 landmines). Call this FIRST when asked to build a model.',
    {},
    async () => {
        const p = require('path').join(__dirname, '../../docs/BUILDING_MODELS.md')
        try { return ok(fs.readFileSync(p, 'utf8')) }
        catch (e) { return ok(`Build guide not found at ${p}: ${e.message}`) }
    }
)

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
        dimension:    z.string().describe('Dimension name'),
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
    'get_element_attributes',
    'Get the element-attribute definitions for a dimension, and optionally the values for one element',
    {
        dimension: z.string().describe('Dimension name'),
        element:   z.string().optional().describe('If given, also return this element\'s attribute values'),
    },
    async ({ dimension, element }) => {
        const c = client()
        const defs = await c.getElementAttributes(dimension).catch(() => [])
        const out  = { attributes: defs }
        if (element) out.values = await c.getElementAttributeValues(dimension, element).catch(() => ({}))
        return ok(out)
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
            datasource: p.DataSources?.[0] ?? p.DataSource ?? null,
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
    'Get the definition of a cube view — MDX text for MDX views, or resolved row/column/title subset placements for native views',
    {
        cube: z.string().describe('Cube name'),
        view: z.string().describe('View name'),
    },
    async ({ cube, view }) => {
        const c   = client()
        const def = await c.get(`Cubes('${esc(cube)}')/Views('${esc(view)}')`)
        if (def?.['@odata.type']?.includes('MDXView')) {
            return ok({ type: 'mdx', name: def.Name, mdx: def.MDX ?? '' })
        }
        // Native view — placement-level $expand=Subset is the only reliable path on this TM1 version
        const placements = await c.getViewWithSubsets(cube, view).catch(() => null)
        return ok({ type: 'native', name: def?.Name ?? view, placements })
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
            steps:      (c.Tasks ?? c.Steps ?? []).map(s => ({
                step:    s.Step ?? s.StepNumber,
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
// CHANGE SET — the deployment-workflow gate
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
    'seed_baseline',
    'Snapshot the current server state as the deployment baseline. Run this BEFORE a build so ' +
    'diff_change_set (and the IDE Deploy panel) show only the objects you are about to create, ' +
    'not older drift. Overwrites any existing baseline.',
    {},
    async () => {
        let seed
        try { ({ seed } = require('../../tools/tm1deploy/src/snapshot')) }
        catch (e) { return ok(`Deploy tooling not available: ${e.message}`) }
        const result = await seed(SERVER, null, null)   // → .tm1baseline/<server>.json
        const c = result?._meta?.counts ?? {}
        return ok(`Baseline seeded from "${SERVER}" at ${result?._meta?.seeded_at ?? 'now'} — ` +
            `${c.dimensions ?? '?'} dims, ${c.cubes ?? '?'} cubes, ${c.processes ?? '?'} processes captured. ` +
            `This server's baseline only; diff_change_set and the IDE Deploy panel compare against it.`)
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
    'add_assertion',
    'Record an expected result for this model — an MDX query and the number it should return. ' +
    'The assertion is stored (config/assertions.json) and run on every close_change_set, plus on demand via run_assertions. ' +
    'It is executed once immediately so you know the query and expected value are right.',
    {
        description: z.string().describe('What this checks, in words — e.g. "IT pool clears: total DR = pool"'),
        mdx:         z.string().describe('MDX SELECT. Returned cells are summed and compared to `expected`.'),
        expected:    z.number().describe('The value the summed cells should equal'),
        tolerance:   z.number().optional().describe('Absolute tolerance (default 0.01)'),
        tags:        z.array(z.string()).optional().describe('Labels for running a subset later'),
    },
    async ({ description, mdx, expected, tolerance, tags }) => {
        const rec = assertions.add(SERVER, { description, mdx, expected, tolerance, tags })
        let actual = null, error = null
        try {
            const r = await client().executeMDX(mdx, 5000)
            actual = (r.Cells ?? []).reduce((s, x) => s + (x.Value ?? 0), 0)
        } catch (e) { error = e.response?.data?.error?.message ?? e.message }
        const pass = error == null && Math.abs(actual - rec.expected) <= rec.tolerance
        return ok({
            added: rec.id,
            check_now: error ? { error } : { actual, expected: rec.expected, pass },
        })
    }
)

server.tool(
    'list_assertions',
    'List the stored assertions for this server',
    {},
    async () => ok(assertions.list(SERVER))
)

server.tool(
    'remove_assertion',
    'Delete a stored assertion by id',
    { id: z.string().describe('Assertion id (from add_assertion or list_assertions)') },
    async ({ id }) => ok(assertions.remove(SERVER, id) ? `Removed assertion ${id}.` : `No assertion ${id} for "${SERVER}".`)
)

server.tool(
    'run_assertions',
    'Run the stored assertions now — execute each MDX, sum the cells, compare to expected. ' +
    'Use this to self-check a build before closing the change set.',
    {
        tags: z.array(z.string()).optional().describe('Run only assertions with one of these tags'),
    },
    async ({ tags }) => {
        const set = assertions.list(SERVER)
        if (!set.length) return ok(`No assertions stored for "${SERVER}". Add them with add_assertion.`)
        return ok(await runAssertions(tags))
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
        try { diffMod = require('../../tools/tm1deploy/src/diff') } catch { diffMod = null }
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
        try { ({ pack } = require('../../tools/tm1deploy/src/packager')) }
        catch (e) { return ok(`Deploy tooling not available: ${e.message}`) }

        let entries, name
        if (release) {
            let seededAt = null
            try {
                const { loadBaseline } = require('../../tools/tm1deploy/src/diff')
                seededAt = loadBaseline(null, SERVER)?._meta?.seeded_at ?? null
            } catch { /* no baseline — getEntriesSince falls back to all-time */ }
            entries = cl.getEntriesSince(SERVER, seededAt)
            name = `Release ${new Date().toISOString().slice(0, 10)}`
        } else {
            const s = cl.getActiveSession(SERVER)
            if (!s) return ok(`No change set is open on "${SERVER}". Open one, or call with release:true.`)
            entries = cl.getSessionLog(s.id)
            name = s.name
        }
        if (!entries.length) return ok(`Nothing to package — no recorded changes${release ? ' since the baseline' : ' in the open change set'}.`)

        try {
            const result = await pack(SERVER, entries, name, { force: true }, null)
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

server.tool(
    'check_deploy_risk',
    'Run the pre-deploy risk analysis for a package against a target server — rule/TI syntax on the target, missing dependencies, chore conflicts, structural impact. Read-only: nothing is written to the target. Use it as a fix loop before handoff: fix what it flags, re-package, re-check.',
    {
        packageDir: z.string().describe('Package folder path returned by package_change_set'),
        target:     z.string().describe('Target server name to check against, e.g. "TM1_Test"'),
    },
    async ({ packageDir, target }) => {
        let analyzeRisk
        try { ({ analyzeRisk } = require('../../tools/tm1deploy/src/risk')) }
        catch (e) { return ok(`Deploy tooling not available: ${e.message}`) }
        try {
            const r = await analyzeRisk(packageDir, target, null)
            return ok({
                target,
                safe_to_deploy: r.safe_to_deploy,
                blockers: (r.blockers ?? []).map(b => `${b.type} ${b.name}: ${b.message}`),
                warnings: (r.warnings ?? []).map(w => `${w.type} ${w.name}: ${w.message}`),
                info_count: (r.infos ?? []).length,
            })
        } catch (e) { return ok(`risk check failed: ${e.message}`) }
    }
)

server.tool(
    'check_target_drift',
    'Check whether a target server has drifted from the deployment baseline for the objects in a package — i.e. someone changed them on the target since the baseline was seeded. Read-only.',
    {
        packageDir: z.string().describe('Package folder path returned by package_change_set'),
        target:     z.string().describe('Target server name'),
    },
    async ({ packageDir, target }) => {
        let driftCheck
        try { ({ driftCheck } = require('../../tools/tm1deploy/src/diff')) }
        catch (e) { return ok(`Deploy tooling not available: ${e.message}`) }
        try {
            const r = await driftCheck(packageDir, target, null)
            if (r.skipped) return ok({ target, note: r.reason ?? 'drift check skipped (no baseline in the package or repo)' })
            return ok({
                target,
                target_aligned: r.target_aligned,
                checked: r.checked,
                drifted: (r.drifted ?? []).map(d => `${d.type} ${d.name}${d.detail ? ` (${d.detail})` : ''}: ${d.note ?? 'differs from baseline'}`),
            })
        } catch (e) { return ok(`drift check failed: ${e.message}`) }
    }
)

// ══════════════════════════════════════════════════════════════════════════════
// MODEL BUILD — WRITE (all require an open change set)
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
    'build_dimension',
    'Create a dimension declaratively in one call — elements, consolidation edges, and element attributes. If the dimension exists, elements/edges/attributes are added to it. Use for small dimensions; drive large dimensions from a TI process (build_process) that loads from a datasource.',
    {
        name:     z.string().describe('Dimension name'),
        elements: z.array(z.object({
            name: z.string(),
            type: z.enum(['N', 'C', 'S']).optional().describe('N=numeric leaf (default), C=consolidated, S=string'),
        })).optional().describe('Elements to create'),
        edges: z.array(z.object({
            parent: z.string(),
            child:  z.string(),
            weight: z.number().optional().describe('Roll-up weight, default 1'),
        })).optional().describe('Consolidation edges (parent must be a C element)'),
        attributes: z.array(z.object({
            name: z.string(),
            type: z.enum(['String', 'Numeric', 'Alias']).optional().describe('default String'),
        })).optional().describe('Element attribute definitions'),
        attribute_values: z.array(z.object({
            element:   z.string(),
            attribute: z.string(),
            value:     z.union([z.string(), z.number()]),
        })).optional().describe('Attribute values to set per element'),
        hierarchies: z.array(z.object({
            name:     z.string(),
            elements: z.array(z.object({ name: z.string(), type: z.enum(['N', 'C', 'S']).optional() })).optional()
                        .describe('Every element this hierarchy contains — including leaves shared with the main hierarchy, which must be listed again here'),
            edges:    z.array(z.object({ parent: z.string(), child: z.string(), weight: z.number().optional() })).optional(),
        })).optional().describe('Alternate hierarchies — a different roll-up of (a subset of) the same elements'),
    },
    async ({ name, elements = [], edges = [], attributes = [], attribute_values = [], hierarchies = [] }) => {
        requireChangeSet()
        const c = client()

        const tolerate = (e, re) => { if (!re.test(e.response?.data?.error?.message ?? e.message ?? '')) throw e }
        const addEl = async (dim, el, hier) => {
            try { await c.addElement(dim, el.name, el.type ?? 'N', hier) }
            catch (e) { tolerate(e, /already exists|already in use|duplicate/i) }
        }
        const addEd = async (dim, ed, hier) => {
            try { await c.addEdge(dim, ed.parent, ed.child, ed.weight ?? 1, hier) }
            catch (e) { tolerate(e, /already exists|duplicate/i) }
        }

        let created = false
        try {
            await c.createDimension(name)
            created = true
        } catch (e) { tolerate(e, /already exists|409/i) }

        for (const el of elements) await addEl(name, el)
        for (const ed of edges)    await addEd(name, ed)
        for (const a of attributes) {
            try { await c.createElementAttribute(name, a.name, a.type ?? 'String') }
            catch (e) { tolerate(e, /already exists/i) }
        }
        for (const v of attribute_values) {
            const def = attributes.find(a => a.name === v.attribute)
            await c.writeElementAttribute(name, v.element, v.attribute, v.value, def?.type === 'Numeric' ? 'N' : 'S')
        }

        for (const h of hierarchies) {
            try { await c.createHierarchy(name, h.name) }
            catch (e) { tolerate(e, /already exists|409|duplicate/i) }
            for (const el of (h.elements ?? [])) await addEl(name, el, h.name)
            for (const ed of (h.edges ?? []))    await addEd(name, ed, h.name)
            logChange('HIERARCHY_CREATED', 'dimension', name, { detail: `${h.name}: ${(h.elements ?? []).length} elements, ${(h.edges ?? []).length} edges` })
        }

        logChange(created ? 'DIMENSION_CREATED' : 'ELEMENT_ADDED', 'dimension', name,
            { detail: `${elements.length} elements, ${edges.length} edges` })
        for (const a of attributes) logChange('ATTRIBUTE_CREATED', 'attribute', a.name, { detail: name })

        return ok(`Dimension "${name}" ${created ? 'created' : 'updated'}: ${elements.length} elements, ${edges.length} edges, ${attributes.length} attributes, ${attribute_values.length} attribute values` +
            (hierarchies.length ? `, ${hierarchies.length} alternate hierarch${hierarchies.length === 1 ? 'y' : 'ies'} (${hierarchies.map(h => h.name).join(', ')})` : '') + '.')
    }
)

server.tool(
    'add_elements',
    'Add elements and/or consolidation edges to an existing dimension (incremental — for small additions; use a TI process for bulk loads). ' +
    'If `hierarchy` names one that does not exist, it is created. Note: an element added to the main hierarchy is NOT automatically in an alternate hierarchy — list it in `elements` here too.',
    {
        dimension: z.string().describe('Dimension name'),
        hierarchy: z.string().optional().describe('Hierarchy name (defaults to the dimension name); created if missing'),
        elements:  z.array(z.object({
            name: z.string(),
            type: z.enum(['N', 'C', 'S']).optional(),
        })).optional(),
        edges: z.array(z.object({
            parent: z.string(),
            child:  z.string(),
            weight: z.number().optional(),
        })).optional(),
    },
    async ({ dimension, hierarchy, elements = [], edges = [] }) => {
        requireChangeSet()
        const c = client()
        const h = hierarchy ?? dimension
        const tol = (e, re) => { if (!re.test(e.response?.data?.error?.message ?? e.message ?? '')) throw e }

        let hierCreated = false
        if (hierarchy && hierarchy !== dimension) {
            const existing = await c.getHierarchies(dimension).catch(() => [])
            if (!existing.includes(hierarchy)) {
                try { await c.createHierarchy(dimension, hierarchy); hierCreated = true }
                catch (e) { tol(e, /already exists|409|duplicate/i) }
            }
        }

        for (const el of elements) {
            try { await c.addElement(dimension, el.name, el.type ?? 'N', h) }
            catch (e) { tol(e, /already exists|already in use|duplicate/i) }
        }
        for (const ed of edges) {
            try { await c.addEdge(dimension, ed.parent, ed.child, ed.weight ?? 1, h) }
            catch (e) { tol(e, /already exists|duplicate/i) }
        }
        logChange(hierCreated ? 'HIERARCHY_CREATED' : 'ELEMENT_ADDED', 'dimension', dimension,
            { detail: `${elements.length} elements, ${edges.length} edges${hierarchy ? ` in ${hierarchy}` : ''}` })
        return ok(`Added ${elements.length} elements and ${edges.length} edges to "${dimension}"${hierarchy && hierarchy !== dimension ? ` hierarchy "${hierarchy}"${hierCreated ? ' (created)' : ''}` : ''}.`)
    }
)

server.tool(
    'create_hierarchy',
    'Create an alternate hierarchy on a dimension — an independent roll-up of the same elements. ' +
    'Add the elements it contains (including shared leaves) and its edges with add_elements, passing `hierarchy`.',
    {
        dimension: z.string().describe('Dimension name'),
        name:      z.string().describe('Hierarchy name'),
    },
    async ({ dimension, name }) => {
        requireChangeSet()
        const c = client()
        const existing = await c.getHierarchies(dimension).catch(() => [])
        if (existing.includes(name)) return ok(`Hierarchy "${name}" already exists on "${dimension}".`)
        await c.createHierarchy(dimension, name)
        logChange('HIERARCHY_CREATED', 'dimension', dimension, { detail: name })
        return ok(`Hierarchy "${name}" created on "${dimension}". Add its elements and edges with add_elements (hierarchy: "${name}").`)
    }
)

server.tool(
    'restructure_dimension',
    'Change an existing dimension in place — re-parent an element, remove an edge, or change a roll-up weight. ' +
    'Element rename is attempted but not supported on all TM1 versions; the result reports whether it took. ' +
    'WARNING: renaming an element breaks any rule, view, subset or feeder that names it — check find_dimension_usage first.',
    {
        dimension: z.string().describe('Dimension name'),
        hierarchy: z.string().optional().describe('Hierarchy (defaults to the dimension name)'),
        rename:    z.array(z.object({ from: z.string(), to: z.string() })).optional().describe('Element renames (may be unsupported on older servers)'),
        reparent:  z.array(z.object({
            element:     z.string(),
            from_parent: z.string().describe('Current parent — its edge to the element is removed'),
            to_parent:   z.string().describe('New parent — an edge is added'),
            weight:      z.number().optional().describe('Weight under the new parent (default 1)'),
        })).optional().describe('Move elements to a different parent'),
        remove_edges: z.array(z.object({ parent: z.string(), child: z.string() })).optional(),
        set_weights:  z.array(z.object({ parent: z.string(), child: z.string(), weight: z.number() })).optional(),
    },
    async ({ dimension, hierarchy, rename = [], reparent = [], remove_edges = [], set_weights = [] }) => {
        requireChangeSet()
        const c = client()
        const h = hierarchy ?? dimension
        const done = []
        const failed = []

        for (const r of rename) {
            await c.renameElement(dimension, r.from, r.to, h).catch(() => {})
            const names = (await c.get(`Dimensions('${esc(dimension)}')/Hierarchies('${esc(h)}')/Elements`, { $select: 'Name' })
                ).value.map(x => x.Name)
            if (names.includes(r.to) && !names.includes(r.from)) {
                logChange('ELEMENT_RENAMED', 'dimension', dimension, { detail: `${r.from} -> ${r.to}${hierarchy ? ` (${hierarchy})` : ''}` })
                done.push(`renamed ${r.from} -> ${r.to}`)
            } else {
                failed.push(`rename ${r.from} -> ${r.to} did not take (element rename is unsupported on this TM1 version — recreate the element instead)`)
            }
        }
        for (const m of reparent) {
            await c.deleteEdge(dimension, m.from_parent, m.element, h).catch(() => {})
            await c.addEdge(dimension, m.to_parent, m.element, m.weight ?? 1, h)
            logChange('ELEMENT_ADDED', 'dimension', dimension, { detail: `re-parent ${m.element}: ${m.from_parent} → ${m.to_parent}` })
            done.push(`moved ${m.element} under ${m.to_parent}`)
        }
        for (const e of remove_edges) {
            await c.deleteEdge(dimension, e.parent, e.child, h)
            logChange('EDGE_REMOVED', 'dimension', dimension, { detail: `${e.parent} -> ${e.child}` })
            done.push(`removed edge ${e.parent} → ${e.child}`)
        }
        for (const w of set_weights) {
            await c.updateEdgeWeight(dimension, w.parent, w.child, w.weight, h)
            logChange('ELEMENT_ADDED', 'dimension', dimension, { detail: `weight ${w.parent} → ${w.child} = ${w.weight}` })
            done.push(`weight ${w.parent} → ${w.child} = ${w.weight}`)
        }

        const out = done.length ? `"${dimension}": ${done.join('; ')}.` : 'No changes applied.'
        return ok(failed.length ? { done, failed, note: out } : out)
    }
)

server.tool(
    'set_attribute_values',
    'Set element-attribute values on a dimension. Applied directly to the server; for values that must survive deployment, load them from a TI process instead.',
    {
        dimension: z.string().describe('Dimension name'),
        values: z.array(z.object({
            element:   z.string(),
            attribute: z.string(),
            value:     z.union([z.string(), z.number()]),
            numeric:   z.boolean().optional().describe('true if the attribute is Numeric'),
        })).describe('Attribute values to write'),
    },
    async ({ dimension, values }) => {
        requireChangeSet()
        const c = client()
        for (const v of values) {
            await c.writeElementAttribute(dimension, v.element, v.attribute, v.value, v.numeric ? 'N' : 'S')
        }
        logChange('ELEMENT_ADDED', 'dimension', dimension, { detail: `${values.length} attribute values set` })
        return ok(`Set ${values.length} attribute value(s) on "${dimension}".`)
    }
)

server.tool(
    'build_cube',
    'Create a cube over existing dimensions, optionally with rules. The last dimension is conventionally the measures dimension.',
    {
        name:       z.string().describe('Cube name'),
        dimensions: z.array(z.string()).describe('Dimension names in cube order (last = measures by convention)'),
        rules:      z.string().optional().describe('Complete rules text. Static-linted then CheckRules-validated before it is written; lint errors abort the whole call (cube not created).'),
        force:      z.boolean().optional().describe('Create the cube and write rules even if the static lint found errors'),
    },
    async ({ name, dimensions, rules, force }) => {
        requireChangeSet()
        const c = client()

        if (rules) {
            const lint = lintRules(rules)
            if (lint.errors.length && !force) {
                return ok({
                    refused: 'static rule lint found errors — cube NOT created. Fix the rules, or pass force:true.',
                    errors:  lint.errors,
                    warnings: lint.warnings,
                })
            }
        }

        const existingCube = await c.getCube(name).catch(() => null)
        if (existingCube) {
            const existingDims = (existingCube.Dimensions ?? []).map(d => d.Name ?? d)
            if (existingDims.join(' ') !== dimensions.join(' ')) {
                return ok({
                    refused: `Cube "${name}" already exists with different dimensions. A cube's dimensionality can't be changed in place — delete and rebuild, or pick a new name.`,
                    existing: existingDims,
                    requested: dimensions,
                })
            }
            // same shape — skip creation, fall through to rules
        } else {
            await c.createCube(name, dimensions)
            logChange('CUBE_CREATED', 'cube', name, { detail: dimensions.join(', ') })
        }

        let ruleNote = ''
        if (rules) {
            const check  = await c.post(`Cubes('${esc(name)}')/tm1.CheckRules`, { Rules: rules }).catch(e => ({ _error: e.message }))
            const errors = check?.value ?? []
            if (check?._error) {
                ruleNote = ` Cube created, but CheckRules could not run (${check._error}); rules NOT written.`
            } else if (errors.length) {
                ruleNote = ` Cube created, but rules have ${errors.length} error(s) and were NOT written: ` +
                           JSON.stringify(errors.map(e => ({ line: e.LineNumber, message: e.Message ?? e.Description })))
            } else {
                await c.patch(`Cubes('${esc(name)}')`, { Rules: rules })
                logChange('RULES_SAVED', 'rules', name, { after: { rules } })
                ruleNote = ' Rules validated and written.'
            }
        }

        return ok(`Cube "${name}" ${existingCube ? 'already existed (same dimensions)' : `created over [${dimensions.join(', ')}]`}.${ruleNote}`)
    }
)

server.tool(
    'build_process',
    'Create (or replace) a TI process — parameters, datasource, and any of the four code sections. ' +
    'Follow the p/v/n/s/c variable-prefix convention in generated code: p=parameter, v=string var, n=numeric var, s=server name, c=cube name. Comments use # not //.',
    {
        name: z.string().describe('Process name'),
        parameters: z.array(z.object({
            Name:   z.string(),
            Type:   z.enum(['String', 'Numeric']).optional(),
            Value:  z.union([z.string(), z.number()]).optional(),
            Prompt: z.string().optional(),
        })).optional(),
        datasource: z.record(z.any()).optional().describe(
            'TM1 DataSource object, e.g. { "Type": "ODBC", "dataSourceNameForServer": "MyDSN", "userName": "u", "password": "p", "query": "SELECT ..." } ' +
            'or { "Type": "ASCII", "dataSourceNameForServer": "C:\\\\data\\\\file.csv", "asciiDelimiterChar": ",", "asciiHeaderRecords": 1 }. Omit for a process with no datasource.'
        ),
        prolog:   z.string().optional().describe('Prolog section code'),
        metadata: z.string().optional().describe('Metadata section code'),
        data:     z.string().optional().describe('Data section code'),
        epilog:   z.string().optional().describe('Epilog section code'),
        force:    z.boolean().optional().describe('Write even if the static TI lint found errors'),
    },
    async ({ name, parameters, datasource, prolog, metadata, data, epilog, force }) => {
        requireChangeSet()
        const lint = lintTI({ prolog, metadata, data, epilog })
        if (lint.errors.length && !force) {
            return ok({ refused: 'static TI lint found errors — process NOT written. Fix, or pass force:true.', errors: lint.errors, warnings: lint.warnings })
        }
        const c      = client()
        const exists = await c.getProcess(name).then(() => true).catch(() => false)
        await c.createOrReplaceProcess({ name, parameters, datasource, prolog, metadata, data, epilog })
        logChange(exists ? 'PROCESS_SAVED' : 'PROCESS_CREATED', 'process', name,
            { after: { prolog: prolog ?? '', metadata: metadata ?? '', data: data ?? '', epilog: epilog ?? '' } })
        const note = lint.warnings.length ? ` (lint warnings: ${lint.warnings.map(w => `[${w.section}] ${w.message}`).join(' | ')})` : ''
        return ok(`Process "${name}" ${exists ? 'updated' : 'created'}.${note}`)
    }
)

server.tool(
    'write_cells',
    'Write values to cube cells. Coordinates are given as { dimensionName: elementName } for every dimension of the cube.',
    {
        cube: z.string().describe('Cube name'),
        cells: z.array(z.object({
            coordinates: z.record(z.string()).describe('{ "DimA": "ElemA", "DimB": "ElemB", ... } — one entry per cube dimension'),
            value:       z.union([z.string(), z.number()]),
        })).describe('Cells to write'),
    },
    async ({ cube, cells }) => {
        requireChangeSet()
        const c        = client()
        const cubeInfo = await c.getCube(cube)
        const order    = (cubeInfo?.Dimensions ?? []).map(d => d.Name)
        if (!order.length) return ok(`Could not read dimensions for cube "${cube}".`)

        const updates = []
        for (const { coordinates, value } of cells) {
            const missing = order.filter(d => coordinates[d] == null)
            if (missing.length) return ok(`Cell is missing coordinates for: ${missing.join(', ')}. Cube order is [${order.join(', ')}].`)
            updates.push({ dimElemPairs: order.map(d => ({ dim: d, element: coordinates[d] })), value })
        }

        await c.updateCells(cube, updates)
        logChange('CELLS_WRITTEN', 'cube', cube, { detail: `${updates.length} cells (data — not carried by metadata deploy)` })
        return ok(`Wrote ${updates.length} cell(s) to "${cube}".`)
    }
)

server.tool(
    'read_cells',
    'Read cube cell values — either by MDX SELECT, or a single intersection given cube + coordinates. Use to verify rules and feeders after building.',
    {
        mdx:         z.string().optional().describe('Full MDX SELECT query'),
        cube:        z.string().optional().describe('Cube name (with `coordinates`, for a single-cell read)'),
        coordinates: z.record(z.string()).optional().describe('{ "DimA": "ElemA", ... } for every cube dimension — single cell'),
        max_cells:   z.number().int().min(1).max(5000).optional().describe('Cap on cells returned (default 500)'),
    },
    async ({ mdx, cube, coordinates, max_cells = 500 }) => {
        const c = client()
        let query = mdx
        if (!query) {
            if (!cube || !coordinates) return ok('Provide either `mdx`, or `cube` + `coordinates`.')
            const order = ((await c.getCube(cube))?.Dimensions ?? []).map(d => d.Name)
            const missing = order.filter(d => coordinates[d] == null)
            if (missing.length) return ok(`Missing coordinates for: ${missing.join(', ')}`)
            const [colDim, ...rest] = order
            const slicer = rest.map(d => `[${d}].[${d}].[${coordinates[d]}]`).join(', ')
            query = `SELECT {[${colDim}].[${colDim}].[${coordinates[colDim]}]} ON 0 FROM [${cube}]` + (slicer ? ` WHERE (${slicer})` : '')
        }
        const res   = await c.executeMDX(query, max_cells)
        const cells = (res.Cells ?? []).map(x => ({ ordinal: x.Ordinal, value: x.Value, formatted: x.FormattedValue }))
        return ok({ mdx: query, cell_count: cells.length, truncated: res.truncated ?? false, cells })
    }
)

server.tool(
    'create_view',
    'Create or replace a view on a cube — MDX (`mdx`) or native (`native`). Native views render most reliably in the IDE and are the right choice for input templates and standard reports.',
    {
        cube: z.string().describe('Cube name'),
        name: z.string().describe('View name'),
        mdx:  z.string().optional().describe('MDX SELECT query (use this OR native)'),
        native: z.object({
            rows:    z.array(z.any()),
            columns: z.array(z.any()),
            titles:  z.array(z.any()).optional(),
        }).optional().describe(
            'Native view axes. Each rows/columns entry: { dimension, and ONE of: subset:"Name" | members:["A","B"] | memberSet:"leaf"|"root" | customExpr:"<MDX set>" } (omit all = every member). ' +
            'Each titles entry: { dimension, member:"SelectedMember" }. Dimensions you omit are auto-placed on Titles at their default member.'
        ),
    },
    async ({ cube, name, mdx, native }) => {
        requireChangeSet()
        if (native) {
            await client().saveNativeView(cube, name, {
                rows:    native.rows    ?? [],
                columns: native.columns ?? [],
                titles:  native.titles  ?? [],
            })
            logChange('VIEW_SAVED', 'view', name, { detail: cube, after: { type: 'native', definition: native } })
            return ok(`Native view "${name}" saved on cube "${cube}".`)
        }
        if (mdx) {
            await client().saveView(cube, name, mdx)
            logChange('VIEW_SAVED', 'view', name, { detail: cube, after: { type: 'mdx', mdx } })
            return ok(`MDX view "${name}" saved on cube "${cube}".`)
        }
        return ok('Provide either `mdx` or `native`.')
    }
)

server.tool(
    'create_subset',
    'Create or replace a public subset — MDX expression, or an explicit static element list',
    {
        dimension:  z.string().describe('Dimension name'),
        subset:     z.string().describe('Subset name'),
        expression: z.string().optional().describe('MDX set expression, e.g. {[Time].[2024],[Time].[2025]}'),
        elements:   z.array(z.string()).optional().describe('Explicit element list for a static subset (use instead of expression)'),
    },
    async ({ dimension, subset, expression, elements }) => {
        requireChangeSet()
        const c = client()
        if (elements?.length) {
            await c.saveStaticSubset(dimension, subset, elements)
        } else if (expression) {
            await c.saveSubset(dimension, subset, expression)
        } else {
            return ok('Provide either `expression` (MDX) or `elements` (static list).')
        }
        logChange('SUBSET_SAVED', 'subset', subset, { detail: dimension, after: { expression: expression ?? null, elements: elements ?? null } })
        return ok(`Subset "${subset}" saved in dimension "${dimension}".`)
    }
)

server.tool(
    'create_chore',
    'Create a chore that runs one or more processes on a schedule. Note: chores are applied to this server but are not currently carried by the IDE deploy pipeline.',
    {
        name:  z.string().describe('Chore name'),
        steps: z.array(z.object({
            process:    z.string(),
            parameters: z.array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]) })).optional(),
        })).describe('Processes to run, in order'),
        start_time: z.string().optional().describe('ISO start time, e.g. 2026-01-01T06:00:00Z'),
        frequency:  z.string().optional().describe('ISO-8601 duration, e.g. P1DT00H00M00S for daily. Default daily.'),
        active:     z.boolean().optional().describe('Activate immediately (default false)'),
    },
    async ({ name, steps, start_time, frequency, active }) => {
        requireChangeSet()
        const c = client()
        await c.createChore({
            Name:          name,
            StartTime:     start_time ?? new Date().toISOString(),
            DSTSensitive:  false,
            Active:        !!active,
            ExecutionMode: 'SingleCommit',
            Frequency:     frequency ?? 'P1DT00H00M00S',
            Tasks: steps.map((s, i) => ({
                Step: i,
                'Process@odata.bind': `Processes('${s.process.replace(/'/g, "''")}')`,
                Parameters: s.parameters ?? [],
            })),
        })
        logChange('CHORE_CREATED', 'chore', name, { detail: `${steps.length} step(s)` })
        return ok(`Chore "${name}" created with ${steps.length} step(s), active=${!!active}.`)
    }
)

server.tool(
    'set_chore_state',
    'Activate, deactivate, or immediately run a chore',
    {
        name:     z.string().describe('Chore name'),
        activate: z.boolean().optional().describe('true to activate, false to deactivate'),
        run:      z.boolean().optional().describe('true to execute the chore now'),
    },
    async ({ name, activate, run }) => {
        requireChangeSet()
        const c = client()
        const done = []
        if (activate !== undefined) {
            await c.updateChore(name, { Active: activate })
            logChange(activate ? 'CHORE_ACTIVATED' : 'CHORE_DEACTIVATED', 'chore', name)
            done.push(activate ? 'activated' : 'deactivated')
        }
        if (run) {
            await c.executeChore(name)
            done.push('executed')
        }
        return ok(`Chore "${name}": ${done.join(', ') || 'no change'}.`)
    }
)

server.tool(
    'delete_object',
    'Delete a TM1 object. Recorded in the change set. Use for cleaning up mistakes during a build.',
    {
        type: z.enum(['dimension', 'cube', 'process', 'view', 'subset', 'element', 'attribute', 'chore', 'hierarchy'])
              .describe('Object type'),
        name:      z.string().describe('Object name (for element/attribute/hierarchy: that name)'),
        dimension: z.string().optional().describe('Parent dimension — required for subset, element, attribute, hierarchy'),
        cube:      z.string().optional().describe('Parent cube — required for view'),
    },
    async ({ type, name, dimension, cube }) => {
        requireChangeSet()
        const c = client()
        switch (type) {
            case 'dimension': await c.deleteDimension(name); logChange('DIMENSION_DELETED', 'dimension', name); break
            case 'cube':      await c.deleteCube(name);      logChange('CUBE_DELETED', 'cube', name); break
            case 'process':   await c.deleteProcess(name);   logChange('PROCESS_DELETED', 'process', name); break
            case 'view':
                if (!cube) return ok('`cube` is required to delete a view.')
                await c.deleteView(cube, name); logChange('VIEW_DELETED', 'view', name, { detail: cube }); break
            case 'subset':
                if (!dimension) return ok('`dimension` is required to delete a subset.')
                await c.deleteSubset(dimension, name); logChange('SUBSET_DELETED', 'subset', name, { detail: dimension }); break
            case 'element':
                if (!dimension) return ok('`dimension` is required to delete an element.')
                await c.deleteElement(dimension, name); logChange('ELEMENT_DELETED', 'dimension', dimension, { detail: `element ${name}` }); break
            case 'attribute':
                if (!dimension) return ok('`dimension` is required to delete an attribute.')
                await c.deleteElementAttribute(dimension, name); logChange('ATTRIBUTE_DELETED', 'attribute', name, { detail: dimension }); break
            case 'hierarchy':
                if (!dimension) return ok('`dimension` is required to delete a hierarchy.')
                await c.deleteHierarchy(dimension, name); logChange('HIERARCHY_DELETED', 'dimension', dimension, { detail: `hierarchy ${name}` }); break
            case 'chore':
                await c.delete(`Chores('${esc(name)}')`); logChange('CHORE_DELETED', 'chore', name); break
        }
        return ok(`Deleted ${type} "${name}".`)
    }
)

// ══════════════════════════════════════════════════════════════════════════════
// DEVELOPMENT — WRITE (existing tools, now change-set gated + logged)
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
    'update_cube_rules',
    'Write new rules to a cube. The full rules text replaces any existing rules. Requires an open change set. ' +
    'A static lint runs first — errors block the write (pass force:true to override); warnings are reported but do not block.',
    {
        cube:  z.string().describe('Cube name'),
        rules: z.string().describe('Complete rules text to write'),
        force: z.boolean().optional().describe('Write even if the static lint found errors'),
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
        await c.patch(`Cubes('${esc(cube)}')`, { Rules: rules })
        logChange('RULES_SAVED', 'rules', cube, { before: { rules: prev }, after: { rules } })
        const note = lint.warnings.length ? ` (lint warnings: ${lint.warnings.map(w => w.message).join(' | ')})` : ''
        return ok(`Rules updated for cube "${cube}".${note}`)
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

// ══════════════════════════════════════════════════════════════════════════════
// DIAGNOSTICS
// ══════════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════════
// Start
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
    const transport = new StdioServerTransport()
    await _server.connect(transport)
    process.stderr.write(`tm1mcp: connected to "${SERVER}"\n`)
}

main().catch(e => {
    process.stderr.write(`tm1mcp: fatal: ${e.message}\n`)
    process.exit(1)
})
