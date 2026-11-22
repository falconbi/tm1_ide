'use strict'

// Reduce the generated roster on a Workforce model to what a smaller pCount will
// regenerate. Generate Positions only ADDS ("a larger pCount only adds people"),
// so lowering pCount leaves the old positions behind; they have to go first.
//
// Deletes only Numeric elements whose code ends in -<4+ digits> — the generator's
// shape (ENG-1001, CS-1003, TBH-SALES-0001). Hand-typed codes (ENG-002) and
// consolidations are left alone.
//
//   node tools/trim-generated-positions.cjs TM1_Test_DEV          # report only
//   node tools/trim-generated-positions.cjs TM1_Test_DEV --delete

const { makeClient } = require('../core/adapter-registry')

const server = process.argv[2]
const doDelete = process.argv.includes('--delete')
if (!server) { console.error('server required'); process.exit(1) }

const GEN = /-\d{4,}$/

;(async () => {
    const c = makeClient(server, null)
    const els = await c.getElements('WFP Position')   // returns the array, not { value }
    const targets = els.filter(e => e.Type !== 'C' && GEN.test(e.Name)).map(e => e.Name)
    console.log(`${els.length} elements · ${targets.length} generated · ${els.length - targets.length} kept`)
    if (!doDelete) { console.log('report only — pass --delete to remove them'); return }

    let done = 0, failed = 0
    const queue = [...targets]
    const worker = async () => {
        while (queue.length) {
            const name = queue.shift()
            try { await c.deleteElement('WFP Position', name); done++ }
            catch { failed++ }
            if ((done + failed) % 200 === 0) console.log('  ...', done + failed, 'of', targets.length, `(${failed} failed)`)
        }
    }
    await Promise.all(Array.from({ length: 8 }, worker))
    console.log(`deleted ${done}, failed ${failed}`)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
