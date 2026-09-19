#!/usr/bin/env node
'use strict'

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') })

const path = require('path')
const fs   = require('fs')

const { seed }        = require('../src/snapshot')
const { diff }        = require('../src/diff')
const { pack, PACKAGES_DIR } = require('../src/packager')
const { deploy }      = require('../src/deployer')
const { analyzeRisk } = require('../src/risk')
const cl              = require('../../../core/change_log')

const { baselinePathFor } = require('../src/baseline-paths')
const SERVERS_PATH  = path.resolve(__dirname, '../../../config/servers.json')

function loadServers() {
    try {
        return JSON.parse(fs.readFileSync(SERVERS_PATH, 'utf8')).map(s => s.name)
    } catch {
        return []
    }
}

function parseArgs(argv) {
    const args = {}
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            const key = argv[i].slice(2)
            args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
        } else if (!args._cmd) {
            args._cmd = argv[i]
        }
    }
    return args
}

function usage() {
    console.log(`
tm1deploy — TM1 IDE deployment tool

Commands:
  seed    --server <name>               Snapshot a TM1 server to .tm1baseline/<server>.json
  log     [--session <name>]            List sessions (or show entries for a session)
  diff    --server <name>
          --session <name>              Diff session log against server + baseline
  release-diff --server <name>
          [--from <file>] [--to <file>] Diff a release window between two baselines
                                        (default: the baseline before HEAD → HEAD)
  package --server <name>
          --session <name>              Build a deployment package from session changes
  risk    --package <path>
          --target <server>             Full pre-deploy risk report (syntax, deps, chores, structural)
  deploy  --package <path>
          --target <server>             Deploy a package to a target server

Options:
  --server  <name>    Source TM1 server (Dev)
  --target  <name>    Target TM1 server (Prod/Test)
  --session <name>    Work session name (as created in the IDE)
  --package <path>    Path to a package directory (deploy only)
  --output  <path>    Override output path (seed/package)
  --from    <file>    Baseline file for the start of a release window (release-diff)
  --to      <file>    Baseline file for the end of a release window (release-diff)
  --force             Overwrite existing package directory
  --dry-run           Show what would be deployed without making changes
  --json              Output raw JSON (diff/deploy)

Environment variables required:
  PAW_HOST            PAW server URL  e.g. https://paw.company.com
  PAW_USERNAME        PAW login
  PAW_PASSWORD        PAW password

Examples:
  node tools/tm1deploy/bin/tm1deploy.js seed    --server TM1_Apportionment
  node tools/tm1deploy/bin/tm1deploy.js log
  node tools/tm1deploy/bin/tm1deploy.js log     --session apportionment-v1
  node tools/tm1deploy/bin/tm1deploy.js diff    --server TM1_Apportionment --session apportionment-v1
  node tools/tm1deploy/bin/tm1deploy.js package --server TM1_Apportionment --session apportionment-v1
  node tools/tm1deploy/bin/tm1deploy.js risk    --package packages/apportionment-v1-2026-06-12 --target PROD_TM1
  node tools/tm1deploy/bin/tm1deploy.js deploy  --package packages/apportionment-v1-2026-06-12 --target PROD_TM1
  node tools/tm1deploy/bin/tm1deploy.js deploy  --package packages/apportionment-v1-2026-06-12 --target PROD_TM1 --dry-run
`)
}

async function cmdSeed(args) {
    const server = args.server
    if (!server) {
        console.error('Error: --server is required\n')
        usage()
        process.exit(1)
    }

    if (!process.env.PAW_HOST) {
        console.error('Error: PAW_HOST environment variable is not set')
        console.error('Make sure your .env file is present or env vars are exported.\n')
        process.exit(1)
    }

    const known = loadServers()
    if (known.length && !known.includes(server)) {
        console.error(`Error: server "${server}" not found in config/servers.json`)
        console.error(`Known servers: ${known.join(', ')}\n`)
        process.exit(1)
    }

    const outputPath = args.output ?? baselinePathFor(server)

    // Check if a baseline already exists and warn
    if (fs.existsSync(outputPath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
            const age = existing._meta?.seeded_at
            console.log(`Note: existing baseline found (seeded ${age ?? 'unknown date'}) — will be replaced.`)
        } catch {}
    }

    console.log(`\ntm1deploy seed`)
    console.log(`  server : ${server}`)
    console.log(`  output : ${outputPath}`)
    console.log(`  host   : ${process.env.PAW_HOST}`)

    const start = Date.now()
    await seed(server, outputPath)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    console.log(`\nDone in ${elapsed}s`)
    console.log(`Suggested git tag:  git tag baseline-from-${server}-${new Date().toISOString().slice(0, 10)}`)
}

