// ── TI variable scanner ──────────────────────────────────────────────────────
// ProcessEditor uses this to populate the debug watch dropdown. There is no
// client-side TI executor: breakpoints and watches are served by the real TM1
// debug process, not simulated here.

const SECTION_NAMES = {
  PrologProcedure:   'Prolog',
  MetadataProcedure: 'Metadata',
  DataProcedure:     'Data',
  EpilogProcedure:   'Epilog',
}

const IF_RE     = /^\s*IF\s*\(/i
const WHILE_RE  = /^\s*WHILE\s*\(/i
const END_RE    = /^\s*END\s*;?$/i
const ENDIF_RE  = /^\s*ENDIF\s*;?$/i
const ELSE_RE   = /^\s*ELSE\s*;?$/i
const ELSEIF_RE = /^\s*ELSEIF\s*\(/i
const PROCESSQUIT_RE  = /^\s*ProcessQuit\s*;?\s*$/i
const PROCESSERROR_RE = /^\s*ProcessError\s*\(/i
const PROCESSBREAK_RE = /^\s*ProcessBreak\s*;?\s*$/i
const ITEMREJECT_RE   = /^\s*ItemReject\s*;?\s*$/i
const ITEMSKIP_RE     = /^\s*ItemSkip\s*;?\s*$/i
const ASSIGN_RE       = /^\s*([a-zA-Z_][\w.]*)\s*=\s*/i

function classifyStatement(text) {
  if (IF_RE.test(text))     return 'if'
  if (WHILE_RE.test(text))  return 'while'
  if (ENDIF_RE.test(text))  return 'endif'
  if (END_RE.test(text))    return 'end'
  if (ELSEIF_RE.test(text)) return 'elseif'
  if (ELSE_RE.test(text))   return 'else'
  if (PROCESSQUIT_RE.test(text))  return 'quit'
  if (PROCESSERROR_RE.test(text)) return 'error'
  if (PROCESSBREAK_RE.test(text)) return 'break'
  if (ITEMREJECT_RE.test(text))   return 'reject'
  if (ITEMSKIP_RE.test(text))     return 'skip'
  return 'stmt'
}

function parseStatements(rawCode) {
  const rawLines = rawCode.split('\n')
  const statements = []
  let i = 0

  while (i < rawLines.length) {
    const trimmed = rawLines[i].trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) { i++; continue }

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
          if (!inStr) inStr = true
          else if (c + 1 < lt.length && lt[c + 1] === "'") c++
          else inStr = false
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
      const text = parts.join(' ')
      const type = classifyStatement(text)
      let assignVar = null
      let assignExpr = null

      if (type === 'stmt' || type === 'quit' || type === 'error' || type === 'break' || type === 'reject' || type === 'skip') {
        const assignMatch = text.match(ASSIGN_RE)
        if (assignMatch) {
          assignVar = assignMatch[1]
          assignExpr = text.slice(text.indexOf('=') + 1).replace(/;\s*$/, '').trim()
        }
      }

      statements.push({ type, text, line: startLine + 1, assignVar, assignExpr })
    }
  }

  return statements
}

function guessType(expr, vars) {
  const t = expr.trim()
  if (/^-?\d+(\.\d*)?$/.test(t)) return 'number'
  if (/^'.*'$/.test(t)) return 'string'
  if (t.includes('|')) return 'string'
  if (/^(CellGetN|DimSiz|DimIx|ElLev|ElCompN|ElWeight|Numbr|Str\b|Int|Round|Mod|Max|Min|Abs|Sign|Rand|Exp|Log|Ln|Sqrt|Month|Day|Year|DayNo|Long|Scan|Code|IsUnd|ProcessExitNormal|NewDateFormatter|ParseDate|Undef|GetJobStatus|HttpResponseGetStatusCode)\s*\(/i.test(t)) return 'number'
  if (/^(CellGetS|DimNm|ElComp|Upper|Lower|Trim|SubSt|Fill|Char|NumberToString|TimSt|Now|Today|Date|Time|AttrS|AttrL|GetProcessName|TabDim|GetProcessErrorFileDirectory|Undef|HttpResponseGetBody|HttpResponseGetHeader)\s*\(/i.test(t)) return 'string'
  if (/[&%~]/.test(t) && !t.includes('|')) return 'number'
  const firstWord = t.match(/^(\w[\w.]*)/)
  if (firstWord) {
    const lo = firstWord[1].toLowerCase()
    if (vars && lo in vars) return vars[lo].type
  }
  return 'number'
}

/**
 * Scan all sections for variables (assignments + parameters).
 * @param {{ PrologProcedure, MetadataProcedure, DataProcedure, EpilogProcedure }} sections
 * @param {Array} parameters - Process parameter definitions [{Name, Type, Value, Prompt}]
 * @returns {Array<{name:string, type:'number'|'string', section:string, line:number|null}>}
 */
export function scanVariables(sections, parameters, processVariables = []) {
  const vars = new Map()

  const add = (name, type, section, line) => {
    const lo = name.toLowerCase()
    if (lo && !vars.has(lo)) {
      vars.set(lo, { name, type, section, line })
    }
  }

  for (const p of (parameters ?? [])) {
    if (p.Name) add(p.Name, p.Type === 1 ? 'number' : 'string', 'Param', null)
  }

  for (const v of (processVariables ?? [])) {
    if (!v?.Name) continue
    const type = v.Type === 1 || String(v.Type).toLowerCase() === 'numeric' ? 'number' : 'string'
    add(v.Name, type, 'Source', null)
  }

  for (const [key, label] of Object.entries(SECTION_NAMES)) {
    const code = sections[key] ?? ''
    if (!code.trim()) continue
    const stmts = parseStatements(code)
    for (const stmt of stmts) {
      if (stmt.assignVar) {
        add(stmt.assignVar, guessType(stmt.assignExpr ?? '', vars), label, stmt.line)
      }
    }
  }

  return Array.from(vars.values())
}
