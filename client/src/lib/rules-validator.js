import { tokenize } from '@/lib/formatters/tokenizer.js'
import { parseLogicalUnits } from '@/lib/formatters/tm1-structured.js'
import { parseExpression } from '@/lib/formatters/tm1-expression-parser.js'
import { TM1_FUNCTIONS } from '@/lib/tm1-functions.js'
import { RULES_CATALOG } from '@/lib/tm1-completion.js'

// ELSEIF / ELSE / ENDIF are TI block keywords — not valid in TM1 Rules (Rules use IF() function syntax)
const VALID_KEYWORDS = new Set(['feeders', 'skipcheck', 'stet', 'continue', 'if'])

// ── Function argument info from catalog ────────────────────────────────────────
function getFunctionArgInfo(fnName) {
  const upper = fnName.toUpperCase()

  // Try RULES_CATALOG first (more accurate arg info for rules functions)
  const catEntry = RULES_CATALOG[upper]
  if (catEntry) {
    const params = catEntry.params ?? []
    const starCount = params.filter(p => p.endsWith('*')).length
    const nonStarCount = params.length - starCount
    const base = starCount > 0
      ? { variadic: true,  min: nonStarCount + 1, max: Infinity }
      : { variadic: false, min: params.length,     max: params.length }
    return { ...base, deprecated: catEntry.deprecated ?? null, isStatement: catEntry.isStatement ?? false }
  }

  // Fall back to TM1_FUNCTIONS
  const fnDef = TM1_FUNCTIONS[upper]
  if (!fnDef) return null

  const params = fnDef.params || []
  const dotdotdot = params.filter(p => p.name === '...').length

  if (fnDef.variadic && dotdotdot > 0) {
    return { variadic: true, min: params.length - dotdotdot, max: Infinity }
  }
  if (fnDef.variadic) {
    return { variadic: true, min: 1, max: Infinity }
  }
  return { variadic: false, min: params.length, max: params.length }
}

