'use strict'

const { z } = require('zod')

// ══════════════════════════════════════════════════════════════════════════════
// MODEL CONTEXT — READ
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { client, ok, esc }) {
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
}

module.exports = { register }
