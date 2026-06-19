'use strict'

const fs   = require('fs')
const path = require('path')
const { makeClient } = require('./client')

// Run items in batches — each batch is parallel, batches are sequential.
// Prevents overwhelming TM1 with hundreds of simultaneous requests.
async function batch(items, size, fn) {
    for (let i = 0; i < items.length; i += size) {
        await Promise.all(items.slice(i, i + size).map(fn))
    }
}

// Read all attribute values for a dimension in one MDX call against the
// }ElementAttributes control cube, rather than N per-element calls.
async function fetchAttributeValues(client, dim, hier) {
    const attrCube = `}ElementAttributes_${dim}`
    const mdx = [
        `SELECT {TM1SUBSETALL([${attrCube}].[${attrCube}])} ON COLUMNS,`,
        `{TM1SUBSETALL([${dim}].[${hier}])} ON ROWS`,
        `FROM [${attrCube}]`,
    ].join(' ')

    try {
        const result = await client.executeMDX(mdx, 500_000)
        const colTuples = result.Axes?.find(a => a.Ordinal === 0)?.Tuples ?? []
        const rowTuples = result.Axes?.find(a => a.Ordinal === 1)?.Tuples ?? []
        const cells     = result.Cells ?? []
        const colCount  = colTuples.length

        const attrNames = colTuples.map(t => t.Members?.[0]?.Name)
        const values    = {}

        rowTuples.forEach((rowTuple, ri) => {
            const el = rowTuple.Members?.[0]?.Name
            if (!el) return
            const row = {}
            attrNames.forEach((attr, ci) => {
                const val = cells[ri * colCount + ci]?.Value
                if (val !== null && val !== undefined && val !== '') row[attr] = val
            })
            if (Object.keys(row).length) values[el] = row
        })

        return values
    } catch {
        // Attribute cube may not exist (dimension has no attributes) — not an error
        return {}
    }
}

async function snapshotDimension(client, dimName) {
    const hierNames  = await client.getHierarchies(dimName)
    const hierarchies = {}

    for (const hier of hierNames) {
        const [elements, edges, attrs] = await Promise.all([
            client.getElementsWithTree(dimName, hier).catch(() => []),
            client.getEdges(dimName, hier).catch(() => []),
            client.getElementAttributes(dimName, hier).catch(() => []),
        ])

        const attributeValues = attrs.length
            ? await fetchAttributeValues(client, dimName, hier)
            : {}

        hierarchies[hier] = { elements, edges, attributes: attrs, attribute_values: attributeValues }
    }

    return hierarchies
}

async function snapshotCubes(client, cubeNames) {
    const cubes = {}
    await batch(cubeNames, 10, async name => {
        try {
            const cube = await client.getCube(name)
            cubes[name] = {
                dimensions: (cube?.Dimensions ?? []).map(d => d.Name),
                rules:      cube?.Rules ?? '',
            }
        } catch (e) {
            console.warn(`  [warn] cube ${name}: ${e.message}`)
        }
    })
    return cubes
}

async function snapshotProcesses(client, processNames) {
    const processes = {}
    await batch(processNames, 10, async name => {
        try {
            const p = await client.getProcess(name)
            processes[name] = {
                PrologProcedure:   p.PrologProcedure                        ?? '',
                MetadataProcedure: p.MetaDataProcedure ?? p.MetadataProcedure ?? '',
                DataProcedure:     p.DataProcedure                          ?? '',
                EpilogProcedure:   p.EpilogProcedure                        ?? '',
                Parameters:        p.Parameters ?? [],
                Variables:         p.Variables  ?? [],
                DataSource:        p.DataSource  ?? { Type: 'None' },
            }
        } catch (e) {
            console.warn(`  [warn] process ${name}: ${e.message}`)
        }
    })
    return processes
}

async function snapshotChores(client, choreNames) {
    const chores = {}
    await batch(choreNames, 5, async name => {
        try {
            const c = await client.getChore(name)
            chores[name] = {
                Active:       c.Active       ?? false,
                StartTime:    c.StartTime    ?? null,
                DSTSensitive: c.DSTSensitive ?? false,
                Frequency:    c.Frequency    ?? null,
                Steps: (c.Steps ?? []).map(s => ({
                    Process:    { Name: s.Process?.Name },
                    Parameters: s.Parameters ?? [],
                })),
            }
        } catch (e) {
            console.warn(`  [warn] chore ${name}: ${e.message}`)
        }
    })
    return chores
}

