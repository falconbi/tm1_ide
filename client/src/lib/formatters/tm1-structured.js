// ── TM1 Structured / Verbose Formatter ────────────────────────────────────────
// Expression-aware formatter. Parses function call trees and applies
// TM1-specific argument packing rules.
//
// TM1 Verbose:    each string argument on its own line
// TM1 Structured: consecutive string arguments grouped on one line
//
// Multi-line source rules are joined into logical statements before parsing.

import { tokenize } from './tokenizer.js'
import { parseExpression } from './tm1-expression-parser.js'

const PASSTHROUGH_KWS = new Set(['feeders', 'skipcheck', 'stet', 'continue', 'endif', 'else'])
const BLOCK_KWS       = new Set(['if', 'elseif'])

// ── Helpers ───────────────────────────────────────────────────────────────────

function indentStr(level, settings) {
  if (settings.indentStyle === 'tab') return '\t'.repeat(level)
  const sz = settings.indentStyle === 'spaces4' ? 4 : 2
  return ' '.repeat(level * sz)
}

function normIdent(name, settings, namingMap) {
  if (settings.capitalization === 'asIs') return name
  const lo = name.toLowerCase()
  if (settings.capitalization === 'ibmOfficial') return namingMap?.[lo] ?? name.toUpperCase()
  if (settings.capitalization === 'lower')       return lo
  if (settings.capitalization === 'upper')       return name.toUpperCase()
  return name
}

function fmtAtom(node, settings, namingMap) {
  if (node.kind === 'element_ref') return node.value
  if (node.kind === 'empty')       return ''
  const tok = node.token
  if (tok.type === 'identifier' || tok.type === 'keyword') return normIdent(tok.value, settings, namingMap)
  return tok.value
}

const isDimVar = n => n.kind === 'atom' && n.token?.type === 'dim_var'
const isStr    = n => (n.kind === 'atom' && n.token?.type === 'string') || (n.kind === 'binary' && n.op === ':')

const cmaSep  = s => s.commaSpacing    === 'none'    ? ','  : ', '
const opWrap  = (op, s) => s.operatorSpacing === 'compact' ? op   : ` ${op} `
const semiCh  = s => s.semicolonSpacing === 'single' ? ' ;' : ';'

// ── Expression formatter ──────────────────────────────────────────────────────

function fmtExpr(node, baseLevel, settings, namingMap, preset) {
  if (!node || node.kind === 'empty') return ''
  switch (node.kind) {
    case 'call':
      return fmtCall(node, baseLevel, settings, namingMap, preset)
    case 'binary':
      if (node.op === ':')
        return fmtExpr(node.left, baseLevel, settings, namingMap, preset) + ':' +
               fmtExpr(node.right, baseLevel, settings, namingMap, preset)
      return fmtExpr(node.left, baseLevel, settings, namingMap, preset) +
             opWrap(node.op, settings) +
             fmtExpr(node.right, baseLevel, settings, namingMap, preset)
    case 'unary':
      return node.op + fmtExpr(node.operand, baseLevel, settings, namingMap, preset)
    default:
      return fmtAtom(node, settings, namingMap)
  }
}

function fmtCall(node, baseLevel, settings, namingMap, preset) {
  const fn   = normIdent(node.name, settings, namingMap)
  const args = node.args ?? []
  if (!args.length) return fn + '()'

  const inner    = baseLevel + 1
  const innerInd = indentStr(inner, settings)
  const baseInd  = indentStr(baseLevel, settings)

  // IF always fully expands — each arg on its own line
  if (node.name.toLowerCase() === 'if') {
    const lines = args.map(a => innerInd + fmtExpr(a, inner, settings, namingMap, preset))
    return fn + '(\n' + lines.join(',\n') + '\n' + baseInd + ')'
  }
  // (comma between IF args is always at end-of-line; commaSpacing controls same-line joins below)

  // ── Inline zone ──────────────────────────────────────────────────────────
  // First arg is always inline, then pack consecutive non-string, non-call
  // args (dim_vars, numbers, bare identifiers) with it.
  // Only strings and nested function calls trigger a line break.
  let inlineEnd = 1
  while (inlineEnd < args.length && !isStr(args[inlineEnd]) && args[inlineEnd].kind !== 'call') inlineEnd++

  const inlineArgs = args.slice(0, inlineEnd)
  const breakArgs  = args.slice(inlineEnd)

  const inlinePart = fn + '(' + inlineArgs.map(a => fmtExpr(a, inner, settings, namingMap, preset)).join(cmaSep(settings))

  // Everything fits inline — no break args
  if (!breakArgs.length) return inlinePart + ')'

  // ── Break zone ───────────────────────────────────────────────────────────
  // Rules for both presets:
  //   • consecutive !dim_vars  → grouped on one line
  //   • function calls         → own line, recursed
  //   • strings (Verbose)      → each on own line
  //   • strings (Structured)   → consecutive strings grouped on one line
  const breakLines = []
  let j = 0
  while (j < breakArgs.length) {
    const a = breakArgs[j]

    if (isDimVar(a)) {
      const group = []
      while (j < breakArgs.length && isDimVar(breakArgs[j])) {
        group.push(fmtExpr(breakArgs[j], inner, settings, namingMap, preset))
        j++
      }
      breakLines.push(innerInd + group.join(cmaSep(settings)))

    } else if (isStr(a) && preset === 'tm1-structured') {
      const group = []
      while (j < breakArgs.length && isStr(breakArgs[j])) {
        group.push(fmtExpr(breakArgs[j], inner, settings, namingMap, preset))
        j++
      }
      breakLines.push(innerInd + group.join(cmaSep(settings)))

    } else {
      // Verbose strings, function calls, numbers, identifiers
      breakLines.push(innerInd + fmtExpr(a, inner, settings, namingMap, preset))
      j++
    }
  }

  return inlinePart + ',\n' + breakLines.join(',\n') + '\n' + baseInd + ')'
}

