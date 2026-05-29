// ── TI Process Code Validator ─────────────────────────────────────────────────
// Static analysis: syntax errors, structural issues, and best-practice warnings
// Runs client-side against unsaved editor content across all four sections.

const SECTION_LABELS = {
  PrologProcedure:   'Prolog',
  MetaDataProcedure: 'Metadata',
  DataProcedure:     'Data',
  EpilogProcedure:   'Epilog',
}

// ItemReject can be called in Prolog to pre-filter data source records
// before they hit the Data tab — a common validation pattern.

// Keywords that must be matched as pairs
const IF_KW   = /^\s*IF\s*\(/i
const WHILE_KW = /^\s*WHILE\s*\(/i
const END_KW   = /^\s*END\s*;?\s*$/i
const ENDIF_KW = /^\s*ENDIF\s*;?\s*$/i
const ELSE_KW  = /^\s*ELSE\s*;?\s*$/i
const ELSEIF_KW = /^\s*ELSEIF\s*\(/i

const SECTION_ORDER = ['Prolog', 'Metadata', 'Data', 'Epilog']

// ── Line-level helpers ────────────────────────────────────────────────────────

function isCommentLine(trimmed) {
  return trimmed.startsWith('#') || trimmed.startsWith('//')
}

function isBlankLine(trimmed) {
  return trimmed === ''
}

// ── Parse all lines into logical statements, tracking string/bracket depth ────

function parseStatements(rawCode) {
  const rawLines = rawCode.split('\n')
  const statements = [] // { text, startLine, endLine }
  let i = 0

  while (i < rawLines.length) {
    const trimmed = rawLines[i].trim()
    if (isBlankLine(trimmed) || isCommentLine(trimmed)) { i++; continue }

    const parts = []
    let inStr = false
    let depth = 0
    let complete = false
    const startLine = i

    while (i < rawLines.length && !complete) {
      const lt = rawLines[i].trim()
      if (!lt) break
      if (parts.length > 0 && (lt.startsWith('//') || lt.startsWith('#'))) break

      parts.push(lt)

      for (let c = 0; c < lt.length; c++) {
        const ch = lt[c]
        if (ch === "'") {
          if (!inStr) {
            inStr = true
          } else if (c + 1 < lt.length && lt[c + 1] === "'") {
            c++
          } else {
            inStr = false
          }
          continue
        }
        if (inStr) continue
        if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') depth--
        else if (ch === ';' && depth === 0) { complete = true; break }
      }
      i++
    }

    if (parts.length) {
      statements.push({ text: parts.join(' '), startLine: startLine + 1, endLine: i })
    }
  }

  return statements
}

function countChar(s, ch) {
  let n = 0
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++
  return n
}

// ── Quote-checking across raw lines ────────────────────────────────────────────

function checkQuotes(rawCode, sectionLabel) {
  const errors = []
  const rawLines = rawCode.split('\n')
  let inStr = false
  let stringStartLine = 0

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    if (line.trim().startsWith('#') || line.trim().startsWith('//')) continue

    for (let c = 0; c < line.length; c++) {
      if (line[c] === "'") {
        if (!inStr) {
          inStr = true
          stringStartLine = i + 1
        } else if (c + 1 < line.length && line[c + 1] === "'") {
          c++
        } else {
          inStr = false
        }
      }
    }
  }

  if (inStr) {
    errors.push({
      severity: 'error',
      section: sectionLabel,
      line: stringStartLine,
      message: 'Unclosed string literal — missing closing single quote',
    })
  }
  return errors
}

// ── Structural checks per section ─────────────────────────────────────────────

function checkStructure(rawCode, sectionLabel) {
  const errors = []
  const statements = parseStatements(rawCode)

  // Check IF/ENDIF and WHILE/END matching
  const stack = [] // { type: 'if'|'ifline'|'while', line, keyword }
  const usedVars = new Set()
  const assignedVars = new Set()

  for (const stmt of statements) {
    const t = stmt.text

    // Detect variable assignments: var = expression;
    const assignMatch = t.match(/^\s*([a-zA-Z_]\w*)\s*=/)
    if (assignMatch) {
      assignedVars.add(assignMatch[1].toLowerCase())
    }

    // Detect variable usage
    const usageMatches = t.matchAll(/[a-zA-Z_]\w*/g)
    for (const m of usageMatches) {
      usedVars.add(m[0].toLowerCase())
    }

    if (IF_KW.test(t)) {
      stack.push({ type: 'if', line: stmt.startLine })
    } else if (WHILE_KW.test(t)) {
      stack.push({ type: 'while', line: stmt.startLine })
    } else if (ELSEIF_KW.test(t)) {
      if (!stack.length || (stack[stack.length - 1].type !== 'if' && stack[stack.length - 1].type !== 'ifline')) {
        errors.push({
          severity: 'error',
          section: sectionLabel,
          line: stmt.startLine,
          message: 'ELSEIF without matching IF',
        })
      }
    } else if (ELSE_KW.test(t)) {
      if (!stack.length || (stack[stack.length - 1].type !== 'if' && stack[stack.length - 1].type !== 'ifline')) {
        errors.push({
          severity: 'error',
          section: sectionLabel,
          line: stmt.startLine,
          message: 'ELSE without matching IF',
        })
      }
    } else if (ENDIF_KW.test(t)) {
      let found = false
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j].type === 'if' || stack[j].type === 'ifline') {
          found = true
          break
        }
      }
      if (!found) {
        errors.push({
          severity: 'error',
          section: sectionLabel,
          line: stmt.startLine,
          message: 'ENDIF without matching IF',
        })
      } else {
        // Pop everything up to and including the matching IF
        while (stack.length && stack[stack.length - 1].type !== 'if' && stack[stack.length - 1].type !== 'ifline') {
          stack.pop()
        }
        if (stack.length) stack.pop()
      }
    } else if (END_KW.test(t)) {
      if (!stack.length || stack[stack.length - 1].type !== 'while') {
        errors.push({
          severity: 'error',
          section: sectionLabel,
          line: stmt.startLine,
          message: 'END without matching WHILE',
        })
      } else {
        stack.pop()
      }
    }
  }

  // Remaining unmatched blocks
  for (const item of stack) {
    const label = item.type === 'if' || item.type === 'ifline' ? 'IF' : 'WHILE'
    errors.push({
      severity: 'error',
      section: sectionLabel,
      line: item.line,
      message: `Unclosed ${label} block — missing ${item.type.startsWith('if') ? 'ENDIF' : 'END'}`,
    })
  }

  return { errors, assignedVars, usedVars }
}