async function snapshotSubsets(client, dimNames) {
    const subsets = {}
    for (const dim of dimNames) {
        try {
            const hierNames = await client.getHierarchies(dim)
            subsets[dim] = {}
            for (const hier of hierNames) {
                const subs = await client.getSubsets(dim, hier).catch(() => [])
                if (!subs.length) continue
                subsets[dim][hier] = {}
                await batch(subs, 10, async s => {
                    try {
                        if (s.Expression) {
                            subsets[dim][hier][s.Name] = { expression: s.Expression }
                        } else {
                            // Static subset — capture element list
                            const els = await client.getSubsetElements(dim, s.Name, hier)
                            subsets[dim][hier][s.Name] = { elements: els.map(e => e.name) }
                        }
                    } catch (e) {
                        console.warn(`  [warn] subset ${dim}/${s.Name}: ${e.message}`)
                        subsets[dim][hier][s.Name] = {}
                    }
                })
            }
        } catch (e) {
            console.warn(`  [warn] subsets for ${dim}: ${e.message}`)
        }
    }
    return subsets
}

function normAxes(vws) {
    const axis = (placements) => (placements ?? []).map(p => ({
        dim:    p.dimension,
        subset: p.subset   ?? null,
        expr:   p.members  ? [...p.members].sort().join(',') : null,
        all:    p.memberSet ?? null,
    }))
    return {
        rows:   axis(vws._rows),
        cols:   axis(vws._columns),
        titles: (vws._titles ?? []).map(t => ({ dim: t.dimension, member: t.member ?? null })),
    }
}

async function snapshotViews(client, cubeNames) {
    const views = {}
    for (const cube of cubeNames) {
        try {
            const viewList = await client.getViews(cube)
            if (!viewList.length) continue
            views[cube] = {}
            await batch(viewList, 5, async v => {
                try {
                    if (v.type === 'mdx') {
                        const vDef = await client.getView(cube, v.name)
                        if (!vDef) return
                        views[cube][v.name] = { type: 'mdx', MDX: vDef.MDX ?? '' }
                    } else {
                        const vws = await client.getViewWithSubsets(cube, v.name)
                        if (!vws) return
                        views[cube][v.name] = { type: 'native', axes: normAxes(vws) }
                    }
                } catch (e) {
                    console.warn(`  [warn] view ${cube}/${v.name}: ${e.message}`)
                }
            })
        } catch (e) {
            console.warn(`  [warn] views for ${cube}: ${e.message}`)
        }
    }
    return views
}

async function takeSnapshot(server, ideToken) {
    const client    = makeClient(server, ideToken)
    const seeded_at = new Date().toISOString()

    console.log(`\nConnecting → TM1 server: ${server}`)

    // Fetch all top-level names in parallel
    console.log('Fetching object lists...')
    const [dimNames, cubeNames, processNames, choreNames] = await Promise.all([
        client.getDimensions(),
        client.getCubes(),
        client.getProcesses(),
        client.getChores(),
    ])
    console.log(`  ${dimNames.length} dimensions  ${cubeNames.length} cubes  ${processNames.length} processes  ${choreNames.length} chores`)

    // Dimensions (elements, edges, attribute defs, attribute values)
    console.log('\nSnapshotting dimensions...')
    const dimensions = {}
    await batch(dimNames, 3, async dim => {
        process.stdout.write(`  ${dim} `)
        try {
            dimensions[dim] = { hierarchies: await snapshotDimension(client, dim) }
            process.stdout.write('✓\n')
        } catch (e) {
            process.stdout.write(`✗ ${e.message}\n`)
        }
    })

    // Cubes (dimension list + rules)
    console.log('\nSnapshotting cubes...')
    const cubes = await snapshotCubes(client, cubeNames)
    console.log(`  ${Object.keys(cubes).length}/${cubeNames.length} cubes done`)

    // Processes (full code + params + datasource)
    console.log('\nSnapshotting processes...')
    const processes = await snapshotProcesses(client, processNames)
    console.log(`  ${Object.keys(processes).length}/${processNames.length} processes done`)

    // Chores (schedule + steps)
    console.log('\nSnapshotting chores...')
    const chores = await snapshotChores(client, choreNames)
    console.log(`  ${Object.keys(chores).length}/${choreNames.length} chores done`)

    // Subsets (MDX expression or static element list)
    console.log('\nSnapshotting subsets...')
    const subsets = await snapshotSubsets(client, dimNames)
    const subsetCount = Object.values(subsets).reduce((n, h) => n + Object.values(h).reduce((m, s) => m + Object.keys(s).length, 0), 0)
    console.log(`  ${subsetCount} subsets done`)

    // Views (MDX string or native definition)
    console.log('\nSnapshotting views...')
    const views = await snapshotViews(client, cubeNames)
    const viewCount = Object.values(views).reduce((n, v) => n + Object.keys(v).length, 0)
    console.log(`  ${viewCount} views done`)

    return {
        _meta: {
            server,
            seeded_at,
            seeded_by: process.env.TM1_USER ?? process.env.PAW_USERNAME ?? 'unknown',
            counts: {
                dimensions: dimNames.length,
                cubes:      cubeNames.length,
                processes:  processNames.length,
                chores:     choreNames.length,
                subsets:    subsetCount,
                views:      viewCount,
            },
        },
        dimensions,
        cubes,
        processes,
        chores,
        subsets,
        views,
    }
}

