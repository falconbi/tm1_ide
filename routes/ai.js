'use strict'

function register(app, deps) {
    const { LENS_CATALOGUE, ai, lensBridge, makeClient, obfuscate } = deps

app.post('/api/subset/generate', async (req, res) => {
    if (!ai.isConfigured()) {
        return res.status(400).json({ error: 'AI not configured — set AI_PROVIDER and AI_API_KEY in .env' })
    }
    try {
        const { server, dimension, prompt } = req.body
        const client   = makeClient(server, req.ideToken)
        const elements = await client.getElements(dimension)

        // Obfuscation (AI_OBFUSCATE_NAMES): swap every real name for an opaque
        // token before the request leaves, restore it in the response.
        const obf      = ai.shouldObfuscate()
        const map      = obfuscate.makeMap([dimension, ...elements.slice(0, 200).map(e => e.Name)])
        const hide     = obf ? t => obfuscate.obfuscateText(t, map.realToCode) : t => t
        const show     = obf ? t => obfuscate.restoreText(t, map.codeToReal)      : t => t
        const dimRef   = obf ? map.realToCode.get(dimension) : dimension

        const sample   = elements.slice(0, 200).map(e => `${e.Name} (${e.Type === 'N' ? 'leaf' : e.Type === 'C' ? 'consolidated' : 'string'}, level ${e.Level})`).join('\n')

        const mdx = await ai.complete({
            label: 'subset-generate', obfuscated: obf,
            maxTokens: 1024,
            system: `You are a TM1 MDX expert. Generate a valid TM1 MDX set expression for the given dimension.
Rules:
- Return ONLY the raw MDX expression — no markdown, no explanation, no code fences.
- The expression MUST be wrapped in outer curly braces {} to form a valid set literal.
- Use the dimension name exactly as provided.
- Reference members as [{dim}].[{dim}].[MemberName] or use set functions directly.
- Common functions: TM1FilterByLevel, TM1FilterByPattern, TM1Sort, TopCount, BottomCount, Filter, CrossJoin, Descendants, Children, Ancestors, Members.
- Leaf members are Type=N (level 0). Consolidated members are Type=C (level > 0).
- Example: {TM1FilterByLevel({[{dim}].[{dim}].Members}, 0)}`.replaceAll('{dim}', dimRef),
            user: hide(`Dimension: ${dimension}\n\nSample elements (up to 200):\n${sample}\n\nRequest: ${prompt}`),
        })

        res.json({ mdx: show(mdx) })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/mdx/generate', async (req, res) => {
    if (!ai.isConfigured()) {
        return res.status(400).json({ error: 'AI not configured — set AI_PROVIDER and AI_API_KEY in .env' })
    }
    try {
        const { server, cube, prompt } = req.body
        const client = makeClient(server, req.ideToken)
        const cubeMeta = await client.getCube(cube)
        const dims = (cubeMeta?.Dimensions ?? []).map(d => d.Name)

        // Fetch element samples for each dimension in parallel (max 60 per dim)
        const dimSamples = await Promise.all(dims.map(async dim => {
            try {
                const elems = await client.getElements(dim)
                const leaves = elems.filter(e => e.Type === 'N').slice(0, 30).map(e => e.Name)
                const consol = elems.filter(e => e.Type === 'C').slice(0, 20).map(e => e.Name)
                return { dim, leaves, consol, total: elems.length }
            } catch { return { dim, leaves: [], consol: [], total: 0 } }
        }))

        const dimContext = dimSamples.map(({ dim, leaves, consol, total }) => {
            const parts = []
            if (consol.length) parts.push(`  Consolidated: ${consol.join(', ')}`)
            if (leaves.length) parts.push(`  Leaf: ${leaves.join(', ')}`)
            return `${dim} (${total} elements)\n${parts.join('\n')}`
        }).join('\n\n')

        // Obfuscation (AI_OBFUSCATE_NAMES): hide every real cube/dim/element name
        // in what we send; the model still sees structure. Restore in response.
        const obf = ai.shouldObfuscate()
        const map = obfuscate.makeMap([
            cube,
            ...dimSamples.flatMap(d => [d.dim, ...d.leaves, ...d.consol]),
        ])
        const hide = obf ? t => obfuscate.obfuscateText(t, map.realToCode) : t => t
        const show = obf ? t => obfuscate.restoreText(t, map.codeToReal)      : t => t

        const mdx = await ai.complete({
            label: 'mdx-generate', obfuscated: obf,
            maxTokens: 2048,
            system: `You are a TM1 MDX expert. Generate a valid TM1 MDX SELECT query for the given cube.
Rules:
- Return ONLY the raw MDX — no markdown, no explanation, no code fences.
- Use standard TM1 MDX syntax: SELECT ... ON COLUMNS, ... ON ROWS FROM [Cube] WHERE (...)
- Reference members as [Dim].[Dim].[MemberName]
- Sets must be wrapped in {}. Use NON EMPTY where appropriate.
- The last dimension is typically the measures dimension and goes ON COLUMNS.
- Common set functions: TM1FilterByLevel, TM1FilterByPattern, TM1Sort, TopCount, BottomCount, Filter, Children, Descendants, Members, CrossJoin.
- Leaf members are level-0 numeric elements. Consolidated members are higher-level aggregations.
- If only one dimension member is needed for a dimension, use it as a WHERE slicer, not ON an axis.
- Keep it correct and executable. If uncertain about a member name, use a safe set like {[Dim].[Dim].Members}.`,
            user: hide(`Cube: ${cube}\n\nDimensions and sample members:\n${dimContext}\n\nRequest: ${prompt}`),
        })

        res.json({ mdx: show(mdx) })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/lenses/generate', async (req, res) => {
    try {
        const { server, cube, description } = req.body
        if (!description?.trim()) return res.status(400).json({ error: 'description is required' })
        const client = makeClient(server, req.ideToken)
        const meta = await lensBridge.getMeta(client, cube)

        // No AI key → return a model-aware starter lens so the editor always works.
        if (!ai.isConfigured()) {
            return res.json({ html: lensBridge.buildStarterLens(meta, cube), mode: 'starter' })
        }

        const obf = ai.shouldObfuscate()
        const names = [
            ...(meta.cubes ?? []), ...(meta.dimensions ?? []), ...(meta.cubeDims ?? []),
            ...Object.values(meta.elements ?? {}).flat(),
        ]
        const map = obfuscate.makeMap(names)
        const hide = obf ? t => obfuscate.obfuscateText(t, map.realToCode) : t => t
        const show = obf ? t => obfuscate.restoreText(t, map.codeToReal) : t => t

        let html
        try {
            html = await ai.complete({
                label: 'lens-generate', obfuscated: obf, maxTokens: 8000,
                system: `You are a front-end developer building an executive dashboard that runs inside a sandboxed iframe and reads live IBM Planning Analytics (TM1) data.

The ONLY way to get data is the bridge API below. There is NO network access, no fetch to any other URL, no CDN, no external fonts or images. The ONLY library is the Lens toolkit, served by the app: include <script src="/lens-kit/lens-kit.js"></script> before your own script.

Bridge API (always available):
  window.lensBridge.call('execMDX', { mdx: '<MDX SELECT>' }) -> Promise<{ Axes, Cells }>
      Cells: [{ Ordinal, Value, FormattedValue, RuleDerived, Consolidated }] — Value is a number or null.
  window.lensBridge.call('readCell', { cube: '<cube>', coordinates: { '<dim>': '<elem>', ... } }) -> Promise<number|string|null>
      coordinates must name EVERY dimension of the cube.
  window.lensBridge.call('getMeta', { cube: '<cube>' }) -> Promise<{ cubes, dimensions, cubeDims, elements }>
  window.lensBridge.call('elementTree', { dimension: '<dim>', hierarchy: '<hier>' }) -> Promise<[{ Name, Type, Level, Components }]>  (one dimension's tree; Lens.pivot uses it for drill-down; hierarchy optional, e.g. an ALT H)
  window.lensBridge.call('hierarchies', { dimension: '<dim>' }) -> Promise<[name]>  (the dimension's hierarchies: its main one and any ALT H)

Rules:
- Return a SINGLE complete HTML document (html, head, style, body, script). No markdown, no code fences, no explanation.
- Use the Lens toolkit (window.Lens) for charts, tables and networks wherever a component fits — it is described in the catalogue below. Turn every execMDX result into rows with Lens.rows(result). Write your own SVG/canvas only for a visual no component covers. No other external anything.

Lens toolkit catalogue:
${LENS_CATALOGUE}
- Style it as a polished executive dashboard: card layout, clear hierarchy, good typography, whitespace, a coherent color scheme. Add a small refresh button that re-runs the data calls.
- All numbers must come from the bridge at runtime — never hard-code values.
- Only build input (write-back) when the request asks for it: an editable Lens.grid plus Lens.save, and declare the cube in the head with <meta name="lens-writes" content="Cube Name">.
- Only add action buttons when asked: Lens.run('Process', { params }), declared with <meta name="lens-runs" content="Process Name">.
- Use EXACT cube/dimension/element names from the model context. In MDX reference members as [Dim].[Dim].[Member].
- Prefer readCell for single values and execMDX for series/sets. Keep MDX simple and correct. The Measures dimension is typically the last one — put it on columns.
- Render loading states and handle null/empty values gracefully (show '—').`,
                user: hide(`Model context:\n${JSON.stringify(meta)}\n\nBuild a lens described as: ${description}`),
            })
        } catch (e) {
            return res.json({ html: lensBridge.buildStarterLens(meta, cube), mode: 'starter', note: `AI call failed (${e.message}) — returned a starter lens instead.` })
        }

        res.json({ html: show(html), mode: 'ai' })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})
}

module.exports = { register }
