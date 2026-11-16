import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lintRules } from '../core/rules-lint.js'
import { lintTI } from '../core/ti-lint.js'

test('STR is accepted in TI because the catalog says both', () => {
  const result = lintTI({ prolog: 'STR(1, 10, 2);' })
  assert.deepEqual(result.errors, [])
})

test('unknown functions are warnings, not errors, on both paths', () => {
  const rules = lintRules("['X'] = N: NotAFunction();")
  assert.equal(rules.errors.length, 0)
  assert.ok(rules.warnings.some(w => /Unknown function/.test(w.message)))

  const ti = lintTI({ prolog: 'NotAFunction();' })
  assert.equal(ti.errors.length, 0)
  assert.ok(ti.warnings.some(w => /Unknown function/.test(w.message)))
})

test('commented-out calls produce no TI issue', () => {
  const result = lintTI({ prolog: '# CellPutN(1);' })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
})