// ── Statement formatter ───────────────────────────────────────────────────────

function fmtStatement(raw, baseLevel, settings, namingMap, preset) {
  try {
    const trimmed = raw.trim()
    if (!trimmed) return ''

    const tokens = tokenize(trimmed)
    const toks   = tokens.filter(t => t.type !== 'whitespace')
    if (!toks.length) return trimmed

    const first = toks[0]

    // Directives and comments: preserve as-is
    if (first.type === 'directive' || first.type === 'comment') return trimmed

    // Passthrough section keywords: FEEDERS; SKIPCHECK; STET; CONTINUE; ENDIF; ELSE;
    if (first.type === 'keyword' && PASSTHROUGH_KWS.has(first.value.toLowerCase())) {
      const kw   = normIdent(first.value, settings, namingMap)
      const rest = toks.slice(1).map(t => t.value).join('')
      return kw + rest
    }

    // Determine leading area prefix (N:, C:, S:) before the element reference
    let prefixStr = ''
    let from = 0
    if (first.type === 'area_prefix') {
      const sp  = settings.areaPrefixSpacing === 'none' ? '' : ' '
      const pfx = settings.capitalization === 'asIs' ? first.value : first.value.toUpperCase()
      prefixStr = pfx + sp
      from = 1
    }

    // Locate assignment = and semicolon at bracket-depth 0
    let assignIdx = -1
    let semiIdx   = -1
    let depth     = 0
    for (let i = from; i < toks.length; i++) {
      const v = toks[i].value
      if (v === '(' || v === '[' || v === '{') depth++
      else if (v === ')' || v === ']' || v === '}') depth--
      else if (toks[i].type === 'operator' && v === '=' && depth === 0 && assignIdx === -1) assignIdx = i
      else if (toks[i].type === 'punctuation' && v === ';' && depth === 0) { semiIdx = i; break }
    }

    const semi = semiIdx !== -1 ? semiCh(settings) : ''
    const end  = semiIdx !== -1 ? semiIdx : toks.length

    // Block-level IF / ELSEIF — keep compact, just normalise keyword
    if (assignIdx === -1 && toks[from]?.type === 'keyword' && BLOCK_KWS.has(toks[from].value.toLowerCase())) {
      const kw = normIdent(toks[from].value, settings, namingMap)
      return kw + toks.slice(from + 1, end).map(t => t.value).join('') + semi
    }

    if (assignIdx !== -1) {
      // Assignment:  [prefix] LHS = [rhs_prefix] RHS;
      const lhs    = toks.slice(from, assignIdx).map(t => t.value).join('')

      // Area prefix may appear after = (e.g. ['elem'] = N: DB(...))
      let rhsFrom      = assignIdx + 1
      let rhsPrefixStr = ''
      if (toks[rhsFrom]?.type === 'area_prefix') {
        const sp  = settings.areaPrefixSpacing === 'none' ? '' : ' '
        const pfx = settings.capitalization === 'asIs' ? toks[rhsFrom].value : toks[rhsFrom].value.toUpperCase()
        rhsPrefixStr = pfx + sp
        rhsFrom++
      }

      const rhs    = parseExpression(toks.slice(rhsFrom, end))
      const rhsFmt = fmtExpr(rhs, baseLevel + 1, settings, namingMap, preset)

      if (rhsFmt.includes('\n')) {
        const innerInd = indentStr(baseLevel + 1, settings)
        return prefixStr + lhs + ' = ' + rhsPrefixStr.trimEnd() + '\n' + innerInd + rhsFmt + semi
      }
      return prefixStr + lhs + ' = ' + rhsPrefixStr + rhsFmt + semi
    }

    // Feeder: LHS => DB1(...), DB2(...);
    // parseExpression stops at the first top-level comma, so we must split
    // the RHS ourselves before parsing each feed expression separately.
    const feederOpIdx = (() => {
      let d = 0
      for (let i = from; i < end; i++) {
        const v = toks[i].value
        if (v === '(' || v === '[') d++
        else if (v === ')' || v === ']') d--
        else if (toks[i].type === 'operator' && v === '=>' && d === 0) return i
      }
      return -1
    })()

    if (feederOpIdx !== -1) {
      const lhs     = toks.slice(from, feederOpIdx).map(t => t.value).join('')
      const rhsToks = toks.slice(feederOpIdx + 1, end)
      const feeds   = []
      let cur = [], d = 0
      for (const tok of rhsToks) {
        if (tok.value === '(' || tok.value === '[') { d++; cur.push(tok) }
        else if (tok.value === ')' || tok.value === ']') { d--; cur.push(tok) }
        else if (tok.type === 'punctuation' && tok.value === ',' && d === 0) {
          if (cur.length) feeds.push(cur); cur = []
        } else { cur.push(tok) }
      }
      if (cur.length) feeds.push(cur)
      const innerInd = indentStr(baseLevel + 1, settings)
      const feedFmts = feeds.map(ftoks => innerInd + fmtExpr(parseExpression(ftoks), baseLevel + 1, settings, namingMap, preset))
      return prefixStr + lhs + ' =>\n' + feedFmts.join(',\n') + semi
    }

    // No assignment — format entire expression (standalone calls, etc.)
    const expr    = parseExpression(toks.slice(from, end))
    const exprFmt = fmtExpr(expr, baseLevel, settings, namingMap, preset)
    return prefixStr + exprFmt + semi

  } catch (_) {
    return raw.trim()
  }
}