// ── log command ───────────────────────────────────────────────────────────────

function cmdLog(args) {
    const sessions = cl.getAllSessions()

    if (!args.session) {
        if (sessions.length === 0) {
            console.log('\nNo sessions found. Open a work session in the IDE to start logging.\n')
            return
        }
        console.log(`\n${'SESSION'.padEnd(36)}  ${'STARTED'.padEnd(20)}  ${'ENTRIES'.padStart(7)}  STATUS`)
        console.log('─'.repeat(80))
        for (const s of sessions) {
            const started = s.started_at ? new Date(s.started_at).toLocaleString() : '?'
            const status  = s.closed_at ? 'closed' : 'ACTIVE'
            console.log(`${s.name.padEnd(36)}  ${started.padEnd(20)}  ${String(s.entry_count ?? 0).padStart(7)}  ${status}`)
        }
        console.log()
        return
    }

    // Show entries for named session
    const session = sessions.find(s => s.name === args.session)
    if (!session) {
        console.error(`Error: session "${args.session}" not found\n`)
        console.error('Known sessions: ' + (sessions.length ? sessions.map(s => s.name).join(', ') : '(none)'))
        process.exit(1)
    }

    const entries = cl.getSessionLog(session.id)
    if (entries.length === 0) {
        console.log(`\nSession "${args.session}" has no entries.\n`)
        return
    }

    console.log(`\nSession: ${session.name}  (${entries.length} entries)`)
    console.log('─'.repeat(80))
    for (const e of entries) {
        const ts   = e.timestamp ? new Date(e.timestamp).toLocaleString() : '?'
        const name = e.object_name + (e.detail ? ` [${e.detail}]` : '')
        console.log(`  ${ts.padEnd(22)}  ${e.action.padEnd(22)}  ${e.object_type.padEnd(12)}  ${name}`)
    }
    console.log()
}

// ── diff command ──────────────────────────────────────────────────────────────

async function cmdDiff(args) {
    const server = args.server
    const sname  = args.session

    if (!server) { console.error('Error: --server is required\n'); usage(); process.exit(1) }
    if (!sname)  { console.error('Error: --session is required\n'); usage(); process.exit(1) }

    if (!process.env.PAW_HOST) {
        console.error('Error: PAW_HOST environment variable is not set')
        console.error('Make sure your .env file is present or env vars are exported.\n')
        process.exit(1)
    }

    const sessions = cl.getAllSessions()
    const session  = sessions.find(s => s.name === sname)
    if (!session) {
        console.error(`Error: session "${sname}" not found`)
        console.error('Known sessions: ' + (sessions.length ? sessions.map(s => s.name).join(', ') : '(none)'))
        process.exit(1)
    }

    const entries = cl.getSessionLog(session.id)
    if (entries.length === 0) {
        console.log(`\nSession "${sname}" has no entries — nothing to diff.\n`)
        return
    }

    console.log(`\ntm1deploy diff`)
    console.log(`  session  : ${sname}  (${entries.length} log entries)`)
    console.log(`  server   : ${server}`)
    console.log(`  host     : ${process.env.PAW_HOST}`)

    const baselinePath = args.baseline ?? undefined
    const { loadBaseline } = require('../src/diff')
    const baseline = loadBaseline(baselinePath, server)
    if (baseline) {
        console.log(`  baseline : seeded ${baseline._meta?.seeded_at?.slice(0,10)} from ${baseline._meta?.server}`)
    } else {
        console.log(`  baseline : ⚠ none found for ${server} at ${baselinePath ?? baselinePathFor(server)}`)
        console.log(`             Run: npm run tm1deploy seed --server ${server}`)
    }
    console.log()

    const result = await diff(server, entries, baselinePath)

    printDiffResult(server, result, {
        json: !!args.json,
        session: sname,
        baselineNote: baseline ? `seeded ${baseline._meta?.seeded_at?.slice(0,10)} from ${baseline._meta?.server}` : '⚠ none found',
        next: `package --session ${sname} --server ${server}`,
    })
}

