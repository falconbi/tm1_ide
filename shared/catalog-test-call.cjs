'use strict'

// Builds the throwaway TI statement used to check one catalog entry against a
// live server. This CommonJS file is the one implementation: tools/validate-catalog.js
// requires it directly, and shared/catalog-test-call.js re-exports it for Catalog Admin.
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