export function validateRulesSyntax(code) {
  const errors = []
  if (!code) return errors

  // ── Pre-scan: unclosed strings ────────────────────────────────────────────
  let inStr = false
  let strStartLine = 0
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "'") {
      if (i + 1 < code.length && code[i + 1] === "'") { i++; continue }
      inStr = !inStr
      if (inStr) {
        strStartLine = code.substring(0, i).split('\n').length
      }
    }
  }
  if (inStr) {
    errors.push({ severity: 'error', line: strStartLine, message: `Unclosed string — missing closing single quote` })
  }

  // ── Multi-line string guard ───────────────────────────────────────────────
  // If there's an unclosed string, the tokenizer and parser will be confused.
  // Return early with just the string error.
  if (inStr) return errors

  // ── Parse into logical statements ─────────────────────────────────────────
  const units = parseLogicalUnits(code)
  let inFeeders = false
  let feedersSeen = 0
  let feedersLine = -1
  let hasFeederContent = false

  // Track unclosed brackets at the file level
  let fileBracketDepth = 0
  let fileBracketStartLine = -1

  for (const unit of units) {
    if (unit.type !== 'statement') continue

    const text = unit.text
    const tokens = tokenize(text)
    const toks = tokens.filter(t => t.type !== 'whitespace')
    if (!toks.length) continue

    const first = toks[0]
    const last = toks[toks.length - 1]

    const stmtLine = unit.startLine ?? 1

    // ── Check for unknown tokens ──────────────────────────────────────────
    for (const t of tokens) {
      if (t.type === 'unknown' && t.value !== '@') {
        errors.push({ severity: 'error', line: stmtLine, message: `Unexpected character '${t.value}'` })
      }
    }

    // ── Track FEEDERS section ─────────────────────────────────────────────
    if (first.type === 'keyword' && first.value.toLowerCase() === 'feeders') {
      feedersLine = stmtLine
      feedersSeen++
      inFeeders = true
      // Don't continue — let unknown char / semicolon checks still run
    }

    // ── Track feeder content ──────────────────────────────────────────────
    if (inFeeders && text.trim().length > 0) {
      const isFeedersLine = first.type === 'keyword' && first.value.toLowerCase() === 'feeders'
      const isCommentOnly = toks.every(t => t.type === 'comment')
      if (!isFeedersLine && !isCommentOnly) {
        hasFeederContent = true
      }
    }

    // ── Feeder before FEEDERS; ────────────────────────────────────────────
    if (!inFeeders) {
      const hasFeederOp = toks.some(t => t.type === 'operator' && t.value === '=>')
      if (hasFeederOp) {
        errors.push({ severity: 'error', line: stmtLine, message: `Feeder arrow (=>) appears before FEEDERS; — move it after FEEDERS;` })
      }
    }

    // ── Statement-level bracket analysis ───────────────────────────────────
    let stmtBracketDepth = 0
    let depth = 0
    for (const t of toks) {
      if (t.value === '(' || t.value === '[' || t.value === '{') {
        depth++
        if (t.value === '[') {
          stmtBracketDepth++
          fileBracketDepth++
          if (fileBracketStartLine === -1) fileBracketStartLine = lineOf(text, t, code)
        }
      } else if (t.value === ')' || t.value === ']' || t.value === '}') {
        depth--
        if (t.value === ']') {
          stmtBracketDepth--
          fileBracketDepth--
          if (fileBracketDepth === 0) fileBracketStartLine = -1
        }
        if (depth < 0) {
          errors.push({ severity: 'error', line: stmtLine, message: `Unexpected '${t.value}' — no matching opener` })
          depth = 0
        }
      } else if (t.value === ')' && fileBracketDepth > 0) {
        // ) inside [...] — the feeder bracket typo
        errors.push({ severity: 'error', line: stmtLine, message: `Unexpected ')' inside brackets — did you mean ']'?` })
        fileBracketDepth--
      }
    }

    // ── Check for semicolon ────────────────────────────────────────────────
    if (last?.value !== ';') {
      // Only flag if it looks like a real statement (not a bare number/identifier)
      const hasContent = toks.some(t => t.type === 'string' || t.type === 'operator' || t.value === '[')
      if (hasContent) {
        errors.push({ severity: 'warning', line: stmtLine, message: `Statement missing semicolon — expected ';' at end` })
      }
    }

    // We validate the end of the statement differently depending on what the
    // statement type looks like.  Mirror the logic from fmtStatement.
    const cleanedText = text.trim()
    const cleanedTokens = tokenize(cleanedText)
    const cleanedToks = cleanedTokens.filter(t => t.type !== 'whitespace' && t.type !== 'comment')
    if (!cleanedToks.length) continue

    // ── Type-specific validation ──────────────────────────────────────────
    validateStatement(cleanedToks, cleanedText, code, errors, stmtLine)
  }

  // ── Post-loop checks ────────────────────────────────────────────────────
  if (feedersSeen === 0 && units.some(u => {
    if (u.type !== 'statement') return false
    const toks = tokenize(u.text).filter(t => t.type !== 'whitespace')
    return toks.some(t => t.type === 'operator' && t.value === '=>')
  })) {
    errors.push({ severity: 'error', line: 1, message: `Rules contain feeder arrows (=>) but no FEEDERS; keyword — add FEEDERS; before feeder statements` })
  }

  if (feedersSeen > 1) {
    let count = 0
    const lines = code.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*FEEDERS\s*;?\s*$/i.test(lines[i].trim())) {
        count++
        if (count === 2) {
          errors.push({ severity: 'error', line: i + 1, message: `Duplicate FEEDERS; — there should be exactly one FEEDERS; section` })
          break
        }
      }
    }
  }

  if (feedersSeen >= 1 && !hasFeederContent) {
    errors.push({ severity: 'warning', line: feedersLine, message: `FEEDERS; section is empty — no feeder statements found` })
  }

  return errors
}

