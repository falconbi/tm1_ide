'use strict'

require('dotenv').config()

const express   = require('express')
const path      = require('path')
const fs        = require('fs')
const Anthropic = require('@anthropic-ai/sdk')
const { TM1Client } = require('./core/tm1_client')

const FORGE_PATH = path.join(__dirname, 'config', 'forge.json')

const anthropic = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY })

const app  = express()
const PORT = process.env.PORT || 8083

app.use(express.json())
app.use(express.static(path.join(__dirname, 'static'), {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store')
    }
}))

// ── Servers ───────────────────────────────────────────────────────────────────
app.get('/api/servers', (req, res) => {
    try {
        const servers = require('./config/servers.json')
        res.json(servers.map(s => s.name))
    } catch {
        res.json([])
    }
})

// ── Cubes ─────────────────────────────────────────────────────────────────────
app.get('/api/cubes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getCubes())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Dimensions ────────────────────────────────────────────────────────────────
app.get('/api/dimensions', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getDimensions())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Processes ─────────────────────────────────────────────────────────────────
app.get('/api/processes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getProcesses())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Chores ────────────────────────────────────────────────────────────────────
app.get('/api/chores', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getChores())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Rules ─────────────────────────────────────────────────────────────────────
app.get('/api/rules', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const cube   = await client.getCube(req.query.cube)
        res.json({ rules: cube?.Rules ?? '' })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/rules', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.patch(`Cubes('${req.query.cube}')`, { Rules: req.body.rules })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Process detail + execute ──────────────────────────────────────────────────
app.get('/api/process', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getProcess(req.query.name))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/process', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.patch(`Processes('${req.query.name}')`, req.body)
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/process/run', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const result = await client.executeProcess(req.query.name, req.body.params ?? {})
        res.json({ ok: true, result })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Cube dimensions ───────────────────────────────────────────────────────────
app.get('/api/cube/dimensions', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const cube   = await client.getCube(req.query.cube)
        const dims   = (cube?.Dimensions ?? []).map(d => d.Name)
        res.json(dims)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Dimension attributes ──────────────────────────────────────────────────────
app.get('/api/dimension/attributes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const attrs  = await client.getElementAttributes(req.query.dimension)
        res.json(attrs.map(a => ({ name: a.Name, type: a.Type })))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimension/cubes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getCubesForDimension(req.query.dimension))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Attribute grid (all elements × all attrs in one response) ─────────────────
app.get('/api/dimension/attr-grid', async (req, res) => {
    try {
        const { server, dimension, hierarchy } = req.query
        const client = new TM1Client(server)
        const [attrs, elements, edges] = await Promise.all([
            client.getElementAttributes(dimension, hierarchy),
            client.getElements(dimension, hierarchy),
            client.getEdges(dimension, hierarchy),
        ])
        const valueEntries = await Promise.all(
            elements.map(async el => {
                try { return [el.Name, await client.getElementAttributeValues(dimension, el.Name, hierarchy)] }
                catch  { return [el.Name, {}] }
            })
        )
        res.json({ attrs, elements, edges, values: Object.fromEntries(valueEntries) })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/dimension/attribute-def', async (req, res) => {
    try {
        const { server, dimension, name, type, hierarchy } = req.body
        await new TM1Client(server).createElementAttribute(dimension, name, type, hierarchy)
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/dimension/attribute-def', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        await new TM1Client(server).deleteElementAttribute(dimension, name, hierarchy)
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/element/attribute', async (req, res) => {
    try {
        const { server, dimension, element, attribute, value, type, hierarchy } = req.body
        await new TM1Client(server).writeElementAttribute(dimension, element, attribute, value, type, hierarchy)
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Views ─────────────────────────────────────────────────────────────────────
app.get('/api/views', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getViews(req.query.cube))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/view', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getView(req.query.cube, req.query.name))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/view/execute', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.executeView(req.query.cube, req.query.view))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/view/save', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.saveView(req.query.cube, req.query.name, req.body.mdx)
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── Elements ──────────────────────────────────────────────────────────────────
app.get('/api/elements', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getElements(req.query.dimension, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/elements/attributes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getElementsWithAttributes(req.query.dimension, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/element/attributes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getElementAttributeValues(req.query.dimension, req.query.element, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/edges', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getEdges(req.query.dimension, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Attribute debug — try multiple approaches to see what PAW returns ─────────
app.get('/api/debug/element-attrs', async (req, res) => {
    const { server, dimension } = req.query
    const client = new TM1Client(server)
    const results = {}

    // Approach A: $expand=Attributes on elements collection
    try {
        results.expandOnCollection = await client.get(
            `Dimensions('${dimension}')/Hierarchies('${dimension}')/Elements`,
            { '$expand': 'Attributes', '$top': '2' }
        )
    } catch (e) { results.expandOnCollection = { error: e.message, status: e.response?.status } }

    // Approach B: fetch first element's /Attributes sub-resource directly
    try {
        const els = await client.get(
            `Dimensions('${dimension}')/Hierarchies('${dimension}')/Elements`,
            { '$select': 'Name', '$top': '1' }
        )
        const firstName = els.value?.[0]?.Name
        if (firstName) {
            results.firstElementName = firstName
            results.directSubResource = await client.get(
                `Dimensions('${dimension}')/Hierarchies('${dimension}')/Elements('${firstName}')/Attributes`
            )
        }
    } catch (e) { results.directSubResource = { error: e.message, status: e.response?.status } }

    // Approach C: ElementAttributes (attribute definitions)
    try {
        results.attrDefinitions = await client.get(
            `Dimensions('${dimension}')/Hierarchies('${dimension}')/ElementAttributes`,
            { '$select': 'Name,Type', '$top': '10' }
        )
    } catch (e) { results.attrDefinitions = { error: e.message, status: e.response?.status } }

    res.json(results)
})

// ── Attribute write probe ─────────────────────────────────────────────────────
app.post('/api/test/attr-write', async (req, res) => {
    try {
        const { server, dimension } = req.body
        const client = new TM1Client(server)

        // Get first element that has at least one attribute value set
        const els = await client.get(
            `Dimensions('${dimension}')/Hierarchies('${dimension}')/Elements`,
            { '$select': 'Name', '$top': '20' }
        )
        let candidate = null
        let attrName = null
        let attrValue = null
        for (const el of (els.value ?? [])) {
            const attrs = await client.getElementAttributeValues(dimension, el.Name)
            const entry = Object.entries(attrs).find(([, v]) => v !== null && v !== '' && v !== 0)
            if (entry) {
                candidate = el.Name
                ;[attrName, attrValue] = entry
                break
            }
        }
        if (!candidate) {
            return res.json({ skipped: true, reason: 'No element with a non-empty attribute value found. Set at least one attribute value first.' })
        }

        console.log(`[attr-write-probe] dim=${dimension} element=${candidate} attr=${attrName} value=${JSON.stringify(attrValue)}`)
        const [r1, r2] = await Promise.all([
            client.probeAttributeValueWrite(dimension, candidate, attrName, attrValue),
            client.probeAttributeWrite(dimension, candidate, attrName, attrValue),
        ])
        res.json({ element: candidate, attribute: attrName, value: attrValue, ...r1, ...r2 })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Dimension element + edge write ───────────────────────────────────────────
app.post('/api/dimension/element', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.addElement(req.query.dimension, req.body.name, req.body.type, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/element', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteElement(req.query.dimension, req.query.name, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/dimension/element', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.renameElement(req.query.dimension, req.query.name, req.body.newName, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/dimension/edge', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.addEdge(req.query.dimension, req.body.parent, req.body.child, req.body.weight ?? 1, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/dimension/edge', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.updateEdgeWeight(req.query.dimension, req.query.parent, req.query.child, req.body.weight, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/edge', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        await client.deleteEdge(req.query.dimension, req.query.parent, req.query.child, req.query.hierarchy)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/hierarchies', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getHierarchies(req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/subset/usage', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.scanSubsetUsage(req.query.dimension, req.query.subset))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/dimension/hierarchy', async (req, res) => {
    try {
        const { server, dimension, name } = req.body
        await new TM1Client(server).createHierarchy(dimension, name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/hierarchy', async (req, res) => {
    try {
        const { server, dimension, name } = req.query
        await new TM1Client(server).deleteHierarchy(dimension, name)
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Search index — all rules + all process code in one call ──────────────────
app.get('/api/search/index', async (req, res) => {
    try {
        const client  = new TM1Client(req.query.server)
        const [cubes, processes] = await Promise.all([
            client.getCubes(),
            client.getProcesses(),
        ])

        const [rulesResults, processResults] = await Promise.all([
            Promise.all(cubes.map(async name => {
                const cube = await client.getCube(name)
                return { name, rules: cube?.Rules ?? '' }
            })),
            Promise.all(processes.map(async name => {
                const p = await client.getProcess(name)
                return {
                    name,
                    Prolog:   p.PrologProcedure   ?? '',
                    Metadata: p.MetaDataProcedure ?? '',
                    Data:     p.DataProcedure     ?? '',
                    Epilog:   p.EpilogProcedure   ?? '',
                }
            })),
        ])

        res.json({ rules: rulesResults, processes: processResults })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Subsets ───────────────────────────────────────────────────────────────────
app.get('/api/subsets', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getSubsets(req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/subset', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getSubset(req.query.dimension, req.query.name))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/subset', async (req, res) => {
    console.log('[subset/save] dim=%s name=%s mdx=%s', req.query.dimension, req.query.name, (req.body.mdx ?? '').slice(0, 80))
    try {
        const client = new TM1Client(req.query.server)
        await client.saveSubset(req.query.dimension, req.query.name, req.body.mdx)
        console.log('[subset/save] OK')
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        console.error('[subset/save] ERROR:', detail)
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.get('/api/subset/elements', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.getSubsetElements(req.query.dimension, req.query.name))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/subset/static', async (req, res) => {
    console.log('[subset/static] dim=%s name=%s count=%d', req.query.dimension, req.query.name, (req.body.elements ?? []).length)
    try {
        const client = new TM1Client(req.query.server)
        await client.saveStaticSubset(req.query.dimension, req.query.name, req.body.elements)
        console.log('[subset/static] OK')
        res.json({ ok: true })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        console.error('[subset/static] ERROR:', detail)
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.post('/api/subset/preview', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const members = await client.previewMDX(req.query.dimension, req.body.mdx, req.body.limit ?? 100)
        res.json({ members })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        console.error('[subset/preview]', detail)
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

app.post('/api/subset/generate', async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set in .env' })
    }
    try {
        const { server, dimension, prompt } = req.body
        const client   = new TM1Client(server)
        const elements = await client.getElements(dimension)
        const sample   = elements.slice(0, 200).map(e => `${e.Name} (${e.Type === 'N' ? 'leaf' : e.Type === 'C' ? 'consolidated' : 'string'}, level ${e.Level})`).join('\n')

        const message = await anthropic.messages.create({
            model:      'claude-opus-4-7',
            max_tokens: 1024,
            system: `You are a TM1 MDX expert. Generate a valid TM1 MDX set expression for the given dimension.
Rules:
- Return ONLY the raw MDX expression — no markdown, no explanation, no code fences.
- The expression MUST be wrapped in outer curly braces {} to form a valid set literal.
- Use the dimension name exactly as provided.
- Reference members as [{dim}].[{dim}].[MemberName] or use set functions directly.
- Common functions: TM1FilterByLevel, TM1FilterByPattern, TM1Sort, TopCount, BottomCount, Filter, CrossJoin, Descendants, Children, Ancestors, Members.
- Leaf members are Type=N (level 0). Consolidated members are Type=C (level > 0).
- Example: {TM1FilterByLevel({[{dim}].[{dim}].Members}, 0)}`.replaceAll('{dim}', dimension),
            messages: [{
                role: 'user',
                content: `Dimension: ${dimension}\n\nSample elements (up to 200):\n${sample}\n\nRequest: ${prompt}`,
            }],
        })

        const mdx = message.content[0].text.trim()
        res.json({ mdx })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── View → axis config (execute view, return cellset + axis dim names) ───────
app.get('/api/view/axes', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const [data, viewDef] = await Promise.all([
            client.executeView(req.query.cube, req.query.view),
            client.getViewWithSubsets(req.query.cube, req.query.view),
        ])
        // Parse dimension names from UniqueName: [Dim].[Hier].[Member] → Dim
        const parseDim = (uniqueName) => uniqueName?.match(/^\[([^\]]+)\]/)?.[1] ?? null
        const axisConfig = data.Axes.map(ax => ({
            ordinal: ax.Ordinal,
            dimensions: [...new Set(
                (ax.Tuples?.[0]?.Members ?? []).map(m => parseDim(m.UniqueName)).filter(Boolean)
            )],
            selectedMembers: ax.Ordinal === 2
                ? (ax.Tuples?.[0]?.Members ?? []).map(m => ({ dimension: parseDim(m.UniqueName), member: m.Name }))
                : [],
        }))
        // Also return native view axis config with subsets
        const nativeConfig = viewDef ? {
            rows:    viewDef._rows    ?? (viewDef.Rows ?? []).map(r => ({ dimension: r.DimensionName ?? r.Name, subset: r.SubsetName ?? r.Subset?.Name ?? null })),
            columns: viewDef._columns ?? (viewDef.Columns ?? []).map(c => ({ dimension: c.DimensionName ?? c.Name, subset: c.SubsetName ?? c.Subset?.Name ?? null })),
            titles:  viewDef._titles  ?? (viewDef.Titles ?? []).map(t => ({ dimension: t.DimensionName ?? t.Name, member: t.Selection?.Name ?? null })),
        } : null
        // For MDX views, return the MDX text so the client can parse it back to axes
        const mdxText = (viewDef && viewDef['@odata.type']?.includes('MDXView')) ? (viewDef.MDX || null) : null
        res.json({ axisConfig, cellset: data, viewType: data.ViewType, nativeConfig, mdx: mdxText })
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── MDX Execute ──────────────────────────────────────────────────────────────
app.post('/api/mdx/execute', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        res.json(await client.executeMDX(req.body.mdx))
    } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.response?.data ?? e.message
        res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    }
})

// ── Rules lineage ─────────────────────────────────────────────────────────────
function parseDbRefs(rules) {
    const refs = new Set()
    const re = /\bDB[S]?\s*\(\s*'([^']+)'/gi
    let m
    while ((m = re.exec(rules)) !== null) refs.add(m[1])
    return [...refs]
}

app.get('/api/lineage', async (req, res) => {
    try {
        const client   = new TM1Client(req.query.server)
        const root     = req.query.cube
        const maxDepth = Math.min(parseInt(req.query.depth ?? '4'), 6)
        const visited  = new Set()
        const tree     = {}

        async function traverse(cube, depth) {
            if (depth === 0 || visited.has(cube)) return
            visited.add(cube)
            try {
                const data   = await client.getCube(cube)
                const rules  = data?.Rules ?? ''
                const sources = parseDbRefs(rules)
                tree[cube]   = { sources, hasRules: rules.trim().length > 0 }
                await Promise.all(sources.map(s => traverse(s, depth - 1)))
            } catch {
                tree[cube] = { sources: [], hasRules: false, error: true }
            }
        }

        await traverse(root, maxDepth)
        res.json({ root, tree })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/lineage/consumers', async (req, res) => {
    try {
        const client = new TM1Client(req.query.server)
        const target = req.query.cube
        const cubes  = await client.getCubes()
        const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re      = new RegExp(`\\bDB[S]?\\s*\\(\\s*'${escaped}'`, 'i')

        const consumers = (await Promise.all(
            cubes
                .filter(name => name !== target)
                .map(async name => {
                    try {
                        const data = await client.getCube(name)
                        return re.test(data?.Rules ?? '') ? name : null
                    } catch { return null }
                })
        )).filter(Boolean)

        res.json({ cube: target, consumers })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// ── Forge (workspace persistence) ────────────────────────────────────────────
app.get('/api/forge', (req, res) => {
    try {
        const data = fs.existsSync(FORGE_PATH)
            ? JSON.parse(fs.readFileSync(FORGE_PATH, 'utf8'))
            : {}
        res.json(data)
    } catch { res.json({}) }
})

app.post('/api/forge', (req, res) => {
    try {
        fs.mkdirSync(path.dirname(FORGE_PATH), { recursive: true })
        fs.writeFileSync(FORGE_PATH, JSON.stringify(req.body, null, 2))
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'ide.html'))
})

app.listen(PORT, () => {
    console.log(`TM1 IDE running at http://localhost:${PORT}`)
})
