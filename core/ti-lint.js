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
// Signatures are hand-built from actual TI behaviour, NOT from TI_CATALOG —
// that catalog has errors (e.g. it lists AttrInsert as 3 args; it is 4:
// AttrInsert(dimension, priorAttribute, name, type)).

const { findCalls } = require('./rules-lint')

const f = n => ({ min: n, max: n })
const v = n => ({ min: n, max: Infinity })

const SIG = {
  // cube cells
  CELLPUTN: v(3), CELLPUTS: v(3), CELLINCREMENTN: v(3),
  CELLGETN: v(2), CELLGETS: v(2), CELLISUPDATEABLE: v(2),
  // dimension / element structure
  DIMENSIONCREATE: f(1), DIMENSIONEXISTS: f(1), DIMENSIONDESTROY: f(1),
  DIMENSIONDELETEALLELEMENTS: f(1),
  DIMENSIONELEMENTINSERT: f(4), DIMENSIONELEMENTINSERTDIRECT: f(4),
  DIMENSIONELEMENTDELETE: f(2), DIMENSIONELEMENTDELETEDIRECT: f(2),
  DIMENSIONELEMENTCOMPONENTADD: f(4), DIMENSIONELEMENTCOMPONENTADDDIRECT: f(4),
  DIMENSIONELEMENTCOMPONENTDELETE: f(3), DIMENSIONELEMENTPRINCIPALNAME: f(2),
  DTYPE: f(2), DIMIX: f(2), DIMSIZ: f(1), DIMNM: f(2),
  ELPAR: f(3), ELPARN: f(2), ELCOMP: f(3), ELCOMPN: f(2), ELLEV: f(2), ELWEIGHT: f(3),
  // hierarchies
  HIERARCHYEXISTS: f(2), HIERARCHYCREATE: f(2), HIERARCHYDELETEALLELEMENTS: f(2),
  HIERARCHYELEMENTINSERT: f(5), HIERARCHYELEMENTINSERTDIRECT: f(5),
  HIERARCHYELEMENTCOMPONENTADD: f(5),
  // attributes
  ATTRINSERT: f(4), ATTRDELETE: f(2),
  ATTRPUTN: f(4), ATTRPUTS: f(4),
  ATTRN: f(3), ATTRS: f(3), ATTRL: f(3),
  ELEMENTATTRPUTN: f(5), ELEMENTATTRPUTS: f(5),
  ELEMENTATTRN: f(4), ELEMENTATTRS: f(4),
  // strings / numbers
  NUMBR: f(1), STR: f(3), TRIM: f(1), LTRIM: f(1), RTRIM: f(1),
  LONG: f(1), SUBST: f(3), SCAN: f(2), FILL: f(2), DELET: f(3), INSRT: f(3),
  UPPER: f(1), LOWER: f(1), CAPIT: f(1),
  // process / io
  LOGOUTPUT: f(2), ASCIIOUTPUT: v(2), TEXTOUTPUT: v(2),
  EXECUTEPROCESS: v(1), RUNPROCESS: v(1),
  // pure statements — no args
  ITEMSKIP: f(0), PROCESSQUIT: f(0), PROCESSBREAK: f(0), PROCESSERROR: f(0),
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
