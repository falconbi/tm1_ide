import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isGuardStatement, formatStatement, fmtTraceValue } from '../client/src/lib/view-editor/trace-format.js'

test('recognises the non-calc guard and leaves a real statement alone', () => {
  const guard = "IF(ELPAR('Version', 'Actual') @= 'Non-Calculating', STET, CONTINUE);"
  assert.equal(isGuardStatement(guard), true)
  assert.equal(isGuardStatement("['100'] = N: 1;"), false)
})

test('formats a statement without throwing', () => {
  assert.equal(typeof formatStatement("['100'] = N: 1;"), 'string')
  assert.equal(fmtTraceValue(10833.33333), '10,833.33')
})
