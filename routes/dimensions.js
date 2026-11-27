'use strict'

function register(app, deps) {
    const { cl, fail, gateReadOnly, gateWrite, logAttributeValue, makeClient } = deps

app.post('/api/dimension/create', async (req, res) => {
    try {
        const { server, name } = req.body
        if (!name?.trim() || !server) return res.status(400).json({ error: 'name and server required' })
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        await makeClient(server, req.ideToken).createDimension(name)
        const { hasSession } = cl.writeLog({ server, action: 'DIMENSION_CREATED', objectType: 'dimension', objectName: name, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/dimension/bulk-import', async (req, res) => {
    try {
        const { server, dimension, hierarchy = dimension, rows } = req.body
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const errors = []

        // Snapshot the dimension first so the import can be recorded per element,
        // with before/after and hierarchy, exactly like an IDE edit. Build Release
        // replays those records against Live instead of carrying DEV's whole file.
        const { snapshotDimension, recordDimensionDiff } = require('../core/process-capture')
        let before = null
        try { before = await snapshotDimension(client, dimension) } catch { /* fall back to a whole record */ }

        // Pass 1: create all elements in one bulk call
        const validRows = rows.filter(r => r.name?.trim())
        if (validRows.length) {
            try {
                await client.bulkSetElements(dimension, validRows.map(r => ({ name: r.name.trim(), type: r.type || 'N' })), hierarchy)
            } catch (e) {
                errors.push(`Bulk element create: ${e.message}`)
            }
        }

        // Pass 2: create edges (no bulk API — sequential)
        for (const row of rows) {
            if (!row.name?.trim() || !row.parent?.trim()) continue
            try { await client.addEdge(dimension, row.parent.trim(), row.name.trim(), row.weight ?? 1, hierarchy) } catch (e) {
                if (!e.message?.includes('already exists')) errors.push(`${row.parent}→${row.name}: ${e.message}`)
            }
        }

        let recorded = false
        if (before) {
            try {
                const after = await snapshotDimension(client, dimension)
                recordDimensionDiff(server, dimension, before, after, { user: req.user, attributes: false })
                recorded = true
            } catch { /* fall back below */ }
        }
        if (!recorded) {
            // The dimension could not be read back; keep a whole record so the change
            // is still tracked, and Build Release will refuse if the target moved.
            cl.writeLog({ server, action: 'DIMENSION_UPDATED', objectType: 'dimension', objectName: dimension, detail: `bulk import of ${validRows.length} element(s)`, user: req.user })
        }
        res.json({ ok: true, errors })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/dimension/bulk-attr-import', async (req, res) => {
    try {
        const { server, dimension, hierarchy = dimension, rows } = req.body
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const errors = []
        for (const row of rows) {
            if (!row.element?.trim() || !row.attrName?.trim()) continue
            const element = row.element.trim()
            const attribute = row.attrName.trim()
            try {
                const current = await client.getElementAttributeValues(dimension, element, hierarchy).catch(() => ({}))
                const before = current?.[attribute] ?? null
                await client.writeElementAttribute(dimension, element, attribute, row.value ?? '', row.type || 'S', hierarchy)
                logAttributeValue({ server, dimension, element, attribute, hierarchy, before, after: row.value ?? '', user: req.user })
            } catch (e) { errors.push(`${row.element}[${row.attrName}]: ${e.message}`) }
        }
        res.json({ ok: true, errors })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimensions', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getDimensions())
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/dimension', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteDimension(req.query.name)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'DIMENSION_DELETED', objectType: 'dimension', objectName: req.query.name, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/subset', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        await client.deleteSubset(req.query.dimension, req.query.name, req.query.hierarchy)
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'SUBSET_DELETED', objectType: 'subset', objectName: req.query.name, detail: req.query.dimension, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/dimension/attributes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const attrs  = await client.getElementAttributes(req.query.dimension)
        res.json(attrs.map(a => ({ name: a.Name, type: a.Type })))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimension/alias-values', async (req, res) => {
    try {
        const { server, dimension, alias } = req.query
        const client = makeClient(server, req.ideToken)
        res.json(await client.getAliasValues(dimension, alias))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimension/cubes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getCubesForDimension(req.query.dimension))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimensions/format-attrs', async (req, res) => {
    try {
        const { server, dims } = req.query
        const dimensions = dims ? dims.split(',').filter(Boolean) : []
        if (!dimensions.length) return res.json({})
        const client = makeClient(server, req.ideToken)
        const result = {}
        await Promise.all(dimensions.map(async dim => {
            let map = await client.getAliasValues(dim, 'Format', dim).catch(() => null)
            if (!map || !Object.keys(map).length) {
                map = await client.getFormatAttrs(dim, dim).catch(() => ({}))
            }
            if (Object.keys(map).length) result[dim] = map
        }))
        res.json(result)
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/dimension/attr-grid', async (req, res) => {
    try {
        const { server, dimension, hierarchy } = req.query
        const client = makeClient(server, req.ideToken)
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
        if (!gateWrite(res, server)) return
        await makeClient(server, req.ideToken).createElementAttribute(dimension, name, type, hierarchy)
        const { hasSession } = cl.writeLog({ server, action: 'ATTRIBUTE_CREATED', objectType: 'attribute', objectName: name, detail: dimension, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.delete('/api/dimension/attribute-def', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        await makeClient(server, req.ideToken).deleteElementAttribute(dimension, name, hierarchy)
        const { hasSession } = cl.writeLog({ server, action: 'ATTRIBUTE_DELETED', objectType: 'attribute', objectName: name, detail: dimension, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/dimension/attribute/convert-to-alias', async (req, res) => {
    try {
        const { server, dimension, attribute, hierarchy = dimension } = req.body
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const elements = await client.getElements(dimension, hierarchy)
        const pairs = await Promise.all(
            elements.map(async el => {
                try {
                    const vals = await client.getElementAttributeValues(dimension, el.Name, hierarchy)
                    return [el.Name, vals[attribute] ?? null]
                } catch { return [el.Name, null] }
            })
        )
        const toRewrite = pairs.filter(([, v]) => v !== null && String(v) !== '')
        await client.deleteElementAttribute(dimension, attribute, hierarchy)
        await client.createElementAttribute(dimension, attribute, 'Alias', hierarchy)
        await Promise.all(
            toRewrite.map(([element, value]) =>
                client.writeElementAttribute(dimension, element, attribute, String(value), 'S', hierarchy).catch(() => {})
            )
        )
        cl.writeLog({ server, action: 'ATTRIBUTE_CONVERTED', objectType: 'attribute', objectName: attribute, detail: `${dimension} → Alias`, user: req.user })
        res.json({ converted: toRewrite.length })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/element/attribute', async (req, res) => {
    try {
        const { server, dimension, element, attribute, value, type, hierarchy } = req.body
        if (!gateReadOnly(res, server)) return
        const client = makeClient(server, req.ideToken)
        const current = await client.getElementAttributeValues(dimension, element, hierarchy).catch(() => ({}))
        const before = current?.[attribute] ?? null
        await client.writeElementAttribute(dimension, element, attribute, value, type, hierarchy)
        logAttributeValue({ server, dimension, element, attribute, hierarchy, before, after: value, user: req.user })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/elements', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getElements(req.query.dimension, req.query.hierarchy, req.query.index === '1'))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/elements/tree', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const result = await client.getElementsWithTree(req.query.dimension, req.query.hierarchy)
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/element/attributes', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getElementAttributeValues(req.query.dimension, req.query.element, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/edges', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getEdges(req.query.dimension, req.query.hierarchy))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/dimension/element', async (req, res) => {
    try {
        const { server, dimension, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const { name, type, parent, before } = req.body
        const hier = hierarchy ?? dimension
        await client.addElementAt(dimension, name, type, hierarchy, { parent, before })
        const where = parent ? ` under ${parent}${before ? ` before ${before}` : ''}` : before ? ` before ${before}` : ''
        const tm1Type = type === 'C' ? 'Consolidated' : type === 'S' ? 'String' : 'Numeric'
        cl.writeLog({ server, action: 'ELEMENT_ADDED', objectType: 'dimension', objectName: dimension, detail: `${name}${where}`, user: req.user,
            afterState: { element: name, type: tm1Type, parent: parent ?? null, weight: 1, hierarchy: hier } })
        res.json({ ok: true })
    } catch (e) {
        console.error(`[dimension/element] ${req.query.dimension}: ${e.message}`)
        fail(res, e)
    }
})

app.delete('/api/dimension/element', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const [els, eds] = await Promise.all([
            client.getElements(dimension, hierarchy).catch(() => []),
            client.getEdges(dimension, hierarchy).catch(() => []),
        ])
        const el = (els ?? []).find(e => String(e.Name).toLowerCase() === String(name).toLowerCase())
        const edge = (eds ?? []).find(e => String(e.ComponentName).toLowerCase() === String(name).toLowerCase())
        const tm1Type = el?.Type === 'C' ? 'Consolidated' : el?.Type === 'S' ? 'String' : 'Numeric'
        await client.deleteElement(dimension, name, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_DELETED', objectType: 'dimension', objectName: dimension, detail: name, user: req.user,
            beforeState: { element: name, type: tm1Type, parent: edge?.ParentName ?? null, weight: edge?.Weight ?? null, hierarchy: hierarchy ?? dimension } })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/dimension/element', async (req, res) => {
    try {
        const { server, dimension, name, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const els = await client.getElements(dimension, hierarchy).catch(() => [])
        const el = (els ?? []).find(e => String(e.Name).toLowerCase() === String(name).toLowerCase())
        const tm1Type = el?.Type === 'C' ? 'Consolidated' : el?.Type === 'S' ? 'String' : 'Numeric'
        await client.renameElement(dimension, name, req.body.newName, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_RENAMED', objectType: 'dimension', objectName: dimension, detail: `${name} → ${req.body.newName}`, user: req.user,
            beforeState: { element: name, type: tm1Type, hierarchy: hierarchy ?? dimension }, afterState: { element: req.body.newName, type: tm1Type, hierarchy: hierarchy ?? dimension } })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/dimension/edge', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const { server, dimension, hierarchy } = req.query
        const client = makeClient(server, req.ideToken)
        const { parent, child, weight } = req.body
        await client.addEdge(dimension, parent, child, weight ?? 1, hierarchy)
        cl.writeLog({ server, action: 'ELEMENT_LINKED', objectType: 'dimension', objectName: dimension, detail: `${child} under ${parent}`, user: req.user,
            afterState: { element: child, parent, weight: weight ?? 1, hierarchy: hierarchy ?? dimension } })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/dimension/component', async (req, res) => {
    try {
        const { server, dimension, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const { parent, child, before, weight } = req.body
        const eds = await client.getEdges(dimension, hierarchy).catch(() => [])
        const prior = (eds ?? []).find(e => String(e.ComponentName).toLowerCase() === String(child).toLowerCase())
        await client.setComponent(dimension, parent, child, before ?? null, weight ?? 1, hierarchy)
        const hier = hierarchy ?? dimension
        cl.writeLog({ server, action: 'ELEMENT_LINKED', objectType: 'dimension', objectName: dimension, detail: `${child} under ${parent}${before ? ` before ${before}` : ''}`, user: req.user,
            ...(prior ? { beforeState: { element: child, parent: prior.ParentName, weight: prior.Weight ?? 1, hierarchy: hier } } : {}),
            afterState: { element: child, parent, weight: weight ?? 1, hierarchy: hier } })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/dimension/edge', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client = makeClient(req.query.server, req.ideToken)
        const eds = await client.getEdges(req.query.dimension, req.query.hierarchy).catch(() => [])
        const prior = (eds ?? []).find(e => String(e.ParentName).toLowerCase() === String(req.query.parent).toLowerCase() && String(e.ComponentName).toLowerCase() === String(req.query.child).toLowerCase())
        await client.updateEdgeWeight(req.query.dimension, req.query.parent, req.query.child, req.body.weight, req.query.hierarchy)
        cl.writeLog({ server: req.query.server, action: 'EDGE_WEIGHT_CHANGED', objectType: 'dimension', objectName: req.query.dimension,
            detail: `${req.query.child} under ${req.query.parent}: ${prior?.Weight ?? '?'} → ${req.body.weight}`, user: req.user,
            beforeState: { element: req.query.child, parent: req.query.parent, weight: prior?.Weight ?? null, hierarchy: req.query.hierarchy ?? req.query.dimension },
            afterState: { element: req.query.child, parent: req.query.parent, weight: req.body.weight, hierarchy: req.query.hierarchy ?? req.query.dimension } })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/edge', async (req, res) => {
    try {
        const { server, dimension, parent, child, hierarchy } = req.query
        if (!gateWrite(res, server)) return
        const client = makeClient(server, req.ideToken)
        const eds = await client.getEdges(dimension, hierarchy).catch(() => [])
        const prior = (eds ?? []).find(e => String(e.ParentName).toLowerCase() === String(parent).toLowerCase() && String(e.ComponentName).toLowerCase() === String(child).toLowerCase())
        await client.deleteEdge(dimension, parent, child, hierarchy)
        cl.writeLog({ server, action: 'EDGE_REMOVED', objectType: 'dimension', objectName: dimension, detail: `${parent} · removed ${child}`, user: req.user,
            beforeState: { element: child, parent, weight: prior?.Weight ?? null, hierarchy: hierarchy ?? dimension } })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/hierarchies', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getHierarchies(req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/subset/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanSubsetUsage(req.query.dimension, req.query.subset, req.query.hierarchy || req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/dimension/usage', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.scanDimensionUsage(req.query.dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/dimension/hierarchy', async (req, res) => {
    try {
        const { server, dimension, name } = req.body
        if (!gateWrite(res, server)) return
        await makeClient(server, req.ideToken).createHierarchy(dimension, name)
        cl.writeLog({ server, action: 'HIERARCHY_CREATED', objectType: 'dimension', objectName: dimension, detail: name, user: req.user,
            afterState: { dimension, hierarchy: name } })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/hierarchy/info', async (req, res) => {
    try {
        const { server, dimension, hierarchy } = req.query
        res.json(await makeClient(server, req.ideToken).hierarchyInfo(dimension, hierarchy))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/element/hierarchy-parents', async (req, res) => {
    try {
        const { server, dimension, element } = req.query
        res.json(await makeClient(server, req.ideToken).elementHierarchyParents(dimension, element))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/hierarchy/from-attribute', async (req, res) => {
    try {
        const { server, dimension, hierarchy, attribute, levelDimension, hookProcess } = req.body
        if (!gateWrite(res, server)) return
        const r = await makeClient(server, req.ideToken).buildHierarchyFromAttribute({ dimension, hierarchy, attribute, levelDimension, hookProcess })
        cl.writeLog({ server, action: 'PROCESS_SAVED', objectType: 'process', objectName: r.process, detail: `builds the "${hierarchy}" Alternate Hierarchy on ${dimension} from ${attribute}`, user: req.user })
        cl.writeLog({ server, action: 'HIERARCHY_CREATED', objectType: 'dimension', objectName: dimension, detail: hierarchy, user: req.user,
            afterState: { dimension, hierarchy } })
        if (r.hooked) cl.writeLog({ server, action: 'PROCESS_SAVED', objectType: 'process', objectName: r.hooked, detail: `now runs ${r.process}`, user: req.user })
        res.json({ ok: true, ...r })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/dimension/hierarchy', async (req, res) => {
    try {
        const { server, dimension, name } = req.query
        if (!gateWrite(res, server)) return
        await makeClient(server, req.ideToken).deleteHierarchy(dimension, name)
        cl.writeLog({ server, action: 'HIERARCHY_DELETED', objectType: 'dimension', objectName: dimension, detail: name, user: req.user,
            beforeState: { dimension, hierarchy: name } })
        res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/subsets', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getSubsets(req.query.dimension, req.query.hierarchy || undefined))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/subset', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getSubset(req.query.dimension, req.query.name, req.query.hierarchy || undefined))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/subset', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client      = makeClient(req.query.server, req.ideToken)
        const current     = await client.getSubset(req.query.dimension, req.query.name, req.query.hierarchy || undefined).catch(() => null)
        const beforeState = current ? { expression: current.Expression ?? '' } : null
        await client.saveSubset(req.query.dimension, req.query.name, req.body.mdx, req.query.hierarchy || undefined)
        const afterState  = { expression: req.body.mdx }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'SUBSET_SAVED', objectType: 'subset', objectName: req.query.name, detail: req.query.dimension, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { fail(res, e) }
})

app.get('/api/subset/elements', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await client.getSubsetElements(req.query.dimension, req.query.name, req.query.hierarchy || undefined))
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/subset/static', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const client      = makeClient(req.query.server, req.ideToken)
        const currentEls  = await client.getSubsetElements(req.query.dimension, req.query.name, req.query.hierarchy || undefined).catch(() => null)
        const beforeState = currentEls ? { elements: currentEls.map(e => e.name) } : null
        await client.saveStaticSubset(req.query.dimension, req.query.name, req.body.elements, req.query.hierarchy || undefined)
        const afterState  = { elements: req.body.elements ?? [] }
        const { hasSession } = cl.writeLog({ server: req.query.server, action: 'SUBSET_SAVED', objectType: 'subset', objectName: req.query.name, detail: req.query.dimension, beforeState, afterState, user: req.user })
        res.json({ ok: true, noSession: !hasSession })
    } catch (e) { fail(res, e) }
})

app.get('/api/dimension/attribute-values', async (req, res) => {
    const { server, dimension, attribute } = req.query
    if (!server || !dimension || !attribute) return res.status(400).json({ error: 'server, dimension and attribute required' })
    try {
        const client = makeClient(server, req.ideToken)
        const elements = await client.getElements(dimension, dimension, { $top: 500 })
        const valueSet = new Set()
        const list = Array.isArray(elements?.value) ? elements.value : Array.isArray(elements) ? elements : []
        for (const el of list) {
            try {
                const vals = await client.getElementAttributeValues(dimension, el.Name, dimension)
                const v = (vals?.value ?? vals)?.[attribute]
                if (v !== undefined && v !== null && v !== '') valueSet.add(String(v))
            } catch {}
        }
        res.json({ values: [...valueSet].sort() })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.post('/api/subset/preview', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const dim = req.query.dimension
        const members = await client.previewMDX(dim, req.body.mdx, req.body.limit ?? 100)
        // Batch-fetch attributes for up to 100 members
        const toFetch = members.slice(0, 100)
        if (toFetch.length > 0) {
            const attrResults = await Promise.all(
                toFetch.map(m =>
                    client.getElementAttributeValues(dim, m.name, dim)
                        .then(r => r?.value ?? r ?? {})
                        .catch(() => ({}))
                )
            )
            toFetch.forEach((m, i) => { m.attributes = attrResults[i] ?? {} })
        }
        res.json({ members })
    } catch (e) {
        console.error('[subset/preview]', e.message)
        res.status(500).json({ error: e.message })
    }
})
}

module.exports = { register }
