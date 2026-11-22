'use strict'

// One-off orchestration for the 500-position rebuild on the lab:
//   wait for the trim to finish → reseed at 500 → recalculate (direct, no client
//   timeout) → assertions → remove the seed processes.
//
//   node tools/rebuild-500.cjs TM1_Test_DEV
//
// Not part of the product; it exists so a long rebuild can run unattended without
// a chat turn waiting on it.

const { execFileSync } = require('child_process')
const { makeClient } = require('../core/adapter-registry')

const server = process.argv[2]
if (!server) { console.error('server required'); process.exit(1) }
const GEN = /-\d{4,}$/
const sleep = ms => new Promise(r => setTimeout(r, ms))

const c = makeClient(server, null)

async function generatedCount() {
    const els = await c.getElements('WFP Position')
    return els.filter(e => e.Type !== 'C' && GEN.test(e.Name)).length
}

;(async () => {
    // 1) wait for the trim
    const t0 = Date.now()
    for (;;) {
        const n = await generatedCount().catch(() => -1)
        console.log('generated positions left:', n)
        if (n === 0) break
        if (Date.now() - t0 > 30 * 60 * 1000) { console.log('trim did not finish in 30 min'); process.exit(2) }
        await sleep(15000)
    }

    // 2) reseed at 500
    console.log('--- reseeding at 500')
    execFileSync('node', ['tools/reseed-workforce.cjs', server, '--run'], {
        cwd: '/home/jdlove/apps/tm1_ide',
        env: { ...process.env, RESEED_POSITIONS: '500' },
        stdio: 'inherit',
    })

    // 3) recalculate — direct REST, no client timeout
    console.log('--- recalculating')
    const r = await c.post("Processes('WFP Recalculate If Needed')/tm1.ExecuteWithReturn", {
        Parameters: [{ Name: 'pForce', Value: '1' }],
    }, { timeout: 0 })
    console.log('recalc:', r?.ProcessExecuteStatusCode ?? 'done')

    // 4) assertions via the IDE
    console.log('--- assertions')
    const token = require('fs').readFileSync('/tmp/tok.env', 'utf8').trim().split('=')[1]
    const res = await fetch(`http://localhost:8083/api/assertions/run?server=${server}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ide-token': token }, body: '{}',
    })
    const d = await res.json()
    console.log('assertions:', d.passed, '/', d.total, '| failed', (d.failed ?? []).length)
    for (const f of (d.failed ?? []).slice(0, 12)) console.log(' -', String(f.description ?? '').slice(0, 85), '| exp', f.expected, 'act', f.actual)

    // 5) remove the seeds again
    console.log('--- cleanup')
    execFileSync('node', ['tools/reseed-workforce.cjs', server, '--cleanup'], { cwd: '/home/jdlove/apps/tm1_ide', stdio: 'inherit' })
    console.log('done')
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
