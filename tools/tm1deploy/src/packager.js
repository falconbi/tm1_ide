'use strict'

const fs   = require('fs')
const path = require('path')
const { TM1Client } = require('./client')
const { diff }      = require('./diff')

const PACKAGES_DIR = path.resolve(__dirname, '../../../packages')

function slug(session) {
    return session.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
}

function safeFilename(name) {
    return name.replace(/[^a-zA-Z0-9_\-. ]/g, '_')
}

// ── Per-type fetchers ─────────────────────────────────────────────────────────

async function fetchRules(name, client) {
    const cube = await client.getCube(name)
    return { rules: cube.Rules ?? '' }
}

async function fetchProcess(name, client) {
    const p = await client.getProcess(name)
    return {
        Name:                p.Name,
        PrologProcedure:     p.PrologProcedure     ?? '',
        MetaDataProcedure:   p.MetaDataProcedure ?? p.MetadataProcedure ?? '',
        DataProcedure:       p.DataProcedure       ?? '',
        EpilogProcedure:     p.EpilogProcedure     ?? '',
        Parameters:          p.Parameters          ?? [],
        Variables:           p.Variables           ?? [],
        DataSources:         p.DataSources ?? (p.DataSource ? [p.DataSource] : []),
    }
}

async function fetchSubset(dim, name, client) {
    const s = await client.getSubset(dim, name)
    return {
        Name:       s.Name,
        Dimension:  dim,
        Hierarchy:  dim,
        Expression: s.Expression ?? null,
        Elements:   s.Elements   ?? [],
        Type:       s.Expression ? 'MDX' : 'Static',
    }
}

async function fetchView(cube, name, client) {
    const v = await client.getView(cube, name)
    if (v?.MDX) return { Type: 'MDX', MDX: v.MDX }

    // native — store structured axis definitions for saveNativeView
    const vs = await client.getViewWithSubsets(cube, name)

    // collect named subset references to warn the caller about
    const refs = new Set()
    for (const axis of [...(vs._rows ?? []), ...(vs._columns ?? []), ...(vs._titles ?? [])]) {
        if (axis.subset) refs.add(JSON.stringify({ dim: axis.dimension, name: axis.subset }))
    }

    // convert title members[] → member (singular) for saveNativeView's buildTitle
    const titles = (vs._titles ?? []).map(t => ({
        ...t,
        member:  Array.isArray(t.members) && t.members.length === 1 ? t.members[0] : undefined,
        members: undefined,
    }))

    return {
        Type: 'Native',
        rows:    vs._rows    ?? [],
        columns: vs._columns ?? [],
        titles,
        _subsetRefs: [...refs].map(r => JSON.parse(r)),
    }
}

async function fetchDimension(name, client) {
    const [elements, edges, attributes] = await Promise.all([
        client.getElements(name).catch(() => []),
        client.getEdges(name).catch(() => []),
        client.getElementAttributes(name).catch(() => []),
    ])
    return { Name: name, elements, edges, attributes }
}

async function fetchCube(name, client) {
    const cube = await client.getCube(name)
    return { Name: name, Dimensions: cube.Dimensions ?? [] }
}

async function fetchAttribute(dim, attrName, client) {
    const attrs = await client.getElementAttributes(dim)
    const attr  = attrs.find(a => a.Name === attrName)
    return { Dimension: dim, Attribute: attrName, Type: attr?.Type ?? 'String' }
}

// ── Main packager ─────────────────────────────────────────────────────────────

