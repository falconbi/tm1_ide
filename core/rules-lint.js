'use strict'

// ── Static rule lint (server-side) ────────────────────────────────────────────
//
// TM1's own `tm1.CheckRules` validates that a rule *parses* — it does NOT catch
// a valid-looking call made with the wrong number of arguments. That gap cost
// real iterations: `ElementAttrN('Dim', !Dim, 'attr')` (3 args) passes CheckRules
// but the engine binds the element name into the hierarchy slot and returns
// blank. This module catches that class of mistake before the rule is written.
//
// The client-side Monaco validator (client/src/lib/rules-validator.js) already
// does this in the editor. This is the CJS equivalent for the MCP path / any
// server-side route. Arg counts are transcribed from RULES_CATALOG in
// client/src/lib/tm1-completion.js — keep them in step when that changes.

const f = n            => ({ min: n, max: n })          // fixed arity
const v = n            => ({ min: n, max: Infinity })   // variadic (n or more)

const SIG = {
  // cube data
  DB: v(2), CELLVALUEN: v(2), CELLVALUES: v(2), DBS: v(2),
  // dimension info
  TABDIM: f(2), DIMSIZ: f(1), DIMIX: f(2), DNEXT: f(2), DNLEV: f(1), DTYPE: f(2),
  // element info — classic (single hierarchy)
  ELCOMP: f(3), ELCOMPN: f(2), ELLEV: f(2), ELPAR: f(3), ELPARN: f(2),
  ELWEIGHT: f(3), ELISANC: f(3), ELISCOMP: f(3), ELISPAR: f(3),
  // element info — hierarchy-aware
  ELEMENTCOMPONENT: f(4), ELEMENTCOMPONENTCOUNT: f(3), ELEMENTCOUNT: f(2),
  ELEMENTFIRST: f(2), ELEMENTINDEX: f(3), ELEMENTISANCESTOR: f(4),
  ELEMENTISCOMPONENT: f(4), ELEMENTISPARENT: f(4), ELEMENTLEVEL: f(3),
  ELEMENTNAME: f(3), ELEMENTNEXT: f(3), ELEMENTPARENT: f(4),
  ELEMENTPARENTCOUNT: f(3), ELEMENTTYPE: f(3), ELEMENTWEIGHT: f(4),
  // attribute read
  ATTRN: f(3), ATTRS: f(3), ATTRL: f(3),
  CUBEATTRN: f(2), CUBEATTRS: f(2), DIMENSIONATTRN: f(2), DIMENSIONATTRS: f(2),
  ELEMENTATTRN: f(4), ELEMENTATTRS: f(4),
  // conditional
  IF: f(3),
  // string
  CAPIT: f(1), CHAR: f(1), CODE: f(2), CONT: f(2), DELET: f(3), FILL: f(2),
  INSRT: f(3), LONG: f(1), LOWER: f(1), LTRIM: f(1), NUMBR: f(1), RTRIM: f(1),
  SCAN: f(2), SCANR: f(2), STR: f(3), SUBST: f(3), TRIM: f(1), UPPER: f(1),
  // math
  ABS: f(1), EXP: f(1), INT: f(1), LOG: f(1), MAX: f(2), MIN: f(2), MOD: f(2),
  POWER: f(2), RAND: f(0), ROUND: f(2), SIGN: f(1), SQRT: f(1),
}

// ── scanner ──────────────────────────────────────────────────────────────────
// Walks the text once, skipping '…' string literals and #… line comments,
// finding IDENT( … ) and counting top-level commas.

function lineAt(text, pos) {
  let line = 1
  for (let i = 0; i < pos && i < text.length; i++) if (text[i] === '\n') line++
  return line
}

function skipString(text, i) {
  // text[i] === "'"
  i++
  const n = text.length
  while (i < n) {
    if (text[i] === "'") {
      if (text[i + 1] === "'") { i += 2; continue }   // '' escaped quote
      return i + 1
    }
    i++
  }
  return i
}

// Count the arguments of a single call whose '(' is at openParen.
// Only counts top-level commas — nested calls are found separately by the
// main walker, which descends past this '(' rather than skipping the call.
function countArgs(text, openParen) {
  let i = openParen + 1
  let depth = 1
  let commas = 0
  let sawContent = false
  const n = text.length
  while (i < n && depth > 0) {
    const ch = text[i]
    if (ch === "'") { i = skipString(text, i); sawContent = true; continue }
    if (ch === '#') { while (i < n && text[i] !== '\n') i++; continue }
    if (ch === '(') { depth++; sawContent = true; i++; continue }
    if (ch === ')') { depth--; i++; continue }
    if (ch === ',' && depth === 1) { commas++; i++; continue }
    if (!/\s/.test(ch)) sawContent = true
    i++
  }
  return sawContent ? commas + 1 : 0
}

