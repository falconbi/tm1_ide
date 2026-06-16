'use strict'

const fs   = require('fs')
const path = require('path')
const { makeClient } = require('./client')

// ── Result builder ────────────────────────────────────────────────────────────

function item(level, check, type, name, message, detail = null, data = {}) {
    return { level, check, type, name, detail, message, ...( Object.keys(data).length ? { data } : {}) }
}

// ── 1. Syntax ─────────────────────────────────────────────────────────────────

async function checkRulesSyntax(obj, packageDir, client) {
    const rulesText = fs.readFileSync(path.join(packageDir, obj.file), 'utf8')
    if (!rulesText.trim()) return [item('INFO', 'syntax', 'rules', obj.name, 'Rules file is empty')]

    const cube = await client.getCube(obj.name).catch(() => null)
    if (!cube) {
        return [item('INFO', 'syntax', 'rules', obj.name, 'Cube not on target yet — syntax check deferred to deploy')]
    }

    const esc = s => s.replace(/'/g, "''")
    try {
        const result = await client.post(`Cubes('${esc(obj.name)}')/tm1.CheckRules`, { Rules: rulesText })
        const errors = result?.value ?? []
        if (errors.length === 0) return [item('INFO', 'syntax', 'rules', obj.name, 'Rules syntax OK')]
        return errors.map(e => item('BLOCKER', 'syntax', 'rules', obj.name,
            `Syntax error line ${e.LineNumber ?? '?'}: ${e.Message ?? e.Description ?? JSON.stringify(e)}`
        ))
    } catch (e) {
        return [item('INFO', 'syntax', 'rules', obj.name, `CheckRules unavailable: ${e.message}`)]
    }
}

async function checkProcessSyntax(obj, packageDir) {
    let data
    try { data = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8')) }
    catch (e) { return [item('BLOCKER', 'syntax', 'process', obj.name, `Cannot parse package file: ${e.message}`)] }

    const risks = []
    for (const section of ['PrologProcedure', 'MetaDataProcedure', 'DataProcedure', 'EpilogProcedure']) {
        if (typeof data[section] !== 'string') {
            risks.push(item('BLOCKER', 'syntax', 'process', obj.name, `Missing required section: ${section}`))
        }
    }

    const hasDataCode  = data.DataProcedure?.trim()
    const hasSource    = data.DataSources?.length && data.DataSources[0]?.Type !== 'None'
    if (hasDataCode && !hasSource) {
        risks.push(item('INFO', 'syntax', 'process', obj.name,
            'Data section has code but no datasource configured — may be intentional'))
    }

    if (risks.length === 0) risks.push(item('INFO', 'syntax', 'process', obj.name, 'Process structure OK'))
    return risks
}

// ── 2. Dependencies ───────────────────────────────────────────────────────────

async function checkCubeDependencies(obj, packageDir, client) {
    let data
    try { data = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8')) }
    catch { return [] }

    const dims = data.Dimensions ?? []
    if (!dims.length) return [item('WARNING', 'dependency', 'cube', obj.name, 'Package has no dimension list for this cube')]

    const checks = await Promise.all(dims.map(async dim => {
        const exists = await client.getDimension(dim).catch(() => null)
        return { dim, exists: !!exists }
    }))

    const missing = checks.filter(c => !c.exists)
    const present = checks.filter(c => c.exists)

    const risks = []
    if (missing.length) {
        risks.push(item('BLOCKER', 'dependency', 'cube', obj.name,
            `${missing.length} required dimension(s) missing on target: ${missing.map(c => c.dim).join(', ')}`,
            null, { missing: missing.map(c => c.dim) }))
    }
    if (present.length) {
        risks.push(item('INFO', 'dependency', 'cube', obj.name,
            `${present.length}/${dims.length} required dimensions present on target`))
    }
    return risks
}

async function checkSubsetDependency(obj, client) {
    const dim = obj.detail
    if (!dim) return [item('WARNING', 'dependency', 'subset', obj.name, 'No parent dimension recorded in manifest')]
    const exists = await client.getDimension(dim).catch(() => null)
    if (!exists) return [item('BLOCKER', 'dependency', 'subset', obj.name,
        `Parent dimension "${dim}" does not exist on target`, dim)]
    return [item('INFO', 'dependency', 'subset', obj.name, `Parent dimension "${dim}" present ✓`, dim)]
}

async function checkViewDependency(obj, client) {
    const cube = obj.detail
    if (!cube) return [item('WARNING', 'dependency', 'view', obj.name, 'No parent cube recorded in manifest')]
    const exists = await client.getCube(cube).catch(() => null)
    if (!exists) return [item('BLOCKER', 'dependency', 'view', obj.name,
        `Parent cube "${cube}" does not exist on target`, cube)]
    return [item('INFO', 'dependency', 'view', obj.name, `Parent cube "${cube}" present ✓`, cube)]
}

async function checkRulesDependency(obj, client) {
    const cube = await client.getCube(obj.name).catch(() => null)
    if (!cube) return [item('WARNING', 'dependency', 'rules', obj.name,
        `Cube "${obj.name}" does not exist on target — rules cannot be deployed`)]
    return []
}

// ── 3. Chore conflicts ────────────────────────────────────────────────────────

async function checkChoreConflicts(processObjects, client) {
    if (!processObjects.length) return []

    const processNames = new Set(processObjects.map(o => o.name))
    const risks = []

    let choreNames
    try { choreNames = await client.getChores() }
    catch { return [item('INFO', 'chore', 'process', '*', 'Could not fetch chores from target — skipped')] }

    // Fetch all chores in parallel
    const chores = await Promise.all(
        choreNames.map(n => client.getChore(n).then(c => ({ ...c, _name: n })).catch(() => null))
    )

    for (const chore of chores.filter(Boolean)) {
        const steps = chore.Steps ?? []
        for (const step of steps) {
            const procName = step.Process?.Name
            if (!procName || !processNames.has(procName)) continue

            const isActive  = chore.Active === true
            const isRunning = !!(chore.IsRunning ?? chore.ExecutionMode === 'Unstarted' === false)
            const choreName = chore._name

            if (isRunning) {
                risks.push(item('BLOCKER', 'chore', 'process', procName,
                    `Chore "${choreName}" is CURRENTLY RUNNING and contains this process — deploying now will corrupt the run`,
                    null, { chore: choreName, active: isActive, running: true }))
            } else if (isActive) {
                risks.push(item('WARNING', 'chore', 'process', procName,
                    `Active chore "${choreName}" contains this process — next scheduled run will use the new version`,
                    null, { chore: choreName, active: true }))
            } else {
                risks.push(item('INFO', 'chore', 'process', procName,
                    `Inactive chore "${choreName}" references this process`,
                    null, { chore: choreName, active: false }))
            }
        }
    }

    return risks
}

// ── 4. Structural impact ──────────────────────────────────────────────────────

async function checkDimensionImpact(obj, packageDir, client) {
    let data
    try { data = JSON.parse(fs.readFileSync(path.join(packageDir, obj.file), 'utf8')) }
    catch { return [] }

    const name          = obj.name
    const targetElems   = await client.getElements(name).catch(() => null)
    const pkgElems      = data.elements ?? []

    if (!targetElems) {
        return [item('INFO', 'structural', 'dimension', name,
            `New dimension — ${pkgElems.length} element(s) will be created`)]
    }

    const pkgNames    = new Set(pkgElems.map(e => (e.Name ?? e.name ?? '')))
    const targetNames = new Set(targetElems.map(e => e.Name))

    const removed = [...targetNames].filter(n => !pkgNames.has(n))
    const added   = [...pkgNames].filter(n => n && !targetNames.has(n))
    const risks   = []

    if (removed.length > 0) {
        // Removing consolidations is riskier than removing leaves
        const removedConsolidated = targetElems
            .filter(e => removed.includes(e.Name) && (e.Type === 'C' || e.Type === 'Consolidated'))
        const level = removed.length > 20 || removedConsolidated.length > 0 ? 'BLOCKER' : 'WARNING'
        risks.push(item(level, 'structural', 'dimension', name,
            `${removed.length} element(s) will be REMOVED from target` +
            (removedConsolidated.length ? ` (${removedConsolidated.length} are consolidations)` : '') +
            `: ${removed.slice(0, 6).join(', ')}${removed.length > 6 ? `… +${removed.length - 6} more` : ''}`,
            null, { removed, removed_consolidated: removedConsolidated.map(e => e.Name) }))
    }

    if (added.length > 0) {
        risks.push(item('INFO', 'structural', 'dimension', name,
            `${added.length} new element(s) will be added`))
    }

    if (removed.length === 0 && added.length === 0) {
        risks.push(item('INFO', 'structural', 'dimension', name,
            `Element list unchanged on target — only attribute/edge changes will apply`))
    }

    return risks
}

// ── 5. Overwrite summary ──────────────────────────────────────────────────────

async function checkRulesOverwrite(obj, packageDir, client) {
    const cube = await client.getCube(obj.name).catch(() => null)
    if (!cube) return []

    const existing = (cube.Rules ?? '').trim()
    if (!existing) return [item('INFO', 'overwrite', 'rules', obj.name, 'Target cube has no existing rules — first write')]

    const incoming      = fs.readFileSync(path.join(packageDir, obj.file), 'utf8')
    const existingLines = existing.split('\n').length
    const incomingLines = incoming.trim().split('\n').length
    const delta         = incomingLines - existingLines
    const deltaStr      = delta === 0 ? 'same line count' : `${delta > 0 ? '+' : ''}${delta} lines`

    return [item('INFO', 'overwrite', 'rules', obj.name,
        `Replaces ${existingLines}-line rules with ${incomingLines} lines (${deltaStr})`,
        null, { existing_lines: existingLines, incoming_lines: incomingLines })]
}

async function checkProcessOverwrite(obj, client) {
    const existing = await client.getProcess(obj.name).catch(() => null)
    if (!existing) return [item('INFO', 'overwrite', 'process', obj.name, 'New process — will be created')]

    const risks = [item('INFO', 'overwrite', 'process', obj.name, 'Overwrites existing process on target')]

    // Check parameters — if target has different params, callers may break
    const targetParams  = (existing.Parameters ?? []).map(p => p.Name)
    return risks
}

async function checkSubsetOverwrite(obj, client) {
    const existing = await client.getSubset(obj.detail, obj.name).catch(() => null)
    if (!existing) return []
    return [item('INFO', 'overwrite', 'subset', obj.name,
        `Overwrites existing subset in dimension "${obj.detail}"`, obj.detail)]
}

async function checkViewOverwrite(obj, client) {
    const existing = await client.getView(obj.detail, obj.name).catch(() => null)
    if (!existing) return []
    return [item('INFO', 'overwrite', 'view', obj.name,
        `Overwrites existing view in cube "${obj.detail}"`, obj.detail)]
}

// ── Main analyzer ─────────────────────────────────────────────────────────────

async function analyzeRisk(packageDir, targetServer, ideToken) {
    const manifestPath = path.join(packageDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) throw new Error(`No manifest.json found in ${packageDir}`)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const client   = makeClient(targetServer, ideToken)
    const objects  = manifest.objects ?? []

    if (!objects.length) {
        return {
            package_dir: packageDir, target_server: targetServer,
            session: manifest._meta?.session, analyzed_at: new Date().toISOString(),
            objects_checked: 0, safe_to_deploy: true,
            blockers: [], warnings: [], infos: [], all: [],
        }
    }

    const all = []
    const push = arr => all.push(...arr)

    // Run checks in parallel per category, sequential between categories
    // (dep checks can use results of earlier checks conceptually, but all run async here)

    await Promise.all(objects.map(async obj => {
        try {
            if (obj.type === 'rules') {
                push(await checkRulesSyntax(obj, packageDir, client))
                push(await checkRulesDependency(obj, client))
                push(await checkRulesOverwrite(obj, packageDir, client))
            }
            if (obj.type === 'process') {
                push(await checkProcessSyntax(obj, packageDir))
                push(await checkProcessOverwrite(obj, client))
            }
            if (obj.type === 'cube')      push(await checkCubeDependencies(obj, packageDir, client))
            if (obj.type === 'subset') {
                push(await checkSubsetDependency(obj, client))
                push(await checkSubsetOverwrite(obj, client))
            }
            if (obj.type === 'view') {
                push(await checkViewDependency(obj, client))
                push(await checkViewOverwrite(obj, client))
            }
            if (obj.type === 'dimension') push(await checkDimensionImpact(obj, packageDir, client))
        } catch (e) {
            all.push(item('WARNING', 'check-failed', obj.type, obj.name, `Risk check threw: ${e.message}`))
        }
    }))

    // Chore conflict check — single pass across all process objects
    push(await checkChoreConflicts(objects.filter(o => o.type === 'process'), client))

    const blockers = all.filter(r => r.level === 'BLOCKER')
    const warnings = all.filter(r => r.level === 'WARNING')
    const infos    = all.filter(r => r.level === 'INFO')

    return {
        package_dir:     packageDir,
        target_server:   targetServer,
        session:         manifest._meta?.session,
        analyzed_at:     new Date().toISOString(),
        objects_checked: objects.length,
        safe_to_deploy:  blockers.length === 0,
        blockers,
        warnings,
        infos,
        all,
    }
}

module.exports = { analyzeRisk }
