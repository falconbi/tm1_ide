'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TM1Client } = require('../core/tm1_client')

// TM1 commits a new client only at the end of the procedure that added it, so a
// password set in the same Prolog never applies — the user ends up with no
// password. provisionUser must add the client and set its password in separate runs.
test('provisionUser adds the client and sets its password in separate TI runs', async () => {
  const c = new TM1Client('S', {})
  const runs = []
  c._runTI = async (code) => { runs.push(code) }
  c.addClientToGroup = async () => {}
  await c.provisionUser('east_mgr', 'pw', ['Lens East'])
  assert.equal(runs.length, 2)
  assert.match(runs[0], /^AddClient\('east_mgr'\);$/)
  assert.match(runs[1], /^AssignClientPassword\('east_mgr', 'pw'\);$/)
})
