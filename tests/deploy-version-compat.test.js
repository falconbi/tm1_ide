'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

// A fake target server: reports the given version, answers everything else emptily.
let targetVersion = null
const fakeClient = new Proxy({}, {
  get: (_, prop) => prop === 'getProductVersion'
    ? async () => { if (targetVersion == null) throw new Error('unreachable'); return targetVersion }
    : async () => [],
})
require.cache[require.resolve('../tools/tm1deploy/src/client')] = {
  exports: { makeClient: () => fakeClient },
}
const { analyzeRisk } = require('../tools/tm1deploy/src/risk')

function makePackage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1pkg-'))
  fs.writeFileSync(path.join(dir, 'proc.json'), JSON.stringify({
    PrologProcedure:   "# CubeSaveData('ignored in a comment');\nCubeSaveData('Sales');\nsUrl = 'ExecuteHttpRequest(in a string)';",
    MetaDataProcedure: '',
    DataProcedure:     "ExecuteHttpRequest('GET', 'https://example.com');",
    EpilogProcedure:   '',
  }))
  fs.writeFileSync(path.join(dir, 'sales.rules'), "SKIPCHECK;\n['Total'] = N: HierarchyCount('Region');\n")
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ objects: [
    { type: 'process', name: 'Load', file: 'proc.json' },
    { type: 'rules',   name: 'Sales', file: 'sales.rules' },
  ] }))
  return dir
}

const versionFindings = r => r.all.filter(x => x.check === 'version').map(x => `${x.level} ${x.name}: ${x.message}`)

test('V12 target flags V11-only functions, ignoring comments and strings', async () => {
  targetVersion = '12.4.0'
  const out = versionFindings(await analyzeRisk(makePackage(), 'DEV12', null))
  assert.deepEqual(out, ['WARNING Load: CubeSaveData() is V11-only — removed in TM1 Database 12, but the target is V12 (Prolog line 2)'])
})

test('V11 target flags V12-only functions in TI and rules', async () => {
  targetVersion = '11.8.01300.1'
  const out = versionFindings(await analyzeRisk(makePackage(), 'PROD11', null)).sort()
  assert.deepEqual(out, [
    'WARNING Load: ExecuteHttpRequest() is V12-only — not available on V11, but the target is V11 (Data line 1)',
    'WARNING Sales: HierarchyCount() is V12-only — not available on V11, but the target is V11 (line 2)',
  ])
})

test('unknown target version says so instead of guessing', async () => {
  targetVersion = null
  const out = versionFindings(await analyzeRisk(makePackage(), 'X', null))
  assert.deepEqual(out, ['INFO X: Target version unknown — V11/V12-only functions not checked'])
})
