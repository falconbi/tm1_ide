// Derives a {min, max} argument-count range from a canonical catalog entry's
// params array. The client validators import this ESM module; core/catalog-arity.js
// is the CommonJS copy used by the server lints. tests/catalog-arity.test.mjs
// runs the same table against both so they cannot drift.
export function deriveArity(entry) {
  const params = entry.params ?? []
  const last = params[params.length - 1]
  if (last?.endsWith('*')) {
    return { min: entry.variadicMin ?? params.length, max: Infinity }
  }
  if (last?.endsWith('?')) {
    return { min: params.length - 1, max: params.length }
  }
  return { min: params.length, max: params.length }
}
