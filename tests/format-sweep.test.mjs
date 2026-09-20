import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyTm1Format } from '../client/src/lib/tm1-rule-parser.js'

// Scan the baseline for strings that look like TM1/Excel number formats and
// verify applyTm1Format never throws and returns a string for common values.
const FORMAT_RX = /^[#0@%.,( )\[\]a-zA-Z'\-]+[#0.,%]+[a-zA-Z'@]?$/i

function looksLikeFormat(s) {
  if (typeof s !== 'string' || !s || s.length > 40) return false
  if (!/^[^'"{}<>;]*$/.test(s)) return false
  return FORMAT_RX.test(s) && /[#0]/.test(s) || s.startsWith('@')
}

let formats = []
try {
  const d = JSON.parse(readFileSync('.tm1baseline/TM1_Test_DEV.json', 'utf8'))
  const seen = new Set()
  const walk = (o) => {
    if (o == null) return
    if (Array.isArray(o)) { o.forEach(walk); return }
    if (typeof o === 'object') { for (const v of Object.values(o)) walk(v); return }
    if (typeof o === 'string' && looksLikeFormat(o) && !seen.has(o)) { seen.add(o); formats.push(o) }
  }
  walk(d)
} catch { /* baseline missing — run with an empty set */ }

const VALUES = [0, 1, 1234.5, -1234.5, 0.5, 9999999, null]

test(`applyTm1Format over ${formats.length} format strings found in the baseline`, () => {
  for (const fmt of formats) {
    for (const v of VALUES) {
      let out
      try { out = applyTm1Format(v, fmt) }
      catch (e) { assert.fail(`applyTm1Format(${v}, ${JSON.stringify(fmt)}) threw: ${e.message}`) }
      assert.equal(typeof out, 'string', `expected string for ${JSON.stringify(fmt)} @ ${v}`)
    }
  }
  // The known regressions must still hold:
  assert.equal(applyTm1Format(0, '1,000'), '0')
  assert.equal(applyTm1Format(1234.5, '1,000'), '1,235')
})