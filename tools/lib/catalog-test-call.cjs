'use strict'

// CommonJS copy of shared/catalog-test-call.js for the CLI. The shared ESM
// version is used by CatalogAdmin; tests/catalog-test-call.test.mjs compares
// both so the two cannot drift.
function testValue(tag, index) {
  const bare = tag.replace(/[*?]$/, '')
  if (bare === 'n') return String(index + 1)
  return `'x${index}'`
}

function buildTestCall(name, entry) {
  const params = entry.params ?? []
  const args = params.map((tag, i) => testValue(tag, i)).join(', ')
  const call = `${name}(${args})`
  if (entry.isStatement) return `${call};`
  return entry.returnType === 'string' ? `vTestResult = ${call};` : `nTestResult = ${call};`
}

module.exports = { buildTestCall }
