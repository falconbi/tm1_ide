#!/usr/bin/env node
'use strict'
// One-off governance migration, per server.
//
//   node tools/migrate-governance.js TM1_Test_DEV [TM1_Test_PROD ...]
//       Copy local change sets, approvals and deploy state into the model, then
//       write Applications/Governance/manifest.json. The model is the source of
//       truth; the local files stay as a read fallback until proven.
//
//   node tools/migrate-governance.js --manifest <server> --model|--local [--areas a,b]
//       Write only the manifest (default: all four areas).
//
//   node tools/migrate-governance.js --from-markers [--write]
//       Print the manifest each server would get from the old local markers
//       (data/model-migration.json and config/assertions.json). Writes only
//       with --write.
//
// Nothing in core/ or routes/ writes the manifest — this tool is the only writer.

require(require.resolve('dotenv', { paths: [require('path').join(__dirname, '..', '.env')] })).config({ path: require('path').join(__dirname, '..', '.env') })
const fs = require('fs')
const path = require('path')
const { makeClient } = require('../core/adapter-registry')
const cl = require('../core/change-log')
const store = require('../core/model-store')
const gitApprovals = require('../core/git-approvals')
const gitState = require('../core/git-state')
const csm = require('../core/change-set-model')

const { GOVERNANCE, MANIFEST_DOC, MANIFEST_VERSION, MANIFEST_AREAS } = store
const MARKER_FILE = path.join(__dirname, '..', 'data', 'model-migration.json')
const ASSERTIONS_FILE = path.join(__dirname, '..', 'config', 'assertions.json')

function fail(message) {
    console.error(message)
    process.exit(1)
}

function parseArgs(argv) {
    const opts = { servers: [], manifestServer: null, model: false, local: false, areas: null, fromMarkers: false, write: false }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--manifest') {
            opts.manifestServer = argv[++i]
            if (!opts.manifestServer) fail('--manifest needs a server name')
        } else if (arg === '--model') opts.model = true
        else if (arg === '--local') opts.local = true
        else if (arg === '--areas') {
            opts.areas = String(argv[++i] ?? '').split(',').map(s => s.trim()).filter(Boolean)
            if (!opts.areas.length) fail('--areas needs a comma-separated list')
        } else if (arg.startsWith('--areas=')) {
            opts.areas = arg.slice('--areas='.length).split(',').map(s => s.trim()).filter(Boolean)
        } else if (arg === '--from-markers') opts.fromMarkers = true
        else if (arg === '--write') opts.write = true
        else if (arg.startsWith('--')) fail(`unknown option: ${arg}`)
        else opts.servers.push(arg)
    }
    if (opts.model && opts.local) fail('use --model or --local, not both')
    if (opts.manifestServer && !opts.model && !opts.local) fail('--manifest needs --model or --local')
    if (opts.areas) {
        const bad = opts.areas.filter(a => !MANIFEST_AREAS.includes(a))
        if (bad.length) fail(`unknown area(s): ${bad.join(', ')} (known: ${MANIFEST_AREAS.join(', ')})`)
    }
    return opts
}

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function emptyManifest() {
    return { version: MANIFEST_VERSION, areas: Object.fromEntries(MANIFEST_AREAS.map(a => [a, 'local'])) }
}

// Read an existing manifest for merging. null means "no usable manifest" — the
// normal migration then starts from all-local defaults.
async function readExisting(client) {
    try {
        const files = await client.listFiles(GOVERNANCE)
        if (!files.some(f => f.name === MANIFEST_DOC && !f.isFolder)) return null
        const raw = await client.getFileContent(GOVERNANCE, MANIFEST_DOC)
        const m = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (m?.version !== MANIFEST_VERSION || !m.areas || typeof m.areas !== 'object') return null
        return m
    } catch { return null }
}

async function writeManifest(server, manifest) {
    const client = makeClient(server, null)
    await client.ensureFolderPath(GOVERNANCE)
    const files = await client.listFiles(GOVERNANCE)
    if (!files.some(f => f.name === MANIFEST_DOC && !f.isFolder)) {
        await client.createFileDocument(GOVERNANCE, MANIFEST_DOC)
    }
    await client.putFileContent(GOVERNANCE, MANIFEST_DOC, JSON.stringify(manifest, null, 2))
    const raw = await client.getFileContent(GOVERNANCE, MANIFEST_DOC)
    const back = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (JSON.stringify(back) !== JSON.stringify(manifest)) {
        throw new Error(`read-back mismatch: wrote ${JSON.stringify(manifest)} but the server returned ${JSON.stringify(back)}`)
    }
    console.log(`  wrote ${GOVERNANCE.join('/')}/${MANIFEST_DOC} on ${server}:`)
    console.log(JSON.stringify(back, null, 2))
    console.log('  read back ✓')
    return back
}

