#!/usr/bin/env node
'use strict'
// One-off migration of local governance records into the model, per server.
//   node tools/migrate-governance.js TM1_Test_DEV [TM1_Test_PROD ...]
// After migration the model is the source of truth; the local files stay as the
// read fallback until proven, then retire. Setting a marker is what switches
// reads to the model — run only when you are ready for that server to be
// model-owned.

require(require.resolve('dotenv', { paths: [require('path').join(__dirname, '..', '.env')] })).config({ path: require('path').join(__dirname, '..', '.env') })
const cl = require('../core/change_log')
const store = require('../core/model-store')
const gitApprovals = require('../core/git-approvals')
const gitState = require('../core/git-state')
const csm = require('../core/change-set-model')

async function main() {
    const servers = process.argv.slice(2)
    if (!servers.length) { console.error('usage: node tools/migrate-governance.js <server> [...]'); process.exit(1) }

    for (const server of servers) {
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
        store.markMigrated(server, 'changeSets')
        console.log(`  change sets: ${closed} closed → Applications/Governance/ChangeSets/ (light audit)`)

        // approvals for this target
        const local = gitApprovals.readLocal()
        const mine = local.filter(a => a.target === server)
        await store.writeDoc(server, 'approvals', 'approvals.json', mine)
        store.markMigrated(server, 'approvals')
        console.log(`  approvals: ${mine.length} → Applications/Governance/Deployments/approvals.json`)

        // deploy state (this server's last received)
        const state = gitState.load()[server] ?? null
        await store.writeDoc(server, 'deployState', 'state.json', state ? { [server]: state } : {})
        store.markMigrated(server, 'deployState')
        console.log(`  deploy state: ${state ? 'yes' : 'none'} → Applications/Governance/Deployments/state.json`)

        console.log(`  ✔ ${server} is now model-owned for changeSets/approvals/deployState`)
    }
}
main().catch(e => { console.error('MIGRATION FAILED:', e.message); process.exit(1) })