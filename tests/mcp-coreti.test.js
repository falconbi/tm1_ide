'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup, fakeTm1 } = require('./_mcp-harness')

test('copy_version runs the installed hidden core process, not a raw process name', async () => {
  const runs = []
  const builder = fakeTm1('builder', {
    async getProcess(name) {
      assert.equal(name, '}IDE.Version.Copy')
      return { Name: name }
    },
    async executeProcess(name, params) {
      runs.push([name, params])
      return { ProcessExecuteStatusCode: 'CompletedSuccessfully' }
    },
  })
  const h = setup({ mode: 'build', builder })
  const r = await h.call('copy_version', {
    pSource: 'Forecast', pTarget: 'Budget Working', pMode: 'new', pType: 'calculating',
    pVersionDim: 'WFP Version', pInputCubes: 'WFP Assumptions', pExcludeCubes: 'WFP Control',
  })
  assert.equal(r.isError, false, r.text)
  assert.equal(r.data.status, 'CompletedSuccessfully')
  assert.deepEqual(runs.map(x => x[0]), ['}IDE.Version.Copy'])
  assert.equal(runs[0][1].pSource, 'Forecast')
  assert.equal(runs[0][1].pTarget, 'Budget Working')
  assert.equal(runs[0][1].pInputCubes, 'WFP Assumptions')
  assert.equal(runs[0][1].pCube, undefined, 'the internal cube parameter is never exposed')
})

test('copy_version refuses when the core process is not installed', async () => {
  const builder = fakeTm1('builder', { async getProcess() { throw Object.assign(new Error('missing'), { response: { status: 404 } }) } })
  const h = setup({ mode: 'build', builder })
  const r = await h.call('copy_version', { pSource: 'Budget', pTarget: 'X', pMode: 'new', pType: 'static' })
  assert.match(r.data.error, /not installed/)
})
