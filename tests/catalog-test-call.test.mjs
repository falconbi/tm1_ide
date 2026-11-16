import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTestCall as buildClient } from '../shared/catalog-test-call.js'
import { buildTestCall as buildTool } from '../tools/lib/catalog-test-call.cjs'

const TABLE = [
  ['StatementNoArgs', { isStatement: true, returnType: 'void', params: [] }, 'StatementNoArgs();'],
  ['StatementNumeric', { isStatement: true, returnType: 'void', params: ['cubename', 'n'] }, "StatementNumeric('x0', 2);"],
  ['ValueString', { isStatement: false, returnType: 'string', params: ['dimname'] }, "vTestResult = ValueString('x0');"],
  ['ValueNumeric', { isStatement: false, returnType: 'numeric', params: ['n'] }, 'nTestResult = ValueNumeric(1);'],
  ['Optional', { isStatement: false, returnType: 'numeric', params: ['d', 's?'] }, "nTestResult = Optional('x0', 'x1');"],
]

for (const [name, entry, expected] of TABLE) {
  test(`${name}: client and CLI build the same test call`, () => {
    assert.equal(buildClient(name, entry), expected)
    assert.equal(buildTool(name, entry), expected)
  })
}
