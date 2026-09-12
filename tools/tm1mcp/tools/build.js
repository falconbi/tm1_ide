'use strict'

const { z } = require('zod')

// ══════════════════════════════════════════════════════════════════════════════
// MODEL BUILD — WRITE (all require an open change set)
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { client, ok, esc, logChange, requireChangeSet, lintRules, lintTI }) {
    server.tool(
        'build_dimension',
        'Create a dimension declaratively in one call — elements, consolidation edges, and element attributes. If the dimension exists, elements/edges/attributes are added to it. Use for small dimensions; drive large dimensions from a TI process (build_process) that loads from a datasource. ' +
        'Measure dimensions (name ends in "Measure"/"Measures"): a "Format" attribute is auto-created and every numeric element defaults to "#,##0.00" (thousands separator, 2 dp). Pass a Format attribute_value per element to override — "0.00%" for ratios, "#,##0" for counts, more dp for rates.',
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

            // House rule: every measure dimension's numeric elements default to
            // "#,##0.00" (thousands separator, 2 dp). Skip any element the caller
            // gave an explicit Format for, and don't overwrite a Format already set.
            let formatsApplied = 0
            if (/\bMeasures?$/i.test(name) && elements.length) {
                try { await c.createElementAttribute(name, 'Format', 'String') }
                catch (e) { tolerate(e, /already exists/i) }
                const explicitFormat = new Set(
                    attribute_values.filter(v => /^format$/i.test(v.attribute)).map(v => v.element)
                )
                for (const el of elements) {
                    const isNumeric = (el.type ?? 'N') === 'N'
                    if (!isNumeric || explicitFormat.has(el.name)) continue
                    let current = ''
                    try {
                        const vals = await c.getElementAttributeValues(name, el.name)
                        current = vals?.Format ?? vals?.format ?? ''
                    } catch { /* element attr row not readable yet — treat as unset */ }
                    if (current) continue
                    await c.writeElementAttribute(name, el.name, 'Format', '#,##0.00', 'S')
                    formatsApplied++
                }
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
                (hierarchies.length ? `, ${hierarchies.length} alternate hierarch${hierarchies.length === 1 ? 'y' : 'ies'} (${hierarchies.map(h => h.name).join(', ')})` : '') +
                (formatsApplied ? `. Applied default Format "#,##0.00" to ${formatsApplied} measure element(s) — override per element (e.g. "0.00%", "#,##0") where that's wrong` : '') + '.')
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
        'Create a cube over existing dimensions, optionally with rules. Use the fixed house dimension order (NOT per-cube sparsity tuning): Period, Version, Company, Cost Centre, Account, Type, then any cube-specific dimensions, then the measure dimension last. Every cube MUST have a measure dimension and it MUST be last. Name it "<Prefix> <Cube distinctive name> Measure" — e.g. cube "WFP Workforce Cost" -> "WFP Workforce Cost Measure". Reference-data cubes get one too ("WFP FX Rates" -> "WFP FX Rates Measure" with a "Rate" element). build_cube refuses if the last dimension name does not end in Measure/Measures (pass force:true to override).',
        {
            name:       z.string().describe('Cube name'),
            dimensions: z.array(z.string()).describe('Dimension names in house order: Period, Version, Company, Cost Centre, Account, Type, <cube-specific dims>, Measure. The LAST must be a measure dimension named "<Prefix> <Cube name> Measure".'),
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

            const lastDim = dimensions[dimensions.length - 1] ?? ''
            const looksLikeMeasureDim = /\bMeasures?$/i.test(lastDim)

            const existingCube = await c.getCube(name).catch(() => null)

            // Measure-dimension rule — only checked when we are actually creating the cube.
            // An existing same-shape cube can't be fixed here, so don't block on it.
            if (!existingCube && !looksLikeMeasureDim && !force) {
                return ok({
                    refused: `Cube "${name}" — the last dimension "${lastDim}" is not a measure dimension. Every cube must have a measure dimension and it must be last. ` +
                             `Create a dimension named "${name} Measure" (or "<Prefix> ${name.replace(/^[A-Z0-9]+\s+/, '')} Measure"), add it as the final dimension, and retry. Pass force:true only if this cube genuinely has no measures.`,
                    dimensions,
                })
            }
            const canonicalMeasureDim = `${name} Measure`
            const measureNote = (!existingCube && looksLikeMeasureDim && lastDim !== canonicalMeasureDim)
                ? ` Note: measure dimension "${lastDim}" does not match the canonical name "${canonicalMeasureDim}" — consider renaming for consistency.`
                : ''

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
                    logChange('RULES_SAVED', 'rules', name, { after: { text: rules } })
                    ruleNote = ' Rules validated and written.'
                }
            }

            return ok(`Cube "${name}" ${existingCube ? 'already existed (same dimensions)' : `created over [${dimensions.join(', ')}]`}.${ruleNote}${measureNote}` +
                (existingCube || rules ? ' If you recreated this cube or changed feeders, run reprocess_feeders on it (and on cubes that feed into it) — cross-cube feeders do not re-arm on their own.' : ''))
        }
    )

    server.tool(
        'reprocess_feeders',
        'Reprocess the FEEDERS for one or more cubes (POST tm1.ProcessFeeders). Run this after recreating a cube or changing feeder rules — cross-cube feeders into a recreated cube stay dead until you do, and consolidations silently read as 0 while every leaf still computes on a direct read.',
        {
            cubes: z.array(z.string()).describe('Cube names to reprocess, e.g. the recreated cube plus any that feed into it'),
        },
        async ({ cubes }) => {
            const c = client()
            const done = [], failed = []
            for (const name of cubes) {
                try { await c.post(`Cubes('${esc(name)}')/tm1.ProcessFeeders`, {}); done.push(name) }
                catch (e) { failed.push(`${name}: ${e.response?.data?.error?.message ?? e.message}`) }
            }
            return ok(failed.length ? { reprocessed: done, failed } : `Feeders reprocessed for ${done.join(', ')}.`)
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
}

module.exports = { register }
