import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findFunctionCalls } from '../client/src/lib/ti-call-scanner.js'

test('commented-out calls are not scanned', () => {
  assert.deepEqual(findFunctionCalls('# CellPutN(1);'), [])
  assert.deepEqual(findFunctionCalls('# Region\n# NotAFunction(1, 2)\n'), [])
})

test('calls after a comment on the same line are still found', () => {
  const calls = findFunctionCalls('# note\nCellPutN(1, 2);')
  assert.deepEqual(calls.map(c => [c.fn, c.argCount, c.line]), [['CellPutN', 2, 2]])
})

test('an apostrophe in a comment does not break the scan', () => {
  const calls = findFunctionCalls("# the people's FTE\nCellPutN(1);")
  assert.deepEqual(calls.map(c => c.fn), ['CellPutN'])
})