function findCalls(text) {
  const calls = []
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (ch === "'") { i = skipString(text, i); continue }
    if (ch === '#') { while (i < n && text[i] !== '\n') i++; continue }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++
      const name = text.slice(i, j)
      let k = j
      while (k < n && /\s/.test(text[k])) k++
      if (text[k] === '(') {
        calls.push({ name, argCount: countArgs(text, k), line: lineAt(text, i) })
        i = k + 1        // descend into the args so nested calls are found too
        continue
      }
      i = j
      continue
    }
    i++
  }
  return calls
}

// Max lexical nesting of IF( … ) — some TM1 versions silently return blank
// past two levels deep.
function maxIfDepth(text) {
  const n = text.length
  let i = 0, parenDepth = 0, max = 0
  const ifStack = []
  while (i < n) {
    const ch = text[i]
    if (ch === "'") { i = skipString(text, i); continue }
    if (ch === '#') { while (i < n && text[i] !== '\n') i++; continue }
    if (ch === '(') {
      let j = i - 1
      while (j >= 0 && /\s/.test(text[j])) j--
      let e = j
      while (j >= 0 && /[A-Za-z0-9_]/.test(text[j])) j--
      const word = text.slice(j + 1, e + 1).toUpperCase()
      parenDepth++
      if (word === 'IF') { ifStack.push(parenDepth); if (ifStack.length > max) max = ifStack.length }
      i++
      continue
    }
    if (ch === ')') {
      parenDepth--
      while (ifStack.length && ifStack[ifStack.length - 1] > parenDepth) ifStack.pop()
      i++
      continue
    }
    i++
  }
  return max
}

// ── public ───────────────────────────────────────────────────────────────────

/**
 * @param {string} rules  full cube rules text
 * @returns {{ errors: {line:number,message:string}[], warnings: {line:number|null,message:string}[] }}
 */
function lintRules(rules) {
  const errors = []
  const warnings = []
  if (!rules || !rules.trim()) return { errors, warnings }

  for (const c of findCalls(rules)) {
    const sig = SIG[c.name.toUpperCase()]
    if (!sig) continue   // unknown to this table — leave it to TM1 CheckRules
    if (c.argCount < sig.min || c.argCount > sig.max) {
      const want = sig.min === sig.max ? `${sig.min}`
        : sig.max === Infinity ? `at least ${sig.min}`
        : `${sig.min}–${sig.max}`
      const plural = want === '1' ? '' : 's'
      let msg = `${c.name}() expects ${want} argument${plural}, got ${c.argCount}`
      if ((c.name.toUpperCase() === 'ELEMENTATTRN' || c.name.toUpperCase() === 'ELEMENTATTRS') && c.argCount === 3) {
        msg += ` — ElementAttrN/S are hierarchy-aware: (dimension, hierarchy, element, attribute). ` +
               `For a single-hierarchy dimension use ATTRN/ATTRS(dimension, element, attribute).`
      }
      errors.push({ line: c.line, message: msg })
    }
  }

  const depth = maxIfDepth(rules)
  if (depth > 2) {
    warnings.push({
      line: null,
      message: `IF nested ${depth} deep — some TM1 engine versions return blank past 2 levels. ` +
               `Consider flattening into helper measures.`,
    })
  }

  // Feeder section: a DB() feeder target whose element name comes from an attribute
  // read writes to whatever the attribute holds. If the attribute is blank for any
  // source element, the feeder targets a non-existent element and errors at load.
  const fIdx = rules.search(/^\s*FEEDERS\s*;/im)
  if (fIdx >= 0) {
    const feederText = rules.slice(fIdx)
    if (/=>\s*DB\s*\([^)]*\b(ATTRS|ATTRN|ElementAttrS|ElementAttrN)\s*\(/i.test(feederText)) {
      warnings.push({
        line: null,
        message: `A feeder targets a DB() whose element is read from an attribute. If that attribute ` +
                 `is blank for any source element the feeder writes to a non-existent element and fails at ` +
                 `load. Give unmatched elements a sentinel value (e.g. a "_none" element) rather than blank.`,
      })
    }
  }

  return { errors, warnings }
}

module.exports = { lintRules, SIG, findCalls, maxIfDepth }