// ── release-diff command ──────────────────────────────────────────────────────
// "What changed between baseline N and N+1" — a release-window diff. Reads the
// change-log between two baselines' last_entry_id stamps and diffs the window's
// objects against the FROM baseline. Defaults: from = baseline before HEAD,
// to = HEAD.

async function cmdReleaseDiff(args) {
    const server = args.server
    if (!server) { console.error('Error: --server is required\n'); usage(); process.exit(1) }
    if (!process.env.PAW_HOST) {
        console.error('Error: PAW_HOST environment variable is not set')
        console.error('Make sure your .env file is present or env vars are exported.\n')
        process.exit(1)
    }

    const { loadBaseline, listBaselines } = require('../src/diff')
    const { baselineDirFor } = require('../src/baseline-paths')

    const baselines = listBaselines(server)
    if (baselines.length < 2) {
        console.log(`\nNeed at least two baselines for ${server} to diff a release window.`)
        console.log(`Found: ${baselines.length ? baselines.map(b => b.file).join(', ') : '(none)'}`)
        console.log('Run: npm run tm1deploy seed --server ' + server)
        return
    }

    const to = (args.to ? baselines.find(b => b.file === args.to) : null)
            ?? baselines.find(b => b.is_head) ?? baselines[baselines.length - 1]

    let from
    if (args.from) {
        from = baselines.find(b => b.file === args.from)
        if (!from) { console.error(`Error: baseline "${args.from}" not found\n`); usage(); process.exit(1) }
    } else {
        const idx = baselines.indexOf(to)
        from = idx > 0 ? baselines[idx - 1] : null
    }
    if (!from) {
        console.log(`\nNo baseline before "${to.file}" — nothing to compare.\n`)
        return
    }

    const fromPath = path.join(baselineDirFor(server), from.file)
    const toPath   = path.join(baselineDirFor(server), to.file)
    const fromBase = loadBaseline(fromPath, server)
    const toBase   = loadBaseline(toPath, server)

    const fromId = fromBase?._meta?.last_entry_id ?? 0
    const toId   = toBase?._meta?.last_entry_id ?? Infinity

    const entries = cl.getEntriesSinceId(server, fromId).filter(e => toId === Infinity || e.id <= toId)

    console.log(`\ntm1deploy release-diff`)
    console.log(`  server  : ${server}`)
    console.log(`  window  : ${from.file} → ${to.file}`)
    console.log(`  entries : ${entries.length} (change-log ${fromId} → ${toId === Infinity ? '∞' : toId})`)

    if (entries.length === 0) {
        console.log(`  Nothing changed in this window — the two baselines are adjacent.`)
        return
    }

    const result = await diff(server, entries, fromPath)
    printDiffResult(server, result, {
        json: !!args.json,
        window: `${from.file} → ${to.file}`,
        next: 'package --session <name> --server ' + server + '  (or import via the IDE Deploy panel)',
    })
}

// ── Shared diff table renderer ────────────────────────────────────────────────

const OUTCOME_SYMBOL = { MATCH: '✓', NEW: '+', UNCHANGED: '–', DRIFT: '✗', MISSING: '✗', ERROR: '!' }

