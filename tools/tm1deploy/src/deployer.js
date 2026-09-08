'use strict'

const fs   = require('fs')
const path = require('path')
const { makeClient }  = require('./client')
const { analyzeRisk } = require('./risk')

// ── Per-type deployers ────────────────────────────────────────────────────────

async function deployRules(obj, packageDir, client) {
    const text = fs.readFileSync(path.join(packageDir, obj.file), 'utf8')
    const esc  = s => s.replace(/'/g, "''")
    await client.patch(`Cubes('${esc(obj.name)}')`, { Rules: text })
}

async function deployProcess(obj, packageDir, client) {
    const data = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8'))
    // The snapshot stores DataSources (plural, array) and MetaDataProcedure;
    // v11 POST Processes wants DataSource (singular, object) and MetadataProcedure.
    // createOrReplaceProcess builds the correct body and does create-or-PATCH.
    await client.createOrReplaceProcess({
        name:       data.Name,
        prolog:     data.PrologProcedure   ?? '',
        metadata:   data.MetaDataProcedure ?? data.MetadataProcedure ?? '',
        data:       data.DataProcedure     ?? '',
        epilog:     data.EpilogProcedure   ?? '',
        parameters: data.Parameters ?? [],
        datasource: Array.isArray(data.DataSources)
            ? (data.DataSources[0] ?? { Type: 'None' })
            : (data.DataSource ?? { Type: 'None' }),
    })
}

async function deploySubset(obj, packageDir, client) {
    const data = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8'))
    const dim  = obj.detail
    const name = obj.name

    // MDX subset — Expression is a scalar; PATCH replaces it cleanly, no append issue.
    if (data.Type === 'MDX' || data.Expression) {
        await client.saveSubset(dim, name, data.Expression)
        return
    }

    const elements = (data.Elements ?? [])
        .map(e => e.Name ?? e.name ?? e)
        .filter(Boolean)

    const exists = await client.getSubset(dim, name).then(s => !!s?.Name).catch(() => false)

    // New static subset — POST creates it fresh, nothing to append to.
    if (!exists) {
        await client.saveStaticSubset(dim, name, elements)
        return
    }

    // Existing static subset — on this v11 engine a PATCH of Elements@odata.bind
    // APPENDS, it never replaces, and REST offers no way to clear members
    // (DELETE .../Elements → 400, per-element DELETE → unsupported, PATCH [] → no-op).
    // Rebuild in place with a throwaway TI: SubsetDeleteAllElements then an ordered
    // SubsetElementInsert loop. The subset object identity is preserved, so views
    // that reference it by name keep working.
    // NOTE: a very large subset (~1000+ elements) makes a long prolog string and
    // TI procedure code has a size cap — chunk the inserts if that is ever hit.
    const esc = s => String(s).replace(/'/g, "''")
    const code = [
        `SubsetDeleteAllElements('${esc(dim)}', '${esc(name)}');`,
        ...elements.map((el, i) =>
            `IF( DIMIX('${esc(dim)}', '${esc(el)}') > 0 );`
            + ` SubsetElementInsert('${esc(dim)}', '${esc(name)}', '${esc(el)}', ${i + 1}); ENDIF;`),
    ].join('\n')
    await client._runTI(code)
}

async function deployView(obj, packageDir, client) {
    const data = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8'))
    const cube = obj.detail
    const name = obj.name
    if (data.Type === 'MDX' || data.MDX) {
        // saveView PATCH-then-fallback-POST internally
        await client.saveView(cube, name, data.MDX)
    } else if (data.Type === 'Native') {
        await client.saveNativeView(cube, name, { rows: data.rows, columns: data.columns, titles: data.titles })
    }
}

async function deployDimension(obj, packageDir, client) {
    const data = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8'))
    const name = obj.name

    const ignore = e => { if (![400, 409].includes(e.response?.status)) throw e }
    const rx     = /already (exists|in use)|duplicate/i

    // Dimension shell + leaf hierarchy. Always ensure the hierarchy — a
    // dimension left behind by a half-finished prior deploy can exist without
    // it, and every element/edge write then 404s.
    const exists = await client.getDimension(name).catch(() => null)
    if (!exists) await client.post('Dimensions', { Name: name }).catch(ignore)
    await client.post(`Dimensions('${name}')/Hierarchies`, { Name: name, Dimension: { Name: name } }).catch(ignore)

    // Elements — one POST each. The bulk tm1.AddElements action 404s on v11;
    // client.addElement (POST .../Elements) is the path the build tools use.
    for (const e of (data.elements ?? [])) {
        const elName = e.Name ?? e.name
        const elType = e.Type ?? e.type ?? 'N'
        try { await client.addElement(name, elName, elType, name) }
        catch (err) { if (!rx.test(err.response?.data?.error?.message ?? err.message ?? '')) throw err }
    }

    // Edges — one POST each. tm1.AddEdges also 404s on v11.
    for (const ed of (data.edges ?? [])) {
        const parent = ed.ParentName ?? ed.parent
        const child  = ed.ComponentName ?? ed.child ?? ed.component
        const weight = ed.Weight ?? ed.weight ?? 1
        try { await client.addEdge(name, parent, child, weight, name) }
        catch (err) { if (!rx.test(err.response?.data?.error?.message ?? err.message ?? '')) throw err }
    }

    // Remove elements the package no longer carries — the target drifts toward
    // the package's element set (e.g. a version dimension losing "Working").
    // The pre-deploy risk check BLOCKS a large or consolidation-bearing removal;
    // this cap is defence in depth for an incomplete package.
    if (exists && (data.elements ?? []).length) {
        const pkgNames  = new Set((data.elements ?? []).map(e => (e.Name ?? e.name ?? '').toLowerCase()))
        const targetEls = await client.getElements(name).catch(() => [])
        const toRemove  = targetEls.filter(e => !pkgNames.has((e.Name ?? '').toLowerCase()))
        const cap = Math.max(10, Math.floor(targetEls.length * 0.5))
        if (toRemove.length && toRemove.length <= cap) {
            for (const e of toRemove) {
                try { await client.deleteElement(name, e.Name, name) }
                catch (err) { console.warn(`  [warn] ${name}: could not remove element ${e.Name}: ${err.message}`) }
            }
        } else if (toRemove.length) {
            console.warn(`  [warn] ${name}: ${toRemove.length} target elements absent from package — NOT auto-removed (over cap ${cap}); remove manually`)
        }
    }

    // Attribute definitions
    if (data.attributes?.length) {
        for (const attr of data.attributes) {
            const existing = await client.getElementAttributes(name).catch(() => [])
            if (!existing.some(a => a.Name === attr.Name)) {
                await client.post(
                    `Dimensions('${name}')/Hierarchies('${name}')/ElementAttributes`,
                    { Name: attr.Name, Type: attr.Type ?? 'String' }
                )
            }
        }
    }

    // Element formats — write to }ElementFormats_{dim}
    if (data.element_formats && Object.keys(data.element_formats).length) {
        const fmtCube = `}ElementFormats_${name}`
        const updates = Object.entries(data.element_formats).flatMap(([element, fmts]) =>
            Object.entries(fmts).map(([fmtType, value]) => ({
                dimElemPairs: [
                    { dim: name,    element },
                    { dim: fmtCube, element: fmtType },
                ],
                value,
            }))
        )
        if (updates.length) {
            await client.updateCells(fmtCube, updates).catch(e => {
                console.warn(`  [warn] element formats for ${name}: ${e.message}`)
            })
        }
    }

    // Attribute VALUES — replayed ONLY when this deploy created the dimension.
    // On a redeploy the target's own seed TIs own these (e.g. WFP Load Positions
    // maintains WFP Position attributes), so replaying would clobber them.
    // Definitions that a dimension needs but were built declaratively (Period
    // index, Job Family Pay Index, measure-dim Format values) reach a new target
    // this way instead of needing a per-model seed process.
    if (!exists && data.attribute_values && Object.keys(data.attribute_values).length) {
        const attrCube = `}ElementAttributes_${name}`
        const updates = Object.entries(data.attribute_values).flatMap(([element, attrs]) =>
            Object.entries(attrs).map(([attrName, value]) => ({
                dimElemPairs: [
                    { dim: name,     element },
                    { dim: attrCube, element: attrName },
                ],
                value,
            }))
        )
        if (updates.length) {
            await client.updateCells(attrCube, updates).catch(e => {
                console.warn(`  [warn] attribute values for ${name}: ${e.message}`)
            })
        }
    }
}

async function deployPicklistCube(obj, packageDir, client) {
    const data = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8'))
    const { picklistCube, dimensions: dims, cells } = data

    if (!picklistCube || !dims || !cells) throw new Error('Invalid picklist package file')
    if (!Object.keys(cells).length) return

    const updates = Object.entries(cells).map(([tupleKey, value]) => {
        const elements = tupleKey.split('::')
        return {
            dimElemPairs: [
                ...dims.map((dim, i) => ({ dim, element: elements[i] })),
                { dim: '}Picklist', element: 'Value' },
            ],
            value,
        }
    })

    await client.updateCells(picklistCube, updates)
}

async function deployCube(obj, packageDir, client) {
    const data  = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8'))
    const exists = await client.getCube(data.Name).catch(() => null)
    if (exists) return  // cube already exists — skip silently (per risk check warning)
    // v11 wants Dimensions@odata.bind, not an inline [{Name}] list (that 400s).
    // client.createCube builds the bind form.
    const dimNames = (data.Dimensions ?? []).map(d => d.Name ?? d)
    await client.createCube(data.Name, dimNames)
}

async function deployAttribute(obj, packageDir, client) {
    const data = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8'))
    const dim  = data.Dimension
    const existing = await client.getElementAttributes(dim).catch(() => [])
    if (!existing.some(a => a.Name === data.Attribute)) {
        await client.post(
            `Dimensions('${dim}')/Hierarchies('${dim}')/ElementAttributes`,
            { Name: data.Attribute, Type: data.Type ?? 'String' }
        )
    }
}

// ── Dependency ordering ───────────────────────────────────────────────────────
// Deploy in this order so dependencies are satisfied before dependents

// Dependency order:
//  - dimension first (creates the dim + hierarchy + elements + its own attribute defs)
//  - attribute next: a standalone attribute def POSTs to Dimensions('X')/Hierarchies('X')/
//    ElementAttributes, which 404s if the dimension isn't there yet
//  - cube needs its dimensions; picklist-cube + rules need the cube
//  - subset needs its dimension; view needs the cube and any named subsets
const DEPLOY_ORDER = ['dimension', 'attribute', 'cube', 'picklist-cube', 'rules', 'subset', 'view', 'process']

// ── Main deploy ───────────────────────────────────────────────────────────────

async function deploy(packageDir, targetServer, options = {}, ideToken) {
    const { dryRun = false, skipRiskCheck = false, onProgress } = options

    const manifestPath = path.join(packageDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) throw new Error(`No manifest.json found in ${packageDir}`)

    const manifest     = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const targetClient = makeClient(targetServer, ideToken)

    const report = {
        source_server:  manifest._meta.server,
        target_server:  targetServer,
        session:        manifest._meta.session,
        packaged_at:    manifest._meta.packaged_at,
        deployed_at:    new Date().toISOString(),
        dry_run:        dryRun,
        risk:           null,
        results:        [],
    }

    // ── Risk check ────────────────────────────────────────────────────────────
    if (!skipRiskCheck) {
        onProgress?.('risk-check')
        const riskReport = await analyzeRisk(packageDir, targetServer, ideToken)
        report.risk = riskReport
        if (!riskReport.safe_to_deploy) {
            return { ...report, aborted: true, reason: `${riskReport.blockers.length} blocker(s) found — run tm1deploy risk for details` }
        }
    }

    if (dryRun) {
        return { ...report, aborted: false, dry_run: true }
    }

    // Sort objects in dependency order
    const sorted = [...manifest.objects].sort((a, b) =>
        DEPLOY_ORDER.indexOf(a.type) - DEPLOY_ORDER.indexOf(b.type)
    )

    // ── Deploy each object ────────────────────────────────────────────────────
    for (const obj of sorted) {
        onProgress?.('deploy', obj)

        try {
            switch (obj.type) {
                case 'rules':         await deployRules(obj, packageDir, targetClient);         break
                case 'process':       await deployProcess(obj, packageDir, targetClient);       break
                case 'subset':        await deploySubset(obj, packageDir, targetClient);        break
                case 'view':          await deployView(obj, packageDir, targetClient);          break
                case 'dimension':     await deployDimension(obj, packageDir, targetClient);     break
                case 'cube':          await deployCube(obj, packageDir, targetClient);          break
                case 'picklist-cube': await deployPicklistCube(obj, packageDir, targetClient);  break
                case 'attribute':     await deployAttribute(obj, packageDir, targetClient);     break
                default:
                    throw new Error(`No deployer for type: ${obj.type}`)
            }
            report.results.push({ ok: true, type: obj.type, name: obj.name, detail: obj.detail })
        } catch (e) {
            report.results.push({ ok: false, type: obj.type, name: obj.name, detail: obj.detail, error: e.message })
        }
    }

    report.deployed = report.results.filter(r => r.ok).length
    report.failed   = report.results.filter(r => !r.ok).length

    return { ...report, aborted: false }
}

module.exports = { deploy, deploySubset }
