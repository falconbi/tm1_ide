'use strict'

// Re-create the nine Workforce setup processes from docs/models/workforce-setup
// and run them in the documented order on a target. They are removed again by
// --cleanup. Nothing is written to a change set: no change set is open, and these
// are one-off seeds, not model changes to ship.
//
//   node tools/reseed-workforce.cjs TM1_Test_DEV --run
//   node tools/reseed-workforce.cjs TM1_Test_DEV --cleanup

const fs = require('fs')
const path = require('path')
const { makeClient } = require('../core/adapter-registry')

const DIR = path.join(__dirname, '..', 'docs', 'models', 'workforce-setup')
const server = process.argv[2]
const mode = process.argv[3] ?? '--run'
if (!server) { console.error('server required'); process.exit(1) }

const ORDER = [
    'seed-tax-bands.json',
    'seed-fx-rates.json',
    'seed-pay-rates.json',
    'seed-assumptions.json',
    null,                                  // WFP Load Positions stays on the server
    'generate-positions.json',
    'seed-hiring-plan.json',
    'generate-hiring-plan.json',           // pStage=feb
    'generate-hiring-plan.json',           // pStage=now
    'seed-assignments.json',
    'seed-workforce-input.json',
]
// pCount is settable so a smaller, faster model can be rebuilt deliberately:
//   RESEED_POSITIONS=500 node tools/reseed-workforce.cjs TM1_Test_DEV --run
const POSITIONS = Number(process.env.RESEED_POSITIONS || 3000)
const PARAMS = {
    'WFP Generate Positions': { pCount: POSITIONS, pSeed: 20261020 },
    'WFP Generate Hiring Plan': { pStage: 'feb' },
    'WFP Seed Assignments': { pClear: 1 },
}

const body = (d) => ({
    Name: d.Name,
    PrologProcedure: d.PrologProcedure ?? '',
    MetadataProcedure: d.MetadataProcedure ?? '',
    DataProcedure: d.DataProcedure ?? '',
    EpilogProcedure: d.EpilogueProcedure ?? d.EpilogProcedure ?? '',
    DataSource: d.DataSource ?? { Type: 'None' },
    Parameters: d.Parameters ?? [],
    Variables: d.Variables ?? [],
})

const files = ORDER.filter(Boolean)
const defs = new Map(files.map(f => [f, JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))]))

async function exists(c, name) {
    try { await c.get(`Processes('${name.replace(/'/g, "''")}')`); return true } catch { return false }
}

async function install(c) {
    for (const f of files) {
        const d = defs.get(f)
        const b = body(d)
        if (await exists(c, d.Name)) {
            await c.patch(`Processes('${d.Name.replace(/'/g, "''")}')`, b)
            console.log('updated', d.Name)
        } else {
            await c.post('Processes', b)
            console.log('created', d.Name)
        }
    }
}

async function stillRunning(c, name) {
    try {
        const t = await c.get('Threads', { '$select': 'State,ObjectName' })
        return (t.value ?? []).some(x => String(x.ObjectName ?? '') === name && String(x.State ?? '') !== 'Idle')
    } catch { return false }
}

async function runOne(c, f) {
    const d = defs.get(f)
    const params = PARAMS[d.Name] ?? {}
    // pStage differs on the second pass; the caller overrides via overrideParams.
    const p = runOne.override && d.Name === 'WFP Generate Hiring Plan' ? { ...params, ...runOne.override } : params
    runOne.override = null
    const paramArray = Object.entries(p).map(([Name, Value]) => ({ Name, Value: String(Value) }))
    console.log('run', d.Name, JSON.stringify(p))
    try {
        const r = await c.post(`Processes('${d.Name.replace(/'/g, "''")}')/tm1.ExecuteWithReturn?$expand=ErrorLogFile`, { Parameters: paramArray }, { timeout: 120000 })
        const status = r?.ProcessExecuteStatusCode
        console.log('  ->', status ?? 'completed')
    } catch (e) {
        // A timeout means it is still running server-side; wait for it below.
        if (!/timeout/i.test(e.message)) throw e
        console.log('  -> still running after the client timeout; waiting')
    }
    const started = Date.now()
    while (await stillRunning(c, d.Name)) {
        if (Date.now() - started > 20 * 60 * 1000) throw new Error(`${d.Name} still running after 20 minutes`)
        await new Promise(r => setTimeout(r, 3000))
    }
    console.log('  -> finished')
}

;(async () => {
    const c = makeClient(server, null)
    if (mode === '--cleanup') {
        for (const f of files) {
            const d = defs.get(f)
            try { await c.delete(`Processes('${d.Name.replace(/'/g, "''")}')`); console.log('deleted', d.Name) } catch { /* gone */ }
        }
        return
    }
    await install(c)
    let hiringPass = 0
    for (const f of ORDER) {
        if (!f) continue
        const d = defs.get(f)
        if (d.Name === 'WFP Generate Hiring Plan') {
            hiringPass++
            runOne.override = hiringPass === 1 ? { pStage: 'feb' } : { pStage: 'now' }
        }
        await runOne(c, f)
    }
    console.log('done')
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
