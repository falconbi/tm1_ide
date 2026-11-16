'use strict'

function register(app, deps) {
    const { cl, extractMembersFromExpression, fail, gateWrite, getViewSourceUsage, makeClient, scanIdentity } = deps

app.get('/api/views', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getViews(req.query.cube))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/view', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getView(req.query.cube, req.query.name))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/view/preview-records', async (req, res) => {
    try {
        const { server, cube, view } = req.query
        res.json(await makeClient(server, req.ideToken).previewViewRecords(cube, view, 20))
    } catch (e) { fail(res, e) }
})

app.post('/api/view/save', async (req, res) => {
    try {
        const { server, cube, name } = req.query
        const { mdx, nativeAxes } = req.body
        if (!gateWrite(res, server)) return
        const client  = makeClient(server, req.ideToken)
        const current = await client.getView(cube, name).catch(() => null)
        const beforeState = current
            ? current['@odata.type']?.includes('MDXView')
                ? { type: 'mdx', mdx: current.MDX ?? '' }
                : { type: 'native', definition: current }
            : null
        if (nativeAxes) {
            await client.saveNativeView(cube, name, nativeAxes)
        } else {
            await client.saveView(cube, name, mdx)
        }
        const afterState = nativeAxes ? { type: 'native', definition: nativeAxes } : { type: 'mdx', mdx: mdx ?? '' }
        const { hasSession } = cl.writeLog({ server, action: 'VIEW_SAVED', objectType: 'view', objectName: name, detail: cube, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { fail(res, e) }
})

app.post('/api/view/set-default', async (req, res) => {
    try {
        const { server, cube, name } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await client.setDefaultView(cube, name)
        res.json({ ok: true, noSession: false })
    } catch (e) {
        console.error('[set-default]', e.message, e.response?.status)
        fail(res, e)
    }
})

app.delete('/api/view', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteView(req.query.cube, req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'VIEW_DELETED', objectType: 'view', objectName: req.query.name, detail: req.query.cube, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/view/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanViewUsage(req.query.cube, req.query.view))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/view/source-usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await getViewSourceUsage(client, req.query.server, req.query.cube, req.query.view, scanIdentity(req)))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/view/axes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
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
        // Build raw native config from view definition
        const extractAxis = (placement) => {
            const expr = (placement.Subset?.Expression ?? '').trim()
            const hasNamedSubset = !!(placement.SubsetName ?? (placement.Subset?.Name || null))
            return {
                dimension: placement.DimensionName ?? placement.Name,
                subset:    placement.SubsetName ?? (placement.Subset?.Name || null),
                memberSet: !hasNamedSubset && /^TM1SubsetAll\(/i.test(expr) ? 'all'
                         : !hasNamedSubset && /^TM1FILTERBYLEVEL\s*\(/i.test(expr) ? 'leaf'
                         : null,
                members:   !hasNamedSubset ? extractMembersFromExpression(expr) : null,
            }
        }
        const extractTitle = (t) => ({
            dimension: t.DimensionName ?? t.Name,
            member:    t.Selection?.Name ?? null,
        })
        const rawNative = viewDef ? {
            rows:    (viewDef.Rows ?? []).length > 0 ? (viewDef.Rows ?? []).map(extractAxis) : (viewDef._rows ?? []),
            columns: (viewDef.Columns ?? []).length > 0 ? (viewDef.Columns ?? []).map(extractAxis) : (viewDef._columns ?? []),
            titles:  (viewDef.Titles ?? []).length > 0 ? (viewDef.Titles ?? []).map(extractTitle) : (viewDef._titles ?? []),
            suppressEmptyRows:    !!viewDef.SuppressEmptyRows,
            suppressEmptyColumns: !!viewDef.SuppressEmptyColumns,
        } : null

        // Rebuild nativeConfig using axisConfig (cellset) for correct axis placement
        // and rawNative for subset/member info
        let nativeConfig = rawNative
        if (rawNative && axisConfig.length) {
            const dimInfo = {}
            for (const d of [...rawNative.rows, ...rawNative.columns, ...rawNative.titles])
                if (d.dimension) dimInfo[d.dimension] = { subset: d.subset ?? null, memberSet: d.memberSet ?? null, members: d.members ?? null }

            const colAxis    = axisConfig.find(a => a.ordinal === 0)
            const rowAxis    = axisConfig.find(a => a.ordinal === 1)
            const filterAxis = axisConfig.find(a => a.ordinal === 2)

            nativeConfig = {
                columns: (colAxis?.dimensions ?? []).map(d => ({ dimension: d, subset: dimInfo[d]?.subset ?? null, memberSet: dimInfo[d]?.memberSet ?? null, members: dimInfo[d]?.members ?? null })),
                rows:    (rowAxis?.dimensions ?? []).map(d => ({ dimension: d, subset: dimInfo[d]?.subset ?? null, memberSet: dimInfo[d]?.memberSet ?? null, members: dimInfo[d]?.members ?? null })),
                titles:  (filterAxis?.selectedMembers ?? rawNative.titles ?? []).map(t => ({
                    dimension: t.dimension,
                    member:    t.member ?? rawNative.titles?.find(n => n.dimension === t.dimension)?.member ?? null,
                })),
                suppressEmptyRows:    rawNative.suppressEmptyRows,
                suppressEmptyColumns: rawNative.suppressEmptyColumns,
            }
        }

        // For MDX views, return the MDX text so the client can parse it back to axes
        const mdxText = (viewDef && viewDef['@odata.type']?.includes('MDXView')) ? (viewDef.MDX || null) : null
        res.json({ axisConfig, cellset: data, viewType: data.ViewType, nativeConfig, mdx: mdxText })
    } catch (e) { fail(res, e) }
})

app.post('/api/mdx/execute', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.executeMDX(req.body.mdx))
    } catch (e) { fail(res, e) }
})
}

module.exports = { register }