function printDiffResult(server, result, { json, session, window, baselineNote, next }) {
    if (json) {
        console.log(JSON.stringify(result, null, 2))
        return
    }

    const ORDER = ['DRIFT', 'MISSING', 'ERROR', 'MATCH', 'NEW', 'UNCHANGED']
    const sorted = [...result.results].sort((a, b) =>
        ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome)
    )

    const PAD = { outcome: 10, object_type: 12, object_name: 36 }
    console.log(
        ' '.padEnd(3) +
        'OUTCOME'.padEnd(PAD.outcome) +
        'TYPE'.padEnd(PAD.object_type) +
        'NAME'.padEnd(PAD.object_name) +
        'NOTE'
    )
    console.log('─'.repeat(100))

    for (const r of sorted) {
        const sym  = OUTCOME_SYMBOL[r.outcome] ?? '?'
        const name = r.object_name + (r.detail ? ` [${r.detail}]` : '')
        console.log(
            ` ${sym} ` +
            r.outcome.padEnd(PAD.outcome) +
            r.object_type.padEnd(PAD.object_type) +
            name.padEnd(PAD.object_name) +
            (r.note ?? '')
        )
    }

    const { match, new: _new, unchanged, drift, missing, error } = result
    console.log()
    console.log(
        `  Match: ${match.length}  New: ${_new.length}  Unchanged: ${unchanged.length}` +
        `  Drift: ${drift.length}  Missing: ${missing.length}` +
        (error.length ? `  Error: ${error.length}` : '')
    )
    console.log()

    const problems = drift.length + missing.length + error.length
    const packable = match.length + _new.length

    if (problems === 0 && packable === 0) {
        console.log('  Nothing to package — all objects match the baseline.')
    } else if (problems > 0) {
        console.log(`  ⚠ ${problems} issue(s) found. Investigate drift/missing before packaging.`)
        if (packable > 0) console.log(`    ${packable} object(s) are ready to package.`)
    } else {
        console.log(`  ✓ All good — ${packable} object(s) ready to package.`)
        if (next) console.log(`    Next: npm run tm1deploy ${next}`)
    }
    console.log()
}

// ── package command ───────────────────────────────────────────────────────────

async function cmdPackage(args) {
    const server = args.server
    const sname  = args.session

    if (!server) { console.error('Error: --server is required\n'); usage(); process.exit(1) }
    if (!sname)  { console.error('Error: --session is required\n'); usage(); process.exit(1) }

    if (!process.env.PAW_HOST) {
        console.error('Error: PAW_HOST environment variable is not set\n')
        process.exit(1)
    }

    const sessions = cl.getAllSessions()
    const session  = sessions.find(s => s.name === sname)
    if (!session) {
        console.error(`Error: session "${sname}" not found`)
        console.error('Known sessions: ' + (sessions.length ? sessions.map(s => s.name).join(', ') : '(none)'))
        process.exit(1)
    }

    const entries = cl.getSessionLog(session.id)
    if (entries.length === 0) {
        console.log(`\nSession "${sname}" has no entries — nothing to package.\n`)
        return
    }

    console.log(`\ntm1deploy package`)
    console.log(`  session  : ${sname}  (${entries.length} log entries)`)
    console.log(`  server   : ${server}`)
    console.log(`  host     : ${process.env.PAW_HOST}`)
    if (args.output) console.log(`  output   : ${args.output}`)
    console.log()

    const result = await pack(server, entries, sname, {
        baselinePath: args.baseline,
        outputDir:    args.output,
        force:        !!args.force,
    })

    if (result.packaged === 0) {
        console.log('  Nothing to package — run diff to check for drift or missing objects.')
        return
    }

    console.log(`  Packaged : ${result.packaged} objects`)
    if (result.skipped > 0) console.log(`  Skipped  : ${result.skipped} (drift/missing/unchanged — see manifest.json)`)
    if (result.errors  > 0) console.log(`  Errors   : ${result.errors}`)
    console.log(`  Output   : ${result.outputDir}`)
    console.log()

    // Show object list
    console.log(`  ${'TYPE'.padEnd(12)}  ${'NAME'.padEnd(36)}  FILE`)
    console.log('  ' + '─'.repeat(80))
    for (const obj of result.manifest.objects) {
        const name = obj.name + (obj.detail ? ` [${obj.detail}]` : '')
        console.log(`  ${obj.type.padEnd(12)}  ${name.padEnd(36)}  ${obj.file}`)
    }
    console.log()
    console.log(`  Next: npm run tm1deploy deploy --package ${result.outputDir} --target <server>`)
    console.log()
}

// ── risk command ──────────────────────────────────────────────────────────────

const LEVEL_ICON   = { BLOCKER: '✗', WARNING: '⚠', INFO: 'ℹ' }
const LEVEL_HEADER = { BLOCKER: 'BLOCKERS', WARNING: 'WARNINGS', INFO: 'INFO' }

