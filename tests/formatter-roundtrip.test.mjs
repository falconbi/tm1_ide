import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRules } from '../client/src/lib/formatters/rules-formatter.js'
import { tokenize } from '../client/src/lib/formatters/tokenizer.js'
import { DEFAULT_SETTINGS } from '../client/src/lib/formatters/settings.js'
import { PRESETS } from '../client/src/lib/formatters/presets.js'

// Real-shaped WFP rules: brackets, nested groups, unary minus, integer division,
// @= comparisons, string joins and IF arms that contain bracketed expressions.
const RULES = [
  "['X'] = N: (1 + 2) * 3;",
  "['X'] = N: (['A'] - ['B']) / (['C'] + 1);",
  "['X'] = N: -(['A'] + ['B']);",
  "['X'] = N: 10 \\ (2 + 3);",
  "['X'] = N: IF(['A'] > 0, (['B'] + 1) * 2, CONTINUE);",
  "['X'] = N: IF((['A'] + ['B']) > 0, ['C'], 0);",
  "['X'] = S: 'A' & ('B' | 'C');",
  "['X'] = N: ['A'] @= 'Contractor';",
  "['X'] = N: (['A'] @= 'X') * 2;",
  "['X'] = C: (['A'] + ['B']) * 2;",
  "['X'] = N: DB('Cube', (['A'] + ['B']), !Dim, 'Measure');",
  "['X'] = N: ROUND((['A'] / (['B'] + 1)) * 100, 2);",
  "['X'] = N: (1 - (2 - 3)) * 4;",
  "['X'] = N: ((['A'] + 1) * (['B'] - 2)) / 3;",
  "['X'] = N: IF((['A'] = 0) & (['B'] = 0), 0, ['C']);",
  "['X'] = S: 'Value (net)';",
  "['X'] = N: IF((['A'] + ['B']) > 0, IF(['C'] = 0, 1, 2), 3);",
  "['X'] = N: (['A'] * (['B'] + ['C'])) - (['D'] / (['E'] - 1));",
  "['X'] = N: DB('Cost Cube', !Region, !Product, (['Period'] + 1), 'USD');",
  "['X'] = N: (['A'] + ['B']) * (['C'] - ['D']) / (['E'] + 1);",
  "['Sales'] => DB('Sales Cube', !Region, !Product, !Period, 'Actual', 'USD', 'Net');",
]

function significant(text) {
  return text
    .split('\n')
    .flatMap(line => tokenize(line))
    .filter(t => t.type !== 'whitespace' && t.type !== 'comment')
    .map(t => `${t.type}:${t.value}`)
}

test('every formatter preset preserves the token stream', () => {
  const formatters = [null, 'tm1-verbose', 'tm1-structured']
  for (const rule of RULES) {
    const expected = significant(rule)
    for (const [presetName, preset] of Object.entries(PRESETS)) {
      for (const expressionFormatter of formatters) {
        const output = formatRules(rule, { ...preset.rules, expressionFormatter }, {})
        assert.deepEqual(
          significant(output),
          expected,
          `${presetName}/${expressionFormatter ?? 'line'} changed ${rule}\n→ ${output}`,
        )
      }
    }
  }
})

test('structured formatter preserves explicit grouping', () => {
  const output = formatRules(
    "['X'] = N: (1 + 2) * 3;",
    { ...DEFAULT_SETTINGS.rules, expressionFormatter: 'tm1-structured' },
    {},
  )
  assert.match(output, /\(1 \+ 2\)\s*\*\s*3/)
})

test('verbose output can be formatted back to structured', () => {
  const rule = "['X'] = N: DB('Cube', !Region, !Product, 'Actual', 'USD', 'Net');"
  const verbose = formatRules(rule, { ...PRESETS['tm1-verbose'].rules, expressionFormatter: 'tm1-verbose' }, {})
  assert.match(verbose, /'Actual',\n/)
  const structured = formatRules(verbose, { ...PRESETS['tm1-structured'].rules, expressionFormatter: 'tm1-structured' }, {})
  assert.match(structured, /'Actual', 'USD', 'Net'\)/)
})
