// Finds identifier(...) calls in TI source. Comments are stripped first so a
// commented-out call cannot produce a validation warning. Kept standalone so
// tests can exercise it without loading Monaco/catalog aliases.
import { stripComments } from './rules-comments.js'

export function findFunctionCalls(rawText) {
  const text = stripComments(rawText)
  const calls = []
  const stack = []
  let inStr = false
  let wordBuf = ''
  let line = 1

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (ch === '\n') {
      line++
      continue
    }

    if (inStr) {
      if (ch === "'") {
        if (i + 1 < text.length && text[i + 1] === "'") { i++ }
        else { inStr = false }
      }
      wordBuf = ''
      continue
    }

    if (ch === "'") {
      inStr = true
      if (stack.length && stack[stack.length - 1].depth === 1) {
        stack[stack.length - 1].hasArgs = true
      }
      wordBuf = ''
      continue
    }

    if (/[a-zA-Z0-9_]/.test(ch)) {
      wordBuf += ch
      // A word at the top frame's depth 1 is an argument (or the next function
      // name) — mark hasArgs so bare-variable args like LONG(vRec) count.
      if (stack.length && stack[stack.length - 1].depth === 1) stack[stack.length - 1].hasArgs = true
      continue
    }

    // Word.method(…) — skip dotted calls
    if (ch === '.' && wordBuf.length) {
      wordBuf = ''
      continue
    }

    if (ch === '(') {
      if (wordBuf.length) {
        if (stack.length) stack[stack.length - 1].hasArgs = true
        stack.push({ name: wordBuf, line, depth: 1, commas: 0, hasArgs: false })
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
