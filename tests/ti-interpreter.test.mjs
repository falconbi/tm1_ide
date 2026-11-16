import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanVariables } from '../client/src/lib/ti-interpreter.js'

test('scanVariables reports parameters, source variables and assignments', () => {
  const vars = scanVariables(
    { PrologProcedure: "vName = 'x';\nnCount = 1;", DataProcedure: '', EpilogProcedure: '', MetadataProcedure: '' },
    [{ Name: 'pYear', Type: 1 }],
    [{ Name: 'vSource', Type: 2 }],
  )
  const byName = Object.fromEntries(vars.map(v => [v.name, v]))
  assert.equal(byName.pYear.type, 'number')
  assert.equal(byName.vSource.type, 'string')
  assert.equal(byName.vName.type, 'string')
  assert.equal(byName.nCount.type, 'number')
})