async function writeOnly(opts) {
    const server = opts.manifestServer
    const value = opts.model ? 'model' : 'local'
    const areas = opts.areas ?? MANIFEST_AREAS
    // --areas changes only the areas named; the others keep their current value.
    // Without --areas the default is all four, which also resets any unknown state.
    const existing = opts.areas ? await readExisting(makeClient(server, null)) : null
    const manifest = existing?.areas ? { version: MANIFEST_VERSION, areas: { ...emptyManifest().areas, ...existing.areas } } : emptyManifest()
    for (const area of areas) manifest.areas[area] = value
    console.log(`── ${server} ──`)
    await writeManifest(server, manifest)
}

function markersToManifests() {
    const markers = readJson(MARKER_FILE, {})
    const config = readJson(ASSERTIONS_FILE, {})
    const servers = new Set([...Object.keys(markers ?? {}), ...Object.keys(config ?? {})])
    const out = {}
    for (const server of servers) {
        const manifest = emptyManifest()
        const entry = markers?.[server]
        if (entry && typeof entry === 'object') {
            for (const area of ['changeSets', 'approvals', 'deployState']) {
                if (entry[area] === 'model') manifest.areas[area] = 'model'
            }
        }
        const assertions = config?.[server]
        if (assertions && typeof assertions === 'object' && !Array.isArray(assertions) && assertions.migrated === 'model') {
            manifest.areas.assertions = 'model'
        }
        out[server] = manifest
    }
    return out
}

async function fromMarkers(opts) {
    const manifests = markersToManifests()
    const servers = Object.keys(manifests)
    if (!servers.length) {
        console.log('No old markers found — nothing to convert.')
        return
    }
    for (const server of servers) {
        console.log(`── ${server} ──`)
        console.log(JSON.stringify(manifests[server], null, 2))
        if (opts.write) await writeManifest(server, manifests[server])
        else console.log('  (dry run — pass --write to save this manifest)')
    }
}

async function migrateServer(server) {
    console.log(`── ${server} ──`)
    // change sets — CLOSED ones become immutable light-audit records; open ones stay local.
    const sessions = cl.getSessions(server, 1000)
    let closed = 0
    for (const s of sessions) {
        if (!s.closed_at) continue
        const rec = csm.buildClosedRecord(s, { closedBy: s.closed_by, audit: csm.lightAudit(s.id) })
        await store.writeDoc(server, 'changeSets', `${s.id}.json`, rec)
        closed++
    }
    console.log(`  change sets: ${closed} closed → Applications/Governance/ChangeSets/ (light audit)`)

    // approvals for this target
    const local = gitApprovals.readLocal()
    const mine = local.filter(a => a.target === server)
    await store.writeDoc(server, 'approvals', 'approvals.json', mine)
    console.log(`  approvals: ${mine.length} → Applications/Governance/Deployments/approvals.json`)

    // deploy state (this server's last received)
    const state = gitState.load()[server] ?? null
    await store.writeDoc(server, 'deployState', 'state.json', state ? { [server]: state } : {})
    console.log(`  deploy state: ${state ? 'yes' : 'none'} → Applications/Governance/Deployments/state.json`)

    // Ownership is recorded in the manifest, not in a local marker. Preserve an
    // existing assertions choice; otherwise assertions stay local (they migrate
    // separately with tools/migrate-assertions.js).
    const client = makeClient(server, null)
    const existing = await readExisting(client)
    const manifest = emptyManifest()
    if (existing?.areas?.assertions === 'model') manifest.areas.assertions = 'model'
    for (const area of ['changeSets', 'approvals', 'deployState']) manifest.areas[area] = 'model'
    await writeManifest(server, manifest)
    console.log(`  ✔ ${server} is now model-owned for changeSets/approvals/deployState`)
}

async function main() {
    const opts = parseArgs(process.argv.slice(2))
    if (opts.manifestServer) return writeOnly(opts)
    if (opts.fromMarkers) return fromMarkers(opts)
    if (!opts.servers.length) fail('usage: node tools/migrate-governance.js <server> [...]  (or --manifest / --from-markers)')
    for (const server of opts.servers) await migrateServer(server)
}

if (require.main === module) {
    main().catch(e => { console.error('MIGRATION FAILED:', e.message); process.exit(1) })
}

module.exports = { parseArgs, markersToManifests, emptyManifest, migrateServer, writeManifest, fromMarkers, writeOnly }