// ── Best-practice warnings ─────────────────────────────────────────────────────

function checkBestPractices(rawCode, sectionLabel, allSections) {
  const warnings = []
  const statements = parseStatements(rawCode)

  for (const stmt of statements) {
    const t = stmt.text

    // ASCIIOutput in Data section (performance concern on large datasources)
    if (sectionLabel === 'Data' && /\bASCIIOutput\s*\(/i.test(t)) {
      warnings.push({
        severity: 'warning',
        section: sectionLabel,
        line: stmt.startLine,
        message: 'ASCIIOutput in Data section may impact performance on large datasources. Consider logging in Epilog instead.',
      })
    }

    // Nested WHILE loops (fragile in TI)
    const whileCount = [...t.matchAll(/\bWHILE\s*\(/gi)].length
    if (whileCount > 1) {
      warnings.push({
        severity: 'warning',
        section: sectionLabel,
        line: stmt.startLine,
        message: 'Multiple WHILE keywords on one line — check for accidental nesting',
      })
    }

    // ItemReject / ItemSkip called with arguments (these take none)
    if (/\bItemReject\s*\(/.test(t)) {
      warnings.push({
        severity: 'error',
        section: sectionLabel,
        line: stmt.startLine,
        message: 'ItemReject does not accept arguments — use LogOutput before it to write a message',
      })
    }
    if (/\bItemSkip\s*\(/.test(t)) {
      warnings.push({
        severity: 'error',
        section: sectionLabel,
        line: stmt.startLine,
        message: 'ItemSkip does not accept arguments',
      })
    }
  }

  // Check for variable usage across sections — Prolog variables used in later sections
  // (we track assigned in Prolog, referenced in Data/Epilog)
  const prolog = allSections.PrologProcedure ?? ''
  if (sectionLabel !== 'Prolog') {
    const prologVars = new Set()
    const prologStmts = parseStatements(prolog)
    for (const s of prologStmts) {
      const m = s.text.match(/^\s*([a-zA-Z_]\w*)\s*=/)
      if (m) prologVars.add(m[1].toLowerCase())
    }
    // Check for variables used here that look like Prolog conventions (cXxx, nXxx, sXxx)
    for (const s of statements) {
      const used = s.text.match(/[a-zA-Z_]\w*/g) ?? []
      for (const v of used) {
        const lo = v.toLowerCase()
        if (!prologVars.has(lo)) {
          // Check for Bedrock naming conventions referenced but not initialized
          if (/^[cns]v?[a-z]/.test(v) && v.length > 2) {
            // Only flag if not also assigned in this section
            const assignedHere = assignedVarsForStatement(s.text)
            if (!assignedHere.has(lo)) {
              // Don't flag TM1 built-in functions
              if (!isBuiltInTM1Function(v)) {
                // We skip this warning for simplicity - too many false positives
              }
            }
          }
        }
      }
    }
  }

  return warnings
}

function assignedVarsForStatement(text) {
  const vars = new Set()
  const m = text.matchAll(/([a-zA-Z_]\w*)\s*=\s*[^=]/g)
  for (const match of m) {
    vars.add(match[1].toLowerCase())
  }
  return vars
}

function isBuiltInTM1Function(name) {
  const fns = new Set([
    'if', 'elseif', 'else', 'endif', 'while', 'end', 'processquit', 'processerror',
    'processbreak', 'itemreject', 'itemskip', 'asciioutput', 'textoutput', 'logoutput',
    'cellgetn', 'cellgets', 'cellputn', 'cellputs', 'cellisupdateable',
    'dimensionelementinsert', 'dimensionelementdelete', 'dimensionexists',
    'elementattrputn', 'elementattrputs', 'attrputn', 'attrputs',
    'subsetcreate', 'subsetdestroy', 'subsetexists', 'subsetelementinsert',
    'viewcreate', 'viewdestroy', 'viewexists', 'viewzeroout',
    'executeprocess', 'sleep', 'securityrefresh',
    'numbertostring', 'stringtonumber', 'char', 'code', 'fill', 'scan',
    'subst', 'long', 'trim', 'ucase', 'lcase',
    'dimnm', 'dimix', 'dimsiz', 'ellevel', 'elcomp', 'elcompn',
    'abs', 'round', 'int', 'mod', 'max', 'min', 'sqrt', 'rand',
    'now', 'today', 'date', 'time', 'timst', 'day', 'month', 'year', 'dayno',
    'getprocessname', 'getcurrentuser', 'getprocesserrorfiledirectory',
    'newdateformatter', 'parsedate',
  ])
  return fns.has(name.toLowerCase())
}

// ── Semicolon-checking (statements that should end with ;) ─────────────────────

function checkSemicolons(rawCode, sectionLabel) {
  const warnings = []
  const rawLines = rawCode.split('\n')
  let inStr = false
  let depth = 0

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    const trimmed = line.trim()
    if (isBlankLine(trimmed) || isCommentLine(trimmed)) continue

    // Reset for this line (accumulated from previous lines)
    for (let c = 0; c < line.length; c++) {
      const ch = line[c]
      if (ch === "'") {
        if (!inStr) { inStr = true }
        else if (c + 1 < line.length && line[c + 1] === "'") { c++ }
        else { inStr = false }
        continue
      }
      if (inStr) continue
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth--
    }

    // Line ends without semicolon and isn't a comment, IF, WHILE, ELSE, or #Region line
    const lastChar = line.trimEnd().slice(-1)
    if (lastChar !== ';' && lastChar !== '' && !isCommentLine(trimmed) && !isBlankLine(trimmed)) {
      // Block headers don't need semicolons
      if (IF_KW.test(trimmed) || WHILE_KW.test(trimmed) || ELSEIF_KW.test(trimmed)) continue
      if (/^\s*ELSE\s*$/i.test(trimmed)) continue
      if (/^\s*END(IF)?\s*$/i.test(trimmed)) continue
      if (trimmed.startsWith('#')) continue

      // If depth > 0, it's a continuation line — skip
      if (depth > 0 || inStr) continue

      warnings.push({
        severity: 'warning',
        section: sectionLabel,
        line: i + 1,
        message: 'Statement may be missing a semicolon',
      })
    }
  }

  return warnings
}

// ── Main export — validate all sections ────────────────────────────────────────

/**
 * Validate TI process code across all sections.
 * @param {{ PrologProcedure:string, MetaDataProcedure:string, DataProcedure:string, EpilogProcedure:string }} sections
 * @returns {{ section: string, line: number, severity: 'error'|'warning', message: string }[]}
 */
export function validateTICode(sections) {
  const results = []
  const allLabels = Object.keys(sections).map(k => sections[k])

  for (const [key, code] of Object.entries(sections)) {
    const label = SECTION_LABELS[key] ?? key
    if (!code) continue

    // Syntax errors
    results.push(...checkQuotes(code, label))
    const { errors: structErr } = checkStructure(code, label)
    results.push(...structErr)

    // Warnings
    results.push(...checkBestPractices(code, label, sections))
    results.push(...checkSemicolons(code, label))
  }

  return results
}
