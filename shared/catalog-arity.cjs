'use strict'

// Derives a {min, max} argument-count range from a canonical catalog entry's
// params array. This CommonJS file is the one implementation: the server lints
// require it directly, and shared/catalog-arity.js re-exports it for the client.
//
// Trailing tag suffixes on the LAST param only:
//   '*'  variadic — 1-or-more repeats of that type (min = params.length,
//        unless entry.variadicMin overrides it — see EXECUTEPROCESS/RUNPROCESS,
//        whose trailing (param, value) pairs are optional, not required)
//   '?'  optional — 0-or-1 occurrences of that single trailing arg (min =
//        params.length - 1, max = params.length) — NOT variadic, e.g.
//        SubsetCreate's optional AsTemporary flag
//   (none) fixed arity — min = max = params.length
function deriveArity(entry) {
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

module.exports = { deriveArity }