// ── Statement validator ──────────────────────────────────────────────────────
function validateStatement(toks, text, code, errors, baseLine) {
  const first = toks[0]
  const lineNum = baseLine ?? lineOf(text, first, code)

  // Comment / directive — skip
  if (first.type === 'directive' || first.type === 'comment') return

  // TI block keywords that are invalid in TM1 Rules
  if (first.type === 'keyword') {
    const kw = first.value.toLowerCase()
    if (kw === 'elseif' || kw === 'else' || kw === 'endif') {
      errors.push({ severity: 'error', line: lineNum, message: `'${first.value.toUpperCase()}' is not valid in TM1 Rules — use IF(condition, trueVal, falseVal) function syntax` })
      return
    }
  }

  // Keyword statement
  if (first.type === 'keyword' && VALID_KEYWORDS.has(first.value.toLowerCase())) {
    const kw = first.value.toLowerCase()

    // FEEDERS; is handled in the loop above
    if (kw === 'feeders') return

    // Check for CONTNUE or other misspellings
    if (kw === 'continue') {
      // CONTINUE is only valid inside IF() in rules, not standalone
      // But we don't track IF scope here — just check it's not the only token
      if (toks.length > 2) {
        // e.g., IF(cond, val, CONTINUE) — this is fine
      }
      return
    }

    // Keywords should be the only significant token (or followed by ;)
    if (toks.length > 2 && !['if', 'elseif', 'else', 'endif'].includes(kw)) {
      // Extra tokens after keyword
    }
    return
  }

  // Check for area prefix at start (N:, C:, S:)
  let from = 0
  let areaPrefix = null
  if (first.type === 'area_prefix') {
    areaPrefix = first.value
    from = 1
  }

  // Locate = and ; at bracket depth 0
  let assignIdx = -1
  let semiIdx = -1
  let feederIdx = -1
  let depth = 0

  for (let i = from; i < toks.length; i++) {
    const v = toks[i].value
    if (v === '(' || v === '[' || v === '{') depth++
    else if (v === ')' || v === ']' || v === '}') depth--
    else if (toks[i].type === 'operator' && v === '=' && depth === 0 && assignIdx === -1) assignIdx = i
    else if (toks[i].type === 'operator' && v === '=>' && depth === 0 && feederIdx === -1) feederIdx = i
    else if (toks[i].type === 'punctuation' && v === ';' && depth === 0) {
      semiIdx = i
    }
  }

  const hasSemi = semiIdx !== -1
  const endIdx = hasSemi ? semiIdx : toks.length

  // ── Assignment: LHS = RHS ────────────────────────────────────────────────
  if (assignIdx !== -1) {
    const lhsToks = toks.slice(from, assignIdx)
    const eqTok = toks[assignIdx]
    let rhsFrom = assignIdx + 1
    let rhsPrefix = null

    // Check for area prefix after =
    if (toks[rhsFrom]?.type === 'area_prefix') {
      rhsPrefix = toks[rhsFrom].value
      rhsFrom++
    }

    // LHS validation
    if (lhsToks.length === 0) {
      errors.push({ severity: 'error', line: lineNum, message: `Missing left-hand side before '='` })
    } else {
      // Check LHS is at least one element ref
      const hasElementRef = lhsToks.some(t => t.value === '[')
      if (!hasElementRef) {
        errors.push({ severity: 'error', line: lineNum, message: `Invalid left-hand side — expected element reference like ['Dim']` })
      }
    }

    // RHS tokens
    const rhsToks = toks.slice(rhsFrom, endIdx)
    if (rhsToks.length === 0) {
      errors.push({ severity: 'error', line: lineNum, message: `Missing right-hand side after '='` })
    } else {
      tryParseExpression(rhsToks, text, code, errors, lineNum)
    }

    return
  }

  // ── Feeder: Source => Target(s) ───────────────────────────────────────────
  if (feederIdx !== -1) {
    const srcToks = toks.slice(from, feederIdx)
    const arrowTok = toks[feederIdx]
    const tgtToks = toks.slice(feederIdx + 1, endIdx)

    // Source validation
    if (srcToks.length === 0) {
      errors.push({ severity: 'error', line: lineNum, message: `Missing feeder source before '=>'` })
    } else {
      const hasElementRef = srcToks.some(t => t.value === '[')
      if (!hasElementRef) {
        errors.push({ severity: 'error', line: lineNum, message: `Invalid feeder source — expected element reference like ['Dim']` })
      }
    }

    // Target validation — split by comma at depth 0
    if (tgtToks.length === 0) {
      errors.push({ severity: 'error', line: lineNum, message: `Missing feeder target after '=>'` })
    } else {
      const targets = splitAtDepth0(tgtToks, ',')
      for (const target of targets) {
        if (target.length > 0) {
          tryParseExpression(target, text, code, errors, lineNum)
        } else {
          errors.push({ severity: 'error', line: lineNum, message: `Empty feeder target — expected DB() call or element reference` })
        }
      }
    }

    return
  }

  // ── Naked expression (no =, no =>) ────────────────────────────────────────
  if (endIdx > from) {
    const exprToks = toks.slice(from, endIdx)
    tryParseExpression(exprToks, text, code, errors, lineNum)
  }
}

