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
    const data   = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8'))
    const esc    = s => s.replace(/'/g, "''")
    const exists = await client.getProcess(data.Name).catch(() => null)
    if (exists) await client.patch(`Processes('${esc(data.Name)}')`, data)
    else        await client.post('Processes', data)
}

async function deploySubset(obj, packageDir, client) {
    const data = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8'))
    const dim  = obj.detail
    const name = obj.name
    // saveSubset / saveStaticSubset both PATCH-then-fallback-POST internally
    if (data.Type === 'MDX' || data.Expression) {
        await client.saveSubset(dim, name, data.Expression)
    } else {
        await client.saveStaticSubset(dim, name, (data.Elements ?? []).map(e => e.Name ?? e))
    }
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

    const exists = await client.getDimension(name).catch(() => null)
    if (!exists) {
        await client.post('Dimensions', { Name: name })
        await client.post(`Dimensions('${name}')/Hierarchies`, { Name: name, Dimension: { Name: name } })
    }

    // Upsert elements
    if (data.elements?.length) {
        const payload = data.elements.map(e => ({
            Name:   e.Name   ?? e.name,
            Type:   e.Type   ?? e.type   ?? 'Numeric',
            Weight: e.Weight ?? e.weight ?? 1,
        }))
        await client.post(`Dimensions('${name}')/Hierarchies('${name}')/Elements/tm1.AddElements`, { Elements: payload })
    }

    // Upsert edges
    if (data.edges?.length) {
        const payload = data.edges.map(e => ({
            ParentName: e.ParentName ?? e.parent,
            ComponentName: e.ComponentName ?? e.child ?? e.component,
            Weight: e.Weight ?? e.weight ?? 1,
        }))
        await client.post(`Dimensions('${name}')/Hierarchies('${name}')/Edges/tm1.AddEdges`, { Edges: payload })
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
}

async function deployCube(obj, packageDir, client) {
    const data  = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8'))
    const exists = await client.getCube(data.Name).catch(() => null)
    if (exists) return  // cube already exists — skip silently (per risk check warning)
    await client.post('Cubes', { Name: data.Name, Dimensions: data.Dimensions })
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

const DEPLOY_ORDER = ['attribute', 'dimension', 'cube', 'rules', 'subset', 'view', 'process']

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
                case 'rules':     await deployRules(obj, packageDir, targetClient);     break
                case 'process':   await deployProcess(obj, packageDir, targetClient);   break
                case 'subset':    await deploySubset(obj, packageDir, targetClient);    break
                case 'view':      await deployView(obj, packageDir, targetClient);      break
                case 'dimension': await deployDimension(obj, packageDir, targetClient); break
                case 'cube':      await deployCube(obj, packageDir, targetClient);      break
                case 'attribute': await deployAttribute(obj, packageDir, targetClient); break
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

module.exports = { deploy }
