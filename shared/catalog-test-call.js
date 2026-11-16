// Builds the throwaway TI statement used to check one catalog entry against a
// live server. Client code imports this ESM module; tools/lib/catalog-test-call.cjs
// is the CommonJS copy used by tools/validate-catalog.js. tests/catalog-test-call.test.mjs
// runs both against the same table.
function testValue(tag, index) {
  const bare = tag.replace(/[*?]$/, '')
  if (bare === 'n') return String(index + 1)
  return `'x${index}'`
}

export function buildTestCall(name, entry) {
  const params = entry.params ?? []
  const args = params.map((tag, i) => testValue(tag, i)).join(', ')
  const call = `${name}(${args})`
  if (entry.isStatement) return `${call};`
  return entry.returnType === 'string' ? `vTestResult = ${call};` : `nTestResult = ${call};`
}
