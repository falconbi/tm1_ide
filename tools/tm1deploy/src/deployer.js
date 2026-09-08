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

    // Static subset. client.saveStaticSubset has replace semantics on v11 (fresh
    // POST if new; SubsetDeleteAllElements + ordered insert via TI if it exists —
    // a bare PATCH of Elements@odata.bind APPENDS and never replaces).
    const elements = (data.Elements ?? []).map(e => e.Name ?? e.name ?? e).filter(Boolean)
    await client.saveStaticSubset(dim, name, elements)
}

async function deployView(obj, packageDir, client) {
    const data = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8'))
    const cube = obj.detail
    const name = obj.name
    if (data.Type === 'MDX' || data.MDX) {
        // saveView PATCH-then-fallback-POST internally
        await client.saveView(cube, name, data.MDX)
    } else if (data.Type === 'Native') {
        await client.saveNativeView(cube, name, {
            rows: data.rows, columns: data.columns, titles: data.titles,
            suppressEmptyRows: data.suppressEmptyRows, suppressEmptyColumns: data.suppressEmptyColumns,
        })
    }
}

async function deployDimension(obj, packageDir, client, report = {}) {
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

    // Structural readback — the package IS the declared structure, so confirm the
    // target now matches it. A shortfall means an add silently failed (or the
    // v11 per-POST loop choked on a large hierarchy). Recorded loudly, not a
    // console.warn — this is how you find out the package's dimension snapshot
    // isn't being fully applied without a per-model rebuild process.
    if ((data.elements ?? []).length) {
        const pkgEl = (data.elements ?? []).length
        const tgtEl = (await client.getElements(name).catch(() => [])).length
        if (tgtEl < pkgEl) {
            report.structure_gaps = report.structure_gaps ?? []
            report.structure_gaps.push(`${name}: package has ${pkgEl} elements, target has ${tgtEl} after deploy`)
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

    // Attribute VALUES ride along as packaged data and are replayed on EVERY
    // deploy — the package is the declared state. Scope: only the (element,
    // attribute) pairs the package captured; attributes the package doesn't know
    // about are left alone. This is what lets a model drop its "seed the
    // attribute values" workaround process.
    if (data.attribute_values && Object.keys(data.attribute_values).length) {
        const attrCube = `}ElementAttributes_${name}`
        const updates = Object.entries(data.attribute_values).flatMap(([element, attrs]) =>
            Object.entries(attrs)
                .filter(([, value]) => value !== null && value !== undefined && value !== '')
                .map(([attrName, value]) => ({
                    dimElemPairs: [
                        { dim: name,     element },
                        { dim: attrCube, element: attrName },
                    ],
                    value,
                }))
        )
        if (updates.length) {
            report.attribute_values = report.attribute_values ?? {}
            report.attribute_values[name] = updates.length
            await client.updateCells(attrCube, updates).catch(e => {
                console.warn(`  [warn] attribute values for ${name}: ${e.message}`)
                report.attribute_value_errors = report.attribute_value_errors ?? {}
                report.attribute_value_errors[name] = e.message
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
    const { dryRun = false, skipRiskCheck = false, force = false, skipAutoBaseline = false, onProgress } = options

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

    // ── Completeness gate ─────────────────────────────────────────────────────
    // Every object the change set touched must be in the package (or DELETED).
    // A gap = the package was built after a baseline reseed, or a diff bug, and
    // deploying it leaves the target half-updated (WFP Phase 4: rules dropped).
    const gaps = manifest._meta?.completeness?.gaps ?? []
    // per-file sanity too: every packaged object must have its file on disk
    const missingFiles = (manifest.objects ?? []).filter(o =>
        o.file && !fs.existsSync(path.join(packageDir, o.file))
    )
    if ((gaps.length || missingFiles.length) && !force) {
        return {
            ...report,
            aborted: true,
            reason: [
                gaps.length && `Package is missing ${gaps.length} object(s) the change set changed: ${gaps.map(g => `${g.type}/${g.name} (${g.outcome})`).join(', ')}`,
                missingFiles.length && `${missingFiles.length} packaged object(s) have no file: ${missingFiles.map(o => o.file).join(', ')}`,
                'Re-package (its diff was likely built against a moved baseline), or deploy with force to override.',
            ].filter(Boolean).join(' — '),
            completeness_gaps: gaps,
        }
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
                case 'dimension':     await deployDimension(obj, packageDir, targetClient, report); break
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

    // ── Deletions ────────────────────────────────────────────────────────────
    // Objects removed on the source since the baseline. Whole-object deletes
    // only (process / view / subset / chore) — element/attribute removals are
    // handled inside deployDimension. Cube/dimension deletes are deliberately
    // NOT auto-applied (too destructive; flag for a human).
    const dels = manifest.deleted ?? []
    if (!dryRun && dels.length) {
        report.deleted = []
        for (const d of dels) {
            try {
                if      (d.type === 'process') await targetClient.deleteProcess(d.name)
                else if (d.type === 'view')    await targetClient.deleteView(d.detail, d.name)
                else if (d.type === 'subset')  await targetClient.deleteSubset(d.detail, d.name)
                else if (d.type === 'chore')   await targetClient.deleteChore(d.name)
                else { report.deleted.push({ ...d, ok: false, error: `${d.type} deletion not auto-applied — remove manually` }); continue }
                report.deleted.push({ ...d, ok: true })
            } catch (e) {
                // already gone on the target is fine
                const gone = /not\s*found|404|does not exist/i.test(e.message)
                report.deleted.push({ ...d, ok: gone, error: gone ? undefined : e.message })
            }
        }
    }

    // ── Post-deploy steps ─────────────────────────────────────────────────────
    // Structural finishers the package declares (manifest._meta.post_deploy) —
    // reprocess feeders, and anything else that "finishes making the model work
    // on this server". Run on the TARGET, in order, BEFORE verification so the
    // assertions see a fully-built model. This is what replaces the manual
    // "remember to run these 5 processes after every deploy" list.
    const hooks = manifest._meta?.post_deploy ?? []
    if (!dryRun && hooks.length && report.failed === 0) {
        report.post_deploy = []
        for (const h of hooks) {
            const procName = typeof h === 'string' ? h : h.name
            try {
                onProgress?.('post-deploy', { name: procName })
                const r = await targetClient.executeProcess(procName)
                const status = r?.ProcessExecuteStatusCode
                const okr = status === undefined || status === 0 || status === 'CompletedSuccessfully' || status === 'HasMinorErrors'
                report.post_deploy.push({ name: procName, ok: okr, status: status ?? 'ok' })
            } catch (e) {
                report.post_deploy.push({ name: procName, ok: false, error: e.message })
            }
        }
        report.post_deploy_failed = report.post_deploy.some(p => !p.ok)
    }

    // ── Post-deploy verification ──────────────────────────────────────────────
    // Run the SOURCE server's stored assertions against the TARGET (now built by
    // the post-deploy steps above). Advisory — it does NOT gate the baseline
    // (assertions can fail for data reasons unrelated to the deploy) — but
    // report.verification_failed flags it loudly.
    if (!dryRun && manifest._meta?.server) {
        try {
            onProgress?.('verify')
            const assertions = require('../../../core/assertions')
            const v = await assertions.run(manifest._meta.server, { targetServer, ideToken })
            report.verification = v
            report.verification_failed = v.total > 0 && v.failed.length > 0
        } catch (e) {
            report.verification = { error: e.message }
        }
    }

    // ── Auto-seed baselines ───────────────────────────────────────────────────
    // Owns baseline timing so it can't be done manually at the wrong moment.
    // "Clean" = every object deployed AND every post-deploy step succeeded.
    // Verification (assertions) is recorded as a warning on the baseline, NOT a
    // gate — the old "verification failed because the seeds hadn't run yet, so
    // B4 skipped and the operator had to seed by hand" trap. Seeds BOTH the
    // target (now = deployed state) and the source (next release window starts
    // here); also re-seeds the target baseline so drift-check has a fresh
    // reference next time.
    const clean = !dryRun && report.failed === 0 && !report.post_deploy_failed
    if (clean && !skipAutoBaseline) {
        try {
            onProgress?.('baseline')
            const { seed } = require('./snapshot')
            const cl = require('../../../core/change_log')
            const warn  = report.verification_failed
                ? ` [UNVERIFIED: ${report.verification.failed.length}/${report.verification.total} assertions failing]`
                : ''
            const label = `post-deploy ${targetServer} ← ${manifest._meta.session ?? 'release'} (${report.deployed_at.slice(0, 10)})${warn}`
            const seeded = {}
            for (const srv of [targetServer, manifest._meta.server].filter((s, i, a) => s && a.indexOf(s) === i)) {
                await seed(srv, null, ideToken, { last_entry_id: cl.getMaxEntryId(srv), label, verification_failed: !!report.verification_failed })
                seeded[srv === targetServer ? 'target' : 'source'] = srv
            }
            report.baselines_seeded = seeded
        } catch (e) {
            report.baseline_error = e.message
        }
    }

    return { ...report, aborted: false }
}

module.exports = { deploy, deploySubset }