// ── Logical unit parser ───────────────────────────────────────────────────────
// Splits raw text into discrete logical units before formatting.
// Multi-line rules (one statement across several physical lines) are joined
// into a single flat string for the expression parser.

function parseLogicalUnits(text) {
  const units    = []
  const rawLines = text.split('\n')
  let i = 0

  while (i < rawLines.length) {
    const trimmed = rawLines[i].trim()

    if (!trimmed) { units.push({ type: 'blank' }); i++; continue }

    if (trimmed.startsWith('//')) { units.push({ type: 'comment', text: trimmed }); i++; continue }

    if (trimmed.startsWith('#')) {
      const lo = trimmed.toLowerCase()
      const isDir = lo.startsWith('#region') || lo.startsWith('#endregion')
      units.push({ type: isDir ? 'directive' : 'comment', text: trimmed })
      i++
      continue
    }

    // Accumulate physical lines into one logical statement (terminated by ;)
    const parts   = []
    let inStr     = false
    let depth     = 0
    let complete  = false

    while (i < rawLines.length && !complete) {
      const lt = rawLines[i].trim()

      // Blank lines and comments end the statement only at depth 0 (not inside parens)
      if (!lt && depth === 0) break
      if (parts.length > 0 && depth === 0) {
        if (lt.startsWith('//')) break
        if (lt.startsWith('#') && !lt.toLowerCase().startsWith('#region') && !lt.toLowerCase().startsWith('#endregion')) break
      }

      // Inside parens: skip blank lines silently (don't push to parts)
      if (!lt) { i++; continue }

      parts.push(lt)

      // Scan for ; at depth 0, respecting strings
      for (let c = 0; c < lt.length; c++) {
        const ch = lt[c]

        if (ch === "'") {
          if (!inStr) {
            inStr = true
          } else if (c + 1 < lt.length && lt[c + 1] === "'") {
            c++ // escaped ''
          } else {
            inStr = false
          }
          continue
        }
        if (inStr) continue

        // Inline comment stops the scan for this line
        if (ch === '/' && c + 1 < lt.length && lt[c + 1] === '/') break

        if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') depth--
        else if (ch === ';' && depth === 0) { complete = true; break }
      }

      i++
    }

    if (parts.length) {
      units.push({ type: 'statement', text: parts.join(' ') })
    }
  }

  return units
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function formatTM1Structured(text, settings, namingMap, preset) {
  const units = parseLogicalUnits(text)
  const out   = []
  let level   = 0

  for (const unit of units) {
    if (unit.type === 'blank') { out.push(''); continue }

    const trimmed = unit.text.trim()

    if (unit.type === 'directive') {
      if (/^#EndRegion\b/i.test(trimmed)) level = Math.max(0, level - 1)
      out.push(indentStr(level, settings) + trimmed)
      if (/^#Region\b/i.test(trimmed)) level++
      continue
    }

    if (unit.type === 'comment') {
      out.push(indentStr(level, settings) + trimmed)
      continue
    }

    // statement
    if (/^ENDIF\b/i.test(trimmed) || /^ELSE\b/i.test(trimmed) || /^ELSEIF\b/i.test(trimmed)) {
      level = Math.max(0, level - 1)
    }

    const ind       = indentStr(level, settings)
    const formatted = fmtStatement(trimmed, level, settings, namingMap, preset)
    out.push(ind + formatted)

    if (/^IF\b/i.test(trimmed) || /^ELSEIF\b/i.test(trimmed) || /^ELSE\b/i.test(trimmed)) {
      level++
    }
  }

  return out.join('\n')
}
