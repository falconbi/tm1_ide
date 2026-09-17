'use strict'

// ── Static TI lint (server-side) ──────────────────────────────────────────────
//
// TM1 compiles TI on save but is lenient about several things that then fail at
// run time — the errors land in the process error log, not the save response.
// This catches the ones that cost real iterations in the first MCP build:
//
//   • attribute writes on elements inserted earlier in the SAME Prolog
//     (DimensionElementInsert isn't committed until the Prolog ends)
//   • wrong argument counts on common TI functions
//
// Signatures are DERIVED from ../shared/tm1-function-catalog.json — the single
// source of truth also used by the client catalogs. That catalog's ATTRINSERT
// entry is the corrected 4-arg form (dimension, priorAttribute, name, type),
// live-verified against a real TM1 server (Sep 2026) — the older 3-arg version
// this file used to hand-correct independently is now fixed at the source.

const { findCalls } = require('./rules-lint')

const CATALOG = require('../shared/tm1-function-catalog.json')

const f = n => ({ min: n, max: n })
const v = n => ({ min: n, max: Infinity })

const SIG = {}
for (const [name, entry] of Object.entries(CATALOG)) {
  if (entry.language === 'rules') continue   // ti-lint only checks TI-usable functions
  const params = entry.params ?? []
  const variadic = params.length > 0 && params[params.length - 1].endsWith('*')
  SIG[name] = variadic ? v(entry.variadicMin ?? params.length) : f(params.length)
}

// control keywords — findCalls will see IF( / WHILE( / FOR( but they are not
// function calls; SIG has no entry so they are ignored anyway. Listed for clarity.
const CONTROL = new Set(['IF', 'WHILE', 'FOR', 'ELSEIF'])

function lintSection(code, section) {
  const errors = []
  const warnings = []
  if (!code || !code.trim()) return { errors, warnings }

  for (const c of findCalls(code)) {
    const up = c.name.toUpperCase()
    if (CONTROL.has(up)) continue
    // STR() is a Rules function — in TI it fails at run time ("invalid numeric
    // expression"). TI uses NumberToString / NumberToStringEx.
    if (up === 'STR') {
      errors.push({ section, line: c.line, message: `STR() is a Rules function, not TI — it fails at run time. Use NumberToString(n) or NumberToStringEx(n, decimal, thousand, prefix).` })
      continue
    }
    // ItemReject is special: valid as `ItemReject;` or `ItemReject('reason');`
    if (up === 'ITEMREJECT') {
      if (c.argCount > 1) errors.push({ section, line: c.line, message: `ItemReject takes 0 or 1 argument (an optional reason string), got ${c.argCount}` })
      continue
    }
    const sig = SIG[up]
    if (!sig) continue
    if (c.argCount < sig.min || c.argCount > sig.max) {
      const want = sig.min === sig.max ? `${sig.min}`
        : sig.max === Infinity ? `at least ${sig.min}` : `${sig.min}–${sig.max}`
      let msg = `${c.name}() expects ${want} argument${want === '1' ? '' : 's'}, got ${c.argCount}`
      if (up === 'ATTRINSERT' && c.argCount === 3) {
        msg += ` — AttrInsert is (dimension, priorAttribute, name, type); pass '' as priorAttribute to append`
      }
      if ((up === 'ELEMENTATTRN' || up === 'ELEMENTATTRS') && c.argCount === 3) {
        msg += ` — ElementAttrN/S are hierarchy-aware (dimension, hierarchy, element, attribute); for a single-hierarchy dimension use ATTRN/ATTRS`
      }
      errors.push({ section, line: c.line, message: msg })
    }
  }

  // // comments (TI uses #)
  const dslash = code.split('\n').findIndex(l => /(^|[^:])\/\//.test(l) && !/https?:\/\//.test(l))
  if (dslash >= 0) {
    warnings.push({ section, line: dslash + 1, message: `'//' is not a TI comment — TI comments start with '#'` })
  }

  return { errors, warnings }
}

/**
 * @param {{prolog?:string, metadata?:string, data?:string, epilog?:string}} sections
 */
function lintTI(sections = {}) {
  const errors = []
  const warnings = []
  const map = { Prolog: sections.prolog, Metadata: sections.metadata, Data: sections.data, Epilog: sections.epilog }

  for (const [label, code] of Object.entries(map)) {
    const r = lintSection(code, label)
    errors.push(...r.errors)
    warnings.push(...r.warnings)
  }

  // The trap that cost an iteration: insert an element in the Prolog, then write
  // an attribute on it in the same Prolog. The insert isn't committed yet.
  const p = map.Prolog || ''
  const insM = p.match(/\bDimensionElementInsert\s*\(/i)              // not ...Direct
  if (insM) {
    const after = p.slice(insM.index)
    if (/\b(AttrPutN|AttrPutS|ElementAttrPutN|ElementAttrPutS)\s*\(/i.test(after)) {
      warnings.push({
        section: 'Prolog', line: null,
        message: `Prolog inserts an element (DimensionElementInsert) then writes an attribute on it. ` +
                 `Prolog inserts are not committed until the Prolog ends, so AttrPut*/ElementAttrPut* on a ` +
                 `just-inserted element fails at run time ("element not found"). ` +
                 `Move attribute writes to the Epilog, or use DimensionElementInsertDirect.`,
      })
    }
  }

  return { errors, warnings }
}

module.exports = { lintTI, lintSection, SIG }
