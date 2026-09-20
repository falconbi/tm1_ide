import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyTm1Format,
  stripTm1TypePrefix,
  rhsOf,
  splitTopLevelOps,
  splitComparison,
  matchingCloseParen,
  splitArgs,
  resolveArg,
} from '../client/src/lib/tm1-rule-parser.js'

// ── applyTm1Format ────────────────────────────────────────────────────────────

test('format "1,000" groups and has zero decimals', () => {
  assert.equal(applyTm1Format(0, '1,000'), '0')
  assert.equal(applyTm1Format(1234.5, '1,000'), '1,235')
})

test('format "0.00" keeps two decimals', () => {
  assert.equal(applyTm1Format(0, '0.00'), '0.00')
  assert.equal(applyTm1Format(1234.5, '0.00'), '1234.50')
})

test('format "0" no decimals', () => {
  assert.equal(applyTm1Format(0, '0'), '0')
  assert.equal(applyTm1Format(1234.5, '0'), '1235')
})

test('literal prefix is preserved', () => {
  assert.equal(applyTm1Format(5, '£#,##0'), '£5')
})

test('percent format', () => {
  assert.equal(applyTm1Format(0.5, '0%'), '50%')
})

test('negative numbers', () => {
  assert.equal(applyTm1Format(-1234.5, '#,##0'), '-1,235')
  assert.equal(applyTm1Format(-5, '(0.00)'), '(5.00)')
})

test('General returns the value as string', () => {
  assert.equal(applyTm1Format(12.5, 'General'), '12.5')
})

test('colour @ format returns value as string', () => {
  assert.equal(applyTm1Format(12.5, '@red'), '12.5')
})

test('single-letter type prefix is stripped', () => {
  assert.equal(applyTm1Format(0, 'c:1,000'), '0')
})

test('stripTm1TypePrefix', () => {
  assert.equal(stripTm1TypePrefix('c:12345'), '12345')
  assert.equal(stripTm1TypePrefix('12345'), '12345')
})

// ── rhsOf ─────────────────────────────────────────────────────────────────────

test('rhsOf strips qualifier and trailing semicolon', () => {
  const s = "['Employer Pension'] = N: IF(ATTRS('WFP Position', !WFP Position, 'Employment Type') @= 'Contractor', 0, ['Base']);"
  assert.equal(rhsOf(s), "IF(ATTRS('WFP Position', !WFP Position, 'Employment Type') @= 'Contractor', 0, ['Base'])")
})

test('rhsOf strips C: qualifier', () => {
  assert.equal(rhsOf("['x'] = C: DB('cube', 'a');"), "DB('cube', 'a')")
})

// ── splitTopLevelOps ──────────────────────────────────────────────────────────

test('splits top-level arithmetic', () => {
  const parts = splitTopLevelOps("['Base'] * DB('WFP Pay Rates', !P, !V, 'Pension Pct')")
  assert.deepEqual(parts.map(p => p.type), ['operand', 'op', 'operand'])
  assert.equal(parts[0].value, "['Base']")
  assert.equal(parts[1].value, '*')
  assert.ok(parts[2].value.startsWith("DB('WFP Pay Rates'"))
})

test('returns a single operand unchanged when no operator at depth 0', () => {
  const parts = splitTopLevelOps("ELPAR('WFP Version', !WFP Version, 1) @= 'Non-Calculating'")
  assert.equal(parts.length, 1)
  assert.equal(parts[0].value, "ELPAR('WFP Version', !WFP Version, 1) @= 'Non-Calculating'")
})

test('does not split on operators inside parentheses', () => {
  const parts = splitTopLevelOps("MAX(0, a - b)")
  assert.equal(parts.length, 1)
})

// ── splitComparison ───────────────────────────────────────────────────────────

test('splits @= comparison', () => {
  const r = splitComparison("ATTRS('WFP Position', !WFP Position, 'Employment Type') @= 'Contractor'")
  assert.equal(r[1], '@=')
  assert.ok(r[0].startsWith("ATTRS('WFP Position'"))
  assert.equal(r[2], "'Contractor'")
})

test('returns null when no comparison', () => {
  assert.equal(splitComparison("['Base'] * DB('x')"), null)
})

// ── matchingCloseParen / splitArgs ────────────────────────────────────────────

test('matchingCloseParen finds the matching close, skipping nested', () => {
  const s = "IF(MAX(0, DB('a', 'b')), 1, 2)"
  const open = s.indexOf('(')
  const close = matchingCloseParen(s, open)
  assert.equal(s[close], ')')
  assert.equal(s.slice(open, close + 1), "(MAX(0, DB('a', 'b')), 1, 2)")
})

test('splitArgs splits top-level commas only', () => {
  const args = splitArgs("'WFP Pay Rates', !WFP Period, !WFP Version, 'Pension Pct'")
  assert.equal(args.length, 4)
  assert.equal(args[0], "'WFP Pay Rates'")
})

test('splitArgs respects parens and quotes', () => {
  const args = splitArgs("ATTRS('A', 'B') = 1, 0, DB('c', 'd')")
  assert.equal(args.length, 3)
  assert.equal(args[0], "ATTRS('A', 'B') = 1")
})

// ── resolveArg ────────────────────────────────────────────────────────────────

test('resolveArg resolves quoted literal, !Dim ref and falls back', () => {
  const pairs = [
    { dim: 'WFP Position', element: 'ENG-001' },
    { dim: 'WFP Period', element: '2026-06' },
  ]
  assert.equal(resolveArg("'ENG-001'", pairs), 'ENG-001')
  assert.equal(resolveArg('!WFP Position', pairs), 'ENG-001')
  assert.equal(resolveArg('!WFP Version', pairs), '!WFP Version') // no match → unchanged
})