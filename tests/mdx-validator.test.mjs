import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateMDX } from '../client/src/lib/mdx-validator.js'
import { MDX_FUNCTIONS_FLAT } from '../client/src/lib/tm1-mdx-catalog.js'

test('MDX validator accepts a known catalog function', () => {
  assert.ok(MDX_FUNCTIONS_FLAT.length > 0)
  assert.deepEqual(validateMDX('SELECT TM1SUBSETALL([Region]) ON ROWS FROM [Cube]'), [])
})

test('MDX validator still warns about an unknown function', () => {
  const issues = validateMDX('SELECT NotARealFunction([Region]) ON ROWS FROM [Cube]')
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /Unknown MDX function/)
})
