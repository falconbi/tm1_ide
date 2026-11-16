import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRulesFunctionPattern } from '../client/src/lib/rules-highlight.js'

test('a function added by catalog overrides is highlighted', () => {
  const base = { DB: {}, ATTRS: {}, STR: {} }
  const pattern = buildRulesFunctionPattern({ ...base, MYCUSTOMFN: {} })
  assert.ok(pattern.test('MYCUSTOMFN'))
  assert.ok(pattern.test("DB('Cube', !Dim)"))
})