function printRiskGroup(items, level) {
    if (!items.length) return
    console.log(`\n  ${LEVEL_HEADER[level]} (${items.length})`)
    for (const r of items) {
        const icon = LEVEL_ICON[level]
        const name = r.name + (r.detail ? ` [${r.detail}]` : '')
        const chk  = r.check.padEnd(12)
        const typ  = r.type.padEnd(12)
        console.log(`  ${icon} ${chk}  ${typ}  ${name.padEnd(36)}  ${r.message}`)
    }
}

async function cmdRisk(args) {
    const packageArg = args.package
    const target     = args.target

    if (!packageArg) { console.error('Error: --package is required\n'); usage(); process.exit(1) }
    if (!target)     { console.error('Error: --target is required\n');  usage(); process.exit(1) }

    if (!process.env.PAW_HOST) {
        console.error('Error: PAW_HOST environment variable is not set\n')
        process.exit(1)
    }

    const packageDir = path.isAbsolute(packageArg) ? packageArg : path.resolve(process.cwd(), packageArg)
    if (!fs.existsSync(path.join(packageDir, 'manifest.json'))) {
        console.error(`Error: no manifest.json found in ${packageDir}`)
        process.exit(1)
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'))

    console.log(`\ntm1deploy risk`)
    console.log(`  package  : ${packageDir}`)
    console.log(`  session  : ${manifest._meta?.session ?? '?'}`)
    console.log(`  source   : ${manifest._meta?.server ?? '?'}`)
    console.log(`  target   : ${target}`)
    console.log(`  objects  : ${manifest.objects?.length ?? 0}`)
    console.log(`  host     : ${process.env.PAW_HOST}`)
    console.log()
    process.stdout.write(`  Analyzing…`)

    let report
    try {
        report = await analyzeRisk(packageDir, target)
    } catch (e) {
        console.error(`\n\n  Fatal: ${e.message}`)
        process.exit(1)
    }
    console.log(` done (${report.objects_checked} checks)`)

    if (args.json) {
        console.log(JSON.stringify(report, null, 2))
        return
    }

    // ── Column header ─────────────────────────────────────────────────────────
    console.log()
    console.log(`  ${'CHECK'.padEnd(14)}  ${'TYPE'.padEnd(12)}  ${'NAME'.padEnd(36)}  MESSAGE`)
    console.log('  ' + '─'.repeat(96))

    printRiskGroup(report.blockers, 'BLOCKER')
    printRiskGroup(report.warnings, 'WARNING')
    printRiskGroup(report.infos,    'INFO')

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log()
    console.log(`  Blockers: ${report.blockers.length}   Warnings: ${report.warnings.length}   Info: ${report.infos.length}`)
    console.log()

    if (!report.safe_to_deploy) {
        console.log(`  ✗ NOT SAFE TO DEPLOY — resolve ${report.blockers.length} blocker(s) before proceeding.`)
    } else if (report.warnings.length > 0) {
        console.log(`  ⚠ Safe to deploy — review ${report.warnings.length} warning(s) above.`)
        console.log(`    Run deploy when ready:`)
        console.log(`    npm run tm1deploy deploy --package ${packageArg} --target ${target}`)
    } else {
        console.log(`  ✓ Clear — no blockers or warnings. Ready to deploy.`)
        console.log(`    npm run tm1deploy deploy --package ${packageArg} --target ${target}`)
    }
    console.log()

    process.exit(report.safe_to_deploy ? 0 : 1)
}

// ── deploy command ────────────────────────────────────────────────────────────

const RISK_ICON = { INFO: 'ℹ', WARN: '⚠', ERROR: '✗' }

async function cmdDeploy(args) {
    const packageDir  = args.package
    const targetName  = args.target
    const dryRun      = !!args['dry-run']

    if (!packageDir)  { console.error('Error: --package is required\n'); usage(); process.exit(1) }
    if (!targetName)  { console.error('Error: --target is required\n');  usage(); process.exit(1) }

    if (!process.env.PAW_HOST) {
        console.error('Error: PAW_HOST environment variable is not set\n')
        process.exit(1)
    }

    const resolvedDir = path.isAbsolute(packageDir) ? packageDir : path.resolve(process.cwd(), packageDir)
    if (!fs.existsSync(path.join(resolvedDir, 'manifest.json'))) {
        console.error(`Error: no manifest.json found in ${resolvedDir}`)
        process.exit(1)
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(resolvedDir, 'manifest.json'), 'utf8'))

    console.log(`\ntm1deploy deploy${dryRun ? ' (DRY RUN)' : ''}`)
    console.log(`  package  : ${resolvedDir}`)
    console.log(`  session  : ${manifest._meta.session}`)
    console.log(`  source   : ${manifest._meta.server}`)
    console.log(`  target   : ${targetName}`)
    console.log(`  packaged : ${manifest.objects.length} objects`)
    console.log(`  host     : ${process.env.PAW_HOST}`)
    console.log()

    if (!dryRun) {
        const answer = await new Promise(resolve => {
            process.stdout.write(`  Confirm deploy to "${targetName}"? [y/N] `)
            process.stdin.once('data', d => resolve(d.toString().trim().toLowerCase()))
        })
        if (answer !== 'y' && answer !== 'yes') {
            console.log('\n  Aborted.\n')
            process.exit(0)
        }
        console.log()
    }

    let lastType = null
    let didRiskCheck = false
    const result = await deploy(resolvedDir, targetName, {
        dryRun,
        onProgress: (stage, obj) => {
            if (stage === 'risk-check') { process.stdout.write('  Checking risks…'); didRiskCheck = true }
            if (stage === 'deploy' && obj) {
                if (!didRiskCheck) { didRiskCheck = true } else if (lastType === null) { console.log() }
                if (obj.type !== lastType) { console.log(`\n  ${obj.type.toUpperCase()}S`); lastType = obj.type }
                process.stdout.write(`    ${obj.name}${obj.detail ? ` [${obj.detail}]` : ''}… `)
            }
        },
    })

    if (didRiskCheck) console.log() // flush progress line

    // Print risk summary
    if (result.risks?.length) {
        console.log(`\n  Risk check:`)
        for (const r of result.risks) {
            const icon = RISK_ICON[r.level] ?? '?'
            const name = r.obj.name + (r.obj.detail ? ` [${r.obj.detail}]` : '')
            console.log(`    ${icon} ${name}: ${r.message}`)
        }
    }

    if (result.aborted) {
        console.log(`\n  Deploy ABORTED: ${result.reason}\n`)
        process.exit(1)
    }

    if (dryRun) {
        console.log(`\n  Dry run complete. ${manifest.objects.length} object(s) would be deployed to ${targetName}.`)
        if (result.risks?.filter(r => r.level === 'WARN').length) {
            console.log(`  Review ⚠ warnings above before running without --dry-run.`)
        }
        console.log()
        return
    }

    // Print per-object results
    console.log(`\n  Results:`)
    for (const r of result.results ?? []) {
        const name = r.name + (r.detail ? ` [${r.detail}]` : '')
        if (r.ok) console.log(`    ✓ ${r.type.padEnd(12)} ${name}`)
        else      console.log(`    ✗ ${r.type.padEnd(12)} ${name}  — ${r.error}`)
    }

    console.log()
    console.log(`  Deployed: ${result.deployed ?? 0}  Failed: ${result.failed ?? 0}`)
    if (result.failed > 0) {
        console.log(`\n  ⚠ Some objects failed to deploy. Review errors above.`)
        process.exit(1)
    } else {
        console.log(`  ✓ Deployment complete.`)
    }
    console.log()

    if (args.json) console.log(JSON.stringify(result, null, 2))
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv.slice(2))

    switch (args._cmd) {
        case 'seed':    return cmdSeed(args)
        case 'log':     return cmdLog(args)
        case 'diff':    return cmdDiff(args)
        case 'release-diff': return cmdReleaseDiff(args)
        case 'package': return cmdPackage(args)
        case 'risk':    return cmdRisk(args)
        case 'deploy':  return cmdDeploy(args)
        default:
            console.error(args._cmd ? `Unknown command: ${args._cmd}\n` : '')
            usage()
            process.exit(args._cmd ? 1 : 0)
    }
}

main().catch(e => {
    console.error('\nFatal:', e.message)
    if (process.env.DEBUG) console.error(e.stack)
    process.exit(1)
})
