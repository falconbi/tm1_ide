#!/usr/bin/env node
'use strict'

// ── Migrate assertions into the model ────────────────────────────────────────
//
// One-time, per-server, opt-in: copies a server's entries from
// config/assertions.json into that server's own governance document
// (Applications/Governance/Tests/assertions.json) so the model owns its tests
// (docs/MODEL_OWNED_HISTORY_PLAN.md, phase 1).
//
// Copy only — config/assertions.json is left untouched. Refuses to overwrite an
// existing model document unless --force. After writing, reads the document back
// and prints the count the server actually holds.
//
// Usage:
//   node tools/migrate-assertions.js --server MyServer --dry-run   # what would move
//   node tools/migrate-assertions.js --server MyServer             # does it
//   node tools/migrate-assertions.js --server MyServer --force     # overwrite existing

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const assertions = require('../core/assertions')

function parseArgs(argv) {
    const out = {}
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--server') out.server = argv[++i]
        else if (argv[i] === '--dry-run') out.dryRun = true
        else if (argv[i] === '--force') out.force = true
    }
    return out
}

async function main() {
    const { server, dryRun, force } = parseArgs(process.argv.slice(2))
    if (!server) {
        process.stderr.write('Usage: node tools/migrate-assertions.js --server <name> [--dry-run] [--force]\n')
        process.exit(1)
    }

    const r = await assertions.migrate(server, { dryRun, force })

    if (r.dryRun) {
        console.log(`Dry run — would copy ${r.count} assertion(s) for "${r.server}" to ${r.target}.`)
        if (r.existing) {
            console.log(`  Note: the server already has ${r.target} (${r.existing} records) — this needs --force to overwrite.`)
            if (r.will_backup) console.log('  With --force: the existing document would be backed up first (assertions.backup-<iso>.json).')
        }
        console.log('config/assertions.json is left untouched. Re-run without --dry-run to do it.')
        return
    }

    console.log(`✓ Wrote ${r.count} assertion(s) for "${r.server}" to ${r.target} (source: ${r.source}).`)
    if (r.backup) console.log(`  Backup of the previous document: ${r.backup}.`)
    console.log(`  Read back from the server: ${r.read_back}.`)
    if (!r.matches) {
        console.error(`✗ MISMATCH — wrote ${r.count}, read back ${r.read_back}. Do not trust this migration.`)
        process.exit(1)
    }
}

main().catch(e => { console.error(`✗ ${e.message}`); process.exit(1) })