async function seed(server, outputPath, ideToken) {
    const snapshot = await takeSnapshot(server, ideToken)

    const dir = path.dirname(outputPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    fs.writeFileSync(outputPath, JSON.stringify(snapshot))

    const sizeKB = Math.round(fs.statSync(outputPath).size / 1024)
    console.log(`\nBaseline written → ${outputPath} (${sizeKB} KB)`)

    return snapshot
}

// Scoped snapshot — captures current state of only the objects in a manifest
// from the target server. Used for pre/post deploy comparison in archives.
async function scopedSnapshot(manifest, targetServer, ideToken) {
    const client  = makeClient(targetServer, ideToken)
    const objects = manifest.objects ?? []
    const result  = { taken_at: new Date().toISOString(), target: targetServer, objects: {} }

    await batch(objects, 5, async obj => {
        const key = `${obj.type}::${obj.name}${obj.detail ? `::${obj.detail}` : ''}`
        try {
            switch (obj.type) {
                case 'rules': {
                    const cube = await client.getCube(obj.name).catch(() => null)
                    result.objects[key] = cube ? { rules: cube.Rules ?? '' } : null
                    break
                }
                case 'process': {
                    const p = await client.getProcess(obj.name).catch(() => null)
                    if (!p) { result.objects[key] = null; break }
                    result.objects[key] = {
                        PrologProcedure:   p.PrologProcedure   ?? '',
                        MetadataProcedure: p.MetaDataProcedure ?? p.MetadataProcedure ?? '',
                        DataProcedure:     p.DataProcedure     ?? '',
                        EpilogProcedure:   p.EpilogProcedure   ?? '',
                    }
                    break
                }
                case 'subset': {
                    const dim = obj.detail
                    if (!dim) { result.objects[key] = null; break }
                    const subs = await client.getSubsets(dim, dim).catch(() => [])
                    const sub  = subs.find(s => s.Name?.toLowerCase() === obj.name.toLowerCase())
                    if (!sub) { result.objects[key] = null; break }
                    if (sub.Expression) {
                        result.objects[key] = { expression: sub.Expression }
                    } else {
                        const els = await client.getSubsetElements(dim, obj.name, dim).catch(() => [])
                        result.objects[key] = { elements: els.map(e => e.name ?? e.Name) }
                    }
                    break
                }
                case 'view': {
                    const cube = obj.detail
                    if (!cube) { result.objects[key] = null; break }
                    const views = await client.getViews(cube).catch(() => [])
                    const v = views.find(vw => vw.name?.toLowerCase() === obj.name.toLowerCase())
                    if (!v) { result.objects[key] = null; break }
                    if (v.type === 'mdx') {
                        const vd = await client.getView(cube, obj.name).catch(() => null)
                        result.objects[key] = vd ? { type: 'mdx', MDX: vd.MDX ?? '' } : null
                    } else {
                        const vws = await client.getViewWithSubsets(cube, obj.name).catch(() => null)
                        result.objects[key] = vws ? { type: 'native', axes: normAxes(vws) } : null
                    }
                    break
                }
                case 'dimension': {
                    const [elements, edges] = await Promise.all([
                        client.getElementsWithTree(obj.name, obj.name).catch(() => []),
                        client.getEdges(obj.name, obj.name).catch(() => []),
                    ])
                    result.objects[key] = { elementCount: elements.length, edgeCount: edges.length }
                    break
                }
                case 'attribute': {
                    const dim = obj.detail
                    if (!dim) { result.objects[key] = null; break }
                    const attrs = await client.getElementAttributes(dim).catch(() => [])
                    const attr  = attrs.find(a => a.Name?.toLowerCase() === obj.name.toLowerCase())
                    result.objects[key] = attr ? { Name: attr.Name, Type: attr.Type } : null
                    break
                }
                default:
                    result.objects[key] = null
            }
        } catch (e) {
            result.objects[key] = { error: e.message }
        }
    })

    return result
}

module.exports = { seed, takeSnapshot, scopedSnapshot }