async function pack(server, sessionEntries, sessionName, options = {}) {
    const { baselinePath, outputDir: overrideDir, force = false, forceInclude = [] } = options
    const client = new TM1Client(server)

    // Run diff to get packable objects
    const diffResult = await diff(server, sessionEntries, baselinePath)

    // Merge force-included drift objects (user explicitly selected them)
    const forcedKeys = new Set(forceInclude.map(i => `${i.object_type}::${i.object_name}::${i.detail ?? ''}`))
    const forcedDrift = diffResult.drift.filter(i =>
        forcedKeys.has(`${i.object_type}::${i.object_name}::${i.detail ?? ''}`)
    ).map(i => ({ ...i, outcome: 'DRIFT_FORCED' }))

    const packable = [...diffResult.match, ...diffResult.new, ...forcedDrift]

    if (packable.length === 0) {
        return { packaged: 0, skipped: diffResult.total, outputDir: null, manifest: null, diffResult }
    }

    // Create output directory
    const dirName   = `${slug(sessionName)}-${new Date().toISOString().slice(0, 10)}`
    const outputDir = overrideDir ?? path.join(PACKAGES_DIR, dirName)

    if (fs.existsSync(outputDir)) {
        if (force) {
            fs.rmSync(outputDir, { recursive: true })
        } else {
            throw new Error(`Package directory already exists: ${outputDir}\nUse --force to overwrite.`)
        }
    }

    for (const sub of ['rules', 'processes', 'subsets', 'views', 'dimensions', 'cubes', 'attributes']) {
        fs.mkdirSync(path.join(outputDir, sub), { recursive: true })
    }

    const manifest = {
        _meta: {
            session:             sessionName,
            server:              server,
            packaged_at:         new Date().toISOString(),
            baseline_server:     diffResult.baseline_server,
            baseline_seeded_at:  diffResult.baseline_seeded_at,
            has_baseline:        diffResult.has_baseline,
        },
        objects: [],
        skipped: [],
    }

    // Fetch and write each packable object
    const results = await Promise.all(packable.map(async item => {
        try {
            let data, relPath

            if (item.object_type === 'rules') {
                data    = await fetchRules(item.object_name, client)
                relPath = `rules/${safeFilename(item.object_name)}.rule`
                fs.writeFileSync(path.join(outputDir, relPath), data.rules)

            } else if (item.object_type === 'process') {
                data    = await fetchProcess(item.object_name, client)
                relPath = `processes/${safeFilename(item.object_name)}.json`
                fs.writeFileSync(path.join(outputDir, relPath), JSON.stringify(data, null, 2))

            } else if (item.object_type === 'subset') {
                const dim = item.detail
                data    = await fetchSubset(dim, item.object_name, client)
                const subDir = path.join(outputDir, 'subsets', safeFilename(dim))
                fs.mkdirSync(subDir, { recursive: true })
                relPath = `subsets/${safeFilename(dim)}/${safeFilename(item.object_name)}.json`
                fs.writeFileSync(path.join(outputDir, relPath), JSON.stringify(data, null, 2))

            } else if (item.object_type === 'view') {
                const cube = item.detail
                data    = await fetchView(cube, item.object_name, client)
                const subDir = path.join(outputDir, 'views', safeFilename(cube))
                fs.mkdirSync(subDir, { recursive: true })
                relPath = `views/${safeFilename(cube)}/${safeFilename(item.object_name)}.json`
                // strip _subsetRefs from the stored view file (internal use only)
                const { _subsetRefs, ...viewData } = data
                fs.writeFileSync(path.join(outputDir, relPath), JSON.stringify(viewData, null, 2))
                // ensure referenced named subsets are also in the manifest
                if (_subsetRefs?.length) {
                    for (const ref of _subsetRefs) {
                        const already = manifest.objects.some(o => o.type === 'subset' && o.name === ref.name && o.detail === ref.dim)
                        if (already) continue
                        const s = await client.getSubset(ref.dim, ref.name).catch(() => null)
                        if (!s) continue
                        const subDir2 = path.join(outputDir, 'subsets', safeFilename(ref.dim))
                        fs.mkdirSync(subDir2, { recursive: true })
                        const subPath = `subsets/${safeFilename(ref.dim)}/${safeFilename(ref.name)}.json`
                        const subData = { Name: ref.name, Dimension: ref.dim, Hierarchy: ref.dim, Expression: s.Expression ?? null, Elements: s.Elements ?? [], Type: s.Expression ? 'MDX' : 'Static' }
                        fs.writeFileSync(path.join(outputDir, subPath), JSON.stringify(subData, null, 2))
                        manifest.objects.push({ type: 'subset', name: ref.name, detail: ref.dim, outcome: 'REFERENCED', file: subPath })
                    }
                }

            } else if (item.object_type === 'dimension') {
                data    = await fetchDimension(item.object_name, client)
                relPath = `dimensions/${safeFilename(item.object_name)}.json`
                fs.writeFileSync(path.join(outputDir, relPath), JSON.stringify(data, null, 2))

            } else if (item.object_type === 'cube') {
                data    = await fetchCube(item.object_name, client)
                relPath = `cubes/${safeFilename(item.object_name)}.json`
                fs.writeFileSync(path.join(outputDir, relPath), JSON.stringify(data, null, 2))

            } else if (item.object_type === 'attribute') {
                data    = await fetchAttribute(item.detail, item.object_name, client)
                relPath = `attributes/${safeFilename(item.detail)}_${safeFilename(item.object_name)}.json`
                fs.writeFileSync(path.join(outputDir, relPath), JSON.stringify(data, null, 2))

            } else {
                return { ok: false, item, reason: `no packager for type: ${item.object_type}` }
            }

            return { ok: true, item, relPath }
        } catch (e) {
            return { ok: false, item, reason: e.message }
        }
    }))

    for (const r of results) {
        if (r.ok) {
            manifest.objects.push({
                type:        r.item.object_type,
                name:        r.item.object_name,
                detail:      r.item.detail ?? null,
                outcome:     r.item.outcome,
                file:        r.relPath,
            })
        } else {
            manifest.skipped.push({
                type:   r.item.object_type,
                name:   r.item.object_name,
                detail: r.item.detail ?? null,
                reason: r.reason,
            })
        }
    }

    // Record drift/missing/unchanged in skipped too (with reason), excluding force-included
    for (const item of [...diffResult.drift.filter(i => !forcedKeys.has(`${i.object_type}::${i.object_name}::${i.detail ?? ''}`)), ...diffResult.missing, ...diffResult.unchanged]) {
        manifest.skipped.push({
            type:   item.object_type,
            name:   item.object_name,
            detail: item.detail ?? null,
            reason: `${item.outcome.toLowerCase()}: ${item.note}`,
        })
    }

    fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    return {
        packaged:   manifest.objects.length,
        skipped:    manifest.skipped.length,
        errors:     results.filter(r => !r.ok).length,
        outputDir,
        manifest,
        diffResult,
    }
}

module.exports = { pack, PACKAGES_DIR }
