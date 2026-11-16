import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ALL_SNIPPETS } from '../client/src/lib/tm1-snippets-data.js'
import { IBM_DEFAULTS, IBM_TYPES, IBM_KEYWORDS } from '../client/src/lib/formatters/naming.js'

const CATALOG = JSON.parse(readFileSync(new URL('../shared/tm1-function-catalog.json', import.meta.url), 'utf8'))
const CATALOG_NAMES = new Set(Object.keys(CATALOG).map(name => name.toUpperCase()))
const CONTROL = new Set(['IF', 'WHILE', 'FOR', 'NEXT', 'ELSE', 'ELSEIF', 'END', 'ENDIF'])

test('every function called by a snippet exists in the catalog', () => {
  const bad = []
  for (const snippet of ALL_SNIPPETS) {
    const code = snippet.code.replace(/\$\{[^}]*\}/g, '')
    for (const match of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const upper = match[1].toUpperCase()
      if (!CATALOG_NAMES.has(upper) && !CONTROL.has(upper)) bad.push(`${snippet.trigger}: ${match[1]}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('naming defaults are catalog names or an explicit keyword/legacy exception', () => {
  const bad = Object.keys(IBM_DEFAULTS).filter(name =>
    !CATALOG_NAMES.has(name.toUpperCase()) && !IBM_KEYWORDS.has(name)
  )
  assert.deepEqual(bad, [])
})

test('naming type labels agree with the catalog language', () => {
  const bad = []
  for (const [name, type] of Object.entries(IBM_TYPES)) {
    const entry = CATALOG[name.toUpperCase()]
    if (!entry || entry.language === 'both') continue
    if (entry.language !== type) bad.push(`${name}: naming=${type} catalog=${entry.language}`)
  }
  assert.deepEqual(bad, [])
})
