import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRules } from '../client/src/lib/formatters/rules-formatter.js'
import { DEFAULT_SETTINGS } from '../client/src/lib/formatters/settings.js'

test('structured formatter preserves explicit grouping', { todo: 'fixed in step 2' }, () => {
  const output = formatRules(
    "['X'] = N: (1 + 2) * 3;",
    { ...DEFAULT_SETTINGS.rules, expressionFormatter: 'tm1-structured' },
    {},
  )
  assert.match(output, /\(1 \+ 2\)\s*\*\s*3/)
})
