#!/usr/bin/env node
'use strict'

// ── Automated catalog drift check ─────────────────────────────────────────────
//
// Runs every TI-usable entry in shared/tm1-function-catalog.json against a REAL,
// live TM1 server to catch drift automatically instead of relying on someone
// noticing a stale code comment (which is exactly how this catalog went stale
// the first time — see CLAUDE.md's "TM1 Function Catalog" section for the full
// story). Re-run this periodically, or after touching the catalog by hand, or
// whenever a new TM1 version is put in front of the IDE.
//
// Usage:
//   node tools/validate-catalog.js --server <name> [--language ti|rules|both]
//
// How it works (mirrors server.js's /api/admin/validate-ti-functions, which this
// generalizes from "whatever's open in one Catalog Admin tab" to "the whole
// catalog"): for each TI function, build a minimal syntactically-plausible call
// and try to save it as a throwaway process (`}IDE_CatalogTest_<name>`). TM1
// compiles the process body on save, so a real syntax/unknown-function error
// surfaces immediately — no execution needed. The temp process is deleted
// immediately after, whether the save succeeded or failed.
//
// Rules-function validation is NOT automated here (tm1.CheckRules needs a real
// cube + real dimension/element names to test an area rule against, which can't
// be built generically for an arbitrary server) — use Catalog Admin's Rules tab
// for that, which already runs against a cube you pick.
//
// This does NOT auto-fix anything. It reports; a human decides what to change
// in shared/tm1-function-catalog.json (removing a hallucination, adding a
// missing real function found some other way, or narrowing a signature) — the
// same way the corrections in this file were made in the first place, via
// actual live verification, not guessing.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const { makeClient } = require('../core/adapter_registry')
const CATALOG = require('../shared/tm1-function-catalog.json')

function parseArgs(argv) {
    const out = { language: 'ti' }
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--server') out.server = argv[++i]
        else if (argv[i] === '--language') out.language = argv[++i]
    }
    return out
}

// Build a plausible test value for a param tag. Mirrors CatalogAdmin.jsx's
// heuristic (numeric-sounding names get a number, everything else a string) —
// same known limitation: a param that's actually a string despite a
// numeric-sounding tag (or vice versa) can produce a false "invalid" result.
// That's a heuristic-quality issue, not a correctness bug — always read the
// reported error message before concluding a function is fake.
function testValue(tag, index) {
    const bare = tag.replace(/\*$/, '')
    if (bare === 'n') return String(index + 1)
    return `'x${index}'`
}

function buildTestCall(name, entry) {
    const params = entry.params ?? []
    const args = params.map((tag, i) => testValue(tag, i)).join(', ')
    const call = `${name}(${args})`
    if (entry.isStatement) return `${call};`
    // Non-statement (returns a value) — must appear in an assignment to compile
    // as a standalone Prolog line.
    return entry.returnType === 'string' ? `vTestResult = ${call};` : `nTestResult = ${call};`
}

async function main() {
    const { server, language } = parseArgs(process.argv.slice(2))
    if (!server) {
        process.stderr.write('Usage: node tools/validate-catalog.js --server <name> [--language ti|rules|both]\n')
        process.exit(1)
    }

    const entries = Object.entries(CATALOG).filter(([, e]) =>
        (language === 'both' || e.language === language || e.language === 'both')
    )

    if (language === 'rules') {
        process.stderr.write('Rules-function validation is not automated (needs a real cube + real dimension/element names) — use Catalog Admin\'s Rules tab instead.\n')
        process.exit(1)
    }

    const tiEntries = entries.filter(([, e]) => e.language === 'ti' || e.language === 'both')
    console.log(`Validating ${tiEntries.length} TI-usable catalog entries against ${server}...\n`)

    const client = makeClient(server, null)
    const results = { valid: [], invalid: [], error: [] }

    for (const [name, entry] of tiEntries) {
        const procName = `}IDE_CatalogTest_${name}_${Date.now()}`
        const code = buildTestCall(name, entry)
        try {
            await client.post('Processes', {
                Name: procName,
                PrologProcedure: code,
                MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
                Parameters: [], Variables: [],
            })
            results.valid.push(name)
            try { await client.delete(`Processes('${encodeURIComponent(procName)}')`) } catch { /* best effort */ }
        } catch (e) {
            const message = e.response?.data?.error?.message ?? e.message ?? ''
            const looksLikeUnknownName = /syntax|equal sign|undefined/i.test(message)
            ;(looksLikeUnknownName ? results.invalid : results.error).push({ name, code, message })
            try { await client.delete(`Processes('${encodeURIComponent(procName)}')`) } catch { /* may not exist */ }
        }
    }

    console.log(`✓ ${results.valid.length} accepted`)
    if (results.invalid.length) {
        console.log(`\n✗ ${results.invalid.length} REJECTED (name or arg shape wrong — investigate before trusting):`)
        for (const r of results.invalid) console.log(`  ${r.name}  [${r.code}]\n    ${r.message}`)
    }
    if (results.error.length) {
        console.log(`\n? ${results.error.length} error (inconclusive — permissions/network/etc, not necessarily a bad catalog entry):`)
        for (const r of results.error) console.log(`  ${r.name}\n    ${r.message}`)
    }
    console.log('\nNothing here was auto-fixed. Update shared/tm1-function-catalog.json by hand based on what the errors above actually say.')

    process.exit(results.invalid.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
