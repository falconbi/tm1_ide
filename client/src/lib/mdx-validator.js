// ── MDX Validator ──────────────────────────────────────────────────────────────
// Client-side static analysis: function name + argument count validation
// using MDX_FUNCTIONS_FLAT. Runs before / in parallel with server-side preview.

import { MDX_FUNCTIONS_FLAT } from '@/lib/tm1-mdx-catalog.js'

// Build a fast lookup: upperName -> { paramCount }
const MDX_CATALOG_MAP = {}
for (const entry of MDX_FUNCTIONS_FLAT) {
  MDX_CATALOG_MAP[entry.name.toUpperCase()] = entry
}

// ── Walk text to extract function calls ────────────────────────────────────────
// MDX syntax: [Dim].[Hier].[Member] for refs, {set} for tuples, word(args).
// We skip member-property access (.Children, .Members, .Siblings etc.)
// and dotted method calls (CurrentMember.Properties).

function findMDXFunctionCalls(text) {
  const calls = []
  const stack = []
  let inStr = false
  let strChar = null
  let wordBuf = ''

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inStr) {
      if (ch === strChar) {
        if (i + 1 < text.length && text[i + 1] === strChar) { i++ }
        else { inStr = false }
      }
      wordBuf = ''
      continue
    }

    if (ch === '"' || ch === "'") {
      inStr = true
      strChar = ch
      if (stack.length && stack[stack.length - 1].depth === 1) {
        stack[stack.length - 1].hasArgs = true
      }
      wordBuf = ''
      continue
    }

    if (/[a-zA-Z0-9_]/.test(ch)) {
      wordBuf += ch
      continue
    }

    if (ch === '.' && wordBuf.length) {
      wordBuf = ''
      continue
    }

    if (ch === '(') {
      if (wordBuf.length) {
        const lineNum = text.substring(0, i).split('\n').length
        if (stack.length) stack[stack.length - 1].hasArgs = true
        stack.push({ name: wordBuf, line: lineNum, depth: 1, commas: 0, hasArgs: false })
      } else if (stack.length) {
        stack[stack.length - 1].depth++
      }
      wordBuf = ''
      continue
    }

    if (ch === ')') {
      if (stack.length) {
        stack[stack.length - 1].depth--
        if (stack[stack.length - 1].depth === 0) {
          const call = stack.pop()
          let argCount = 0
          if (call.hasArgs) argCount = call.commas + 1
          calls.push({ fn: call.name, argCount, line: call.line })
        }
      }
      wordBuf = ''
      continue
    }

    if (ch === ',' && stack.length && stack[stack.length - 1].depth === 1) {
      stack[stack.length - 1].commas++
    }

    if (stack.length && stack[stack.length - 1].depth === 1 && ch !== ' ' && ch !== '\t' && ch !== ',') {
      stack[stack.length - 1].hasArgs = true
    }

    wordBuf = ''
  }

  return calls
}

/**
 * Validate MDX code — checks function names and argument counts.
 * @param {string} mdx — raw MDX text
 * @returns {{ line: number, message: string, severity: 'error'|'warning' }[]}
 */
export function validateMDX(mdx) {
  const results = []
  if (!mdx?.trim()) return results

  const calls = findMDXFunctionCalls(mdx)

  for (const call of calls) {
    const upper = call.fn.toUpperCase()
    const entry = MDX_CATALOG_MAP[upper]

    if (!entry) {
      // Unknown MDX function — warning (MDX is extensible)
      results.push({
        severity: 'warning',
        line: call.line,
        message: `Unknown MDX function '${call.fn}'`,
      })
      continue
    }

    // Skip member properties (no params = not a callable function)
    if (!entry.params || entry.params.length === 0) continue

    const expected = entry.params.length
    if (call.argCount !== expected) {
      results.push({
        severity: 'warning',
        line: call.line,
        message: `${entry.name} expects ${expected} argument${expected !== 1 ? 's' : ''}, got ${call.argCount}`,
      })
    }
  }

  return results
}