// ── Try to parse an expression and report errors ──────────────────────────────
function tryParseExpression(toks, text, code, errors, line) {
  if (line === undefined) {
    line = lineOf(text, toks[0], code)
  }
  try {
    const ast = parseExpression(toks)
    if (!ast || ast.kind === 'empty') {
      errors.push({ severity: 'error', line, message: `Invalid expression` })
    }
    const issues = validateAST(ast, code, line)
    errors.push(...issues)
  } catch {
    errors.push({ severity: 'error', line, message: `Invalid expression — parse error` })
  }
}

// ── AST validation ───────────────────────────────────────────────────────────
function validateAST(ast, code, line) {
  const issues = []
  if (!ast) return issues

  switch (ast.kind) {
    case 'call': {
      // Check function name and arg count against catalogs
      const fnName = ast.name
      const catInfo = getFunctionArgInfo(fnName)

      if (!catInfo) {
        const fnDef = TM1_FUNCTIONS[fnName.toUpperCase()]
        if (fnDef && fnDef.language === 'ti') {
          issues.push({ severity: 'error', line, message: `${fnName} is a TI function — cannot be used in rules` })
        } else {
          issues.push({ severity: 'error', line, message: `Unknown function '${fnName}'` })
        }
      } else {
        const argCount = (ast.args || []).length
        if (catInfo.variadic) {
          if (argCount < catInfo.min) {
            issues.push({ severity: 'error', line, message: `${fnName} expects at least ${catInfo.min} arguments, got ${argCount}` })
          }
        } else {
          if (argCount !== catInfo.min) {
            if (argCount < catInfo.min) {
              issues.push({ severity: 'error', line, message: `${fnName} expects ${catInfo.min} arguments, got ${argCount}` })
            } else {
              issues.push({ severity: 'error', line, message: `${fnName} expects ${catInfo.min} arguments, got ${argCount}` })
            }
          }
        }
        if (catInfo.deprecated) {
          issues.push({ severity: 'warning', line, message: `${fnName} is deprecated: ${catInfo.deprecated}` })
        }
      }

      for (const arg of ast.args) {
        issues.push(...validateAST(arg, code, line))
      }
      break
    }
    case 'binary': {
      issues.push(...validateAST(ast.left, code, line))
      issues.push(...validateAST(ast.right, code, line))

      if (ast.left?.kind === 'empty' || ast.right?.kind === 'empty') {
        issues.push({ severity: 'error', line, message: `Missing operand for '${ast.op}'` })
      }
      break
    }
    case 'unary': {
      if (!ast.operand || ast.operand.kind === 'empty') {
        issues.push({ severity: 'error', line, message: `Missing operand after '${ast.op}'` })
      }
      issues.push(...validateAST(ast.operand, code, line))
      break
    }
    case 'element_ref': {
      if (!ast.value || ast.value === '[]') {
        issues.push({ severity: 'error', line, message: `Empty element reference []` })
      }
      break
    }
  }

  return issues
}

// ── Split tokens at depth 0 by a separator token value ────────────────────────
function splitAtDepth0(toks, sep) {
  const groups = []
  let cur = []
  let depth = 0
  for (const t of toks) {
    if (t.value === '(' || t.value === '[' || t.value === '{') depth++
    else if (t.value === ')' || t.value === ']' || t.value === '}') depth--
    else if (t.value === sep && depth === 0) {
      groups.push(cur)
      cur = []
      continue
    }
    cur.push(t)
  }
  if (cur.length) groups.push(cur)
  return groups
}

// ── Find the line number of a token in the original source ────────────────────
function lineOf(statementText, token, fullCode) {
  // Try to find the token position in the full code
  if (token?.pos !== undefined) {
    return fullCode.substring(0, token.pos).split('\n').length || 1
  }
  // Fallback: find the statement in the full code
  const idx = fullCode.indexOf(statementText)
  if (idx !== -1) {
    return fullCode.substring(0, idx).split('\n').length || 1
  }
  return 1
}
