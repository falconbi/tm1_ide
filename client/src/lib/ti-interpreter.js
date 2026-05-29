// ── TI Process Interpreter ───────────────────────────────────────────────────
// Client-side simulated TI execution engine.
// Parses TI code, evaluates expressions, tracks variables, supports breakpoints
// and watch variables. Returns debug events for the DebugPanel.
//
// Simulated functions return sentinel/placeholder values.
// DB operations (CellGetN/S, CellPutN/S) are NOT evaluated — they return null.

// ── Token types for TI ────────────────────────────────────────────────────────

const MULTI_CHAR_OPS = ['<>', '<=', '>=', '@=', '~=']
const SINGLE_CHAR_OPS = new Set(['=', '+', '-', '*', '/', '%', '&', '^', '|', '<', '>'])
const PUNCTUATION = new Set(['(', ')', '[', ']', '{', '}', ',', ';'])

// TM1 TI precedence levels (higher = binds tighter)
const PREC = {
  OR:           1,  // %
  AND:          2,  // &
  COMPARISON:   3,  // =, @=, <>, <, >, <=, >=, ~=
  CONCAT:       4,  // |
  ADDITIVE:     5,  // +, -
  MULTIPLIC:    6,  // *, /
  EXPONENT:     7,  // ^
  UNARY:        8,  // -num, ~expr
  CALL:         9,  // Func(arg)
}

function opPrec(op) {
  switch (op) {
    case '%': return PREC.OR
    case '&': return PREC.AND
    case '=': case '@=': case '<>': case '<': case '>': case '<=': case '>=': case '~=': return PREC.COMPARISON
    case '|': return PREC.CONCAT
    case '+': case '-': return PREC.ADDITIVE
    case '*': case '/': return PREC.MULTIPLIC
    case '^': return PREC.EXPONENT
    default:  return 0
  }
}

// ── Line tokenizer ─────────────────────────────────────────────────────────────

function tokenizeLine(line) {
  const tokens = []
  let i = 0
  const len = line.length

  while (i < len) {
    const ch = line[i]
    const start = i

    if (/\s/.test(ch)) {
      let val = ''
      while (i < len && /\s/.test(line[i])) val += line[i++]
      tokens.push({ type: 'ws', value: val, pos: start })
      continue
    }

    if (ch === '#') {
      tokens.push({ type: 'comment', value: line.slice(i), pos: start })
      break
    }

    if (ch === "'") {
      let val = "'"
      i++
      while (i < len) {
        if (line[i] === "'") {
          if (i + 1 < len && line[i + 1] === "'") { val += "''"; i += 2 }
          else { val += "'"; i++; break }
        } else { val += line[i]; i++ }
      }
      tokens.push({ type: 'string', value: val.slice(1, -1), raw: val, pos: start })
      continue
    }

    if (/\d/.test(ch) || (ch === '.' && i + 1 < len && /\d/.test(line[i + 1]))) {
      let val = ''
      while (i < len && /[\d.eE+\-]/.test(line[i])) val += line[i++]
      tokens.push({ type: 'number', value: parseFloat(val), pos: start })
      continue
    }

    const two = line.slice(i, i + 2)
    if (MULTI_CHAR_OPS.includes(two)) {
      tokens.push({ type: 'operator', value: two, pos: start })
      i += 2
      continue
    }

    if (SINGLE_CHAR_OPS.has(ch)) {
      tokens.push({ type: 'operator', value: ch, pos: start })
      i++
      continue
    }

    if (PUNCTUATION.has(ch)) {
      tokens.push({ type: 'punctuation', value: ch, pos: start })
      i++
      continue
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let val = ''
      while (i < len && /[a-zA-Z0-9_.]/.test(line[i])) val += line[i++]
      tokens.push({ type: 'identifier', value: val, pos: start })
      continue
    }

    tokens.push({ type: 'unknown', value: ch, pos: start })
    i++
  }

  return tokens.filter(t => t.type !== 'ws' && t.type !== 'comment')
}

// ── TI Expression Evaluator (Pratt parser) ─────────────────────────────────────

class ParseStream {
  constructor(tokens) { this.tokens = tokens; this.pos = 0 }
  peek()  { return this.tokens[this.pos] ?? null }
  next()  { return this.tokens[this.pos++] ?? null }
  done()  { return this.pos >= this.tokens.length }
}

const SIMULATED_FNS = {
  // ── String ───────────────────────────────────────────────────────────────
  subst:       (_, s, start, len)   => (s ?? '').slice((start ?? 1) - 1, ((start ?? 1) - 1) + (len ?? 0)),
  long:        (_, s)               => (s ?? '').length,
  trim:        (_, s)               => (s ?? '').trim(),
  ucase:       (_, s)               => (s ?? '').toUpperCase(),
  lcase:       (_, s)               => (s ?? '').toLowerCase(),
  scan:        (_, needle, hay)     => (hay ?? '').indexOf(needle ?? '') + 1,
  fill:        (_, ch, len)         => (ch ?? ' ').repeat(len ?? 0),
  code:        (_, s)               => (s ?? ' ').charCodeAt(0),
  char:        (_, n)               => String.fromCharCode(n ?? 32),
  numbr:       (_, s)               => parseFloat(s) || 0,
  str:         (_, val, width, dec) => { const n = Number(val ?? 0); return isNaN(n) ? '0' : n.toFixed(dec ?? 0).padStart(width ?? 1) },
  numbertostring: (_, n)            => String(n ?? 0),
  stringtonumber: (_, s)            => parseFloat(s) || 0,

  // ── Math ──────────────────────────────────────────────────────────────────
  abs:         (_, n)               => Math.abs(n ?? 0),
  int:         (_, n)               => Math.trunc(n ?? 0),
  round:       (_, n, d)            => { const p = Math.pow(10, d ?? 0); return Math.round((n ?? 0) * p) / p },
  roundp:      (_, n, p)            => { const m = Math.pow(10, p ?? 0); return Math.round((n ?? 0) / m) * m },
  mod:         (_, a, b)            => (a ?? 0) % (b ?? 1),
  max:         (_, a, b)            => Math.max(a ?? -Infinity, b ?? -Infinity),
  min:         (_, a, b)            => Math.min(a ?? Infinity, b ?? Infinity),
  sqrt:        (_, n)               => Math.sqrt(n ?? 0),
  rand:        (_)                  => Math.random(),
  sign:        (_, n)               => (n ?? 0) > 0 ? 1 : (n ?? 0) < 0 ? -1 : 0,
  exp:         (_, n)               => Math.exp(n ?? 0),
  ln:          (_, n)               => Math.log(n ?? 1),
  log:         (_, n)               => Math.log10(n ?? 1),
  sin:         (_, n)               => Math.sin(n ?? 0),
  cos:         (_, n)               => Math.cos(n ?? 0),
  tan:         (_, n)               => Math.tan(n ?? 0),
  asin:        (_, n)               => Math.asin(n ?? 0),
  acos:        (_, n)               => Math.acos(n ?? 0),
  atan:        (_, n)               => Math.atan(n ?? 0),
  power:       (_, b, e)            => Math.pow(b ?? 1, e ?? 1),

  // ── Date/Time ─────────────────────────────────────────────────────────────
  now:         ()                   => new Date().toISOString(),
  today:       ()                   => new Date().toISOString().slice(0, 10),
  date:        (_, y, m, d)         => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  time:        ()                   => new Date().toTimeString().slice(0, 8),
  timst:       (_, d, fmt)          => new Date().toISOString(),
  day:         (_, d)               => new Date().getDate(),
  month:       (_, d)               => new Date().getMonth() + 1,
  year:        (_, d)               => new Date().getFullYear(),
  dayno:       (_, d)               => new Date().getDate(),

  // ── Process control (simulated) ──────────────────────────────────────────
  getprocessname: ()                => 'SimulatedProcess',
  getcurrentuser: ()                 => 'SimulatedUser',
  getprocesserrorfiledirectory: ()   => '/tmp',
  sleep:        (_, ms)             => null,

  // ── Dimension / element (mock) ────────────────────────────────────────────
  dimsiz:       (_, dim)            => 10,
  dimnm:        (_, dim, idx)       => `Element_${idx ?? 1}`,
  dimix:        (_, dim, el)        => 1,
  ellev:        (_, dim, el)        => 0,
  elcompn:      (_, dim, el)        => 3,
  elcomp:       (_, dim, el, idx)   => `Child_${idx ?? 1}`,
  elisanc:      (_, dim, a, c)      => 0,
  elispar:      (_, dim, p, c)      => 0,
  etype:        (_, dim, el)        => 'N',
  tabdim:       (_, cube, pos)      => 'Dimension',
  elweight:     (_, dim, p, c)      => 1,

  // ── Cube operations (mock — return null sentinel) ────────────────────────
  cellgetn:     ()                  => null,
  cellgets:     ()                  => null,
  cellisupdateable: ()              => 1,

  // ── DB lookups (mock) ─────────────────────────────────────────────────────
  attrs:        (_, dim, el, attr)  => `Attr_${attr ?? 'x'}`,
  attrn:        (_, dim, el, attr)  => 0,
  attrsl:       (_, dim, el, attr, locale) => `Attr_${attr ?? 'x'}`,

  // ── Existence checks ──────────────────────────────────────────────────────
  dimensionexists:  () => 1,
  subsetexists:     () => 0,
  viewexists:       () => 0,
  cubeexists:       () => 1,

  // ── Misc ──────────────────────────────────────────────────────────────────
  isund:        (_, v)              => v === undefined || v === null || (typeof v === 'number' && isNaN(v)) ? 1 : 0,
  undef:        ()                  => '',

  // ── PAW newer functions ──────────────────────────────────────────────────
  newdateformatter: (_, fmt) => null,
  parsedate:     (_, fmt, str)      => 0,
}

function evaluateExpression(stream, vars) {
  if (stream.done()) return null

  let left = parsePrimary(stream, vars)

  while (!stream.done()) {
    const t = stream.peek()
    if (!t || t.type !== 'operator') break
    const prec = opPrec(t.value)
    if (prec === 0) break

    const op = stream.next()
    const right = parseExpr(stream, vars, prec)
    left = applyOp(left, op.value, right)
  }

  return left
}

function parseExpr(stream, vars, minPrec = 0) {
  let left = parsePrimary(stream, vars)

  while (!stream.done()) {
    const t = stream.peek()
    if (!t || t.type !== 'operator') break
    const prec = opPrec(t.value)
    if (prec <= minPrec) break

    const op = stream.next()
    const right = parseExpr(stream, vars, prec)
    left = applyOp(left, op.value, right)
  }

  return left
}

function parsePrimary(stream, vars) {
  if (stream.done()) return null
  const t = stream.peek()

  // Unary minus
  if (t.type === 'operator' && t.value === '-') {
    stream.next()
    return -parsePrimary(stream, vars)
  }

  // Unary NOT
  if (t.type === 'operator' && t.value === '~') {
    stream.next()
    return parsePrimary(stream, vars) ? 0 : 1
  }

  // Parenthesised expression
  if (t.type === 'punctuation' && t.value === '(') {
    stream.next()
    const val = evaluateExpression(stream, vars)
    if (stream.peek()?.value === ')') stream.next()
    return val
  }

  // Function call
  if (t.type === 'identifier') {
    const name = t.value.toLowerCase()
    const next = stream.tokens[stream.pos + 1]
    if (next?.type === 'punctuation' && next.value === '(') {
      stream.next() // consume name
      stream.next() // consume '('
      const args = []
      while (!stream.done() && stream.peek()?.value !== ')') {
        args.push(evaluateExpression(stream, vars))
        if (stream.peek()?.value === ',') stream.next()
      }
      if (stream.peek()?.value === ')') stream.next()

      const fn = SIMULATED_FNS[name]
      if (fn) return fn(...[vars, ...args])
      return `__FN_${name}(${args.map(a => String(a)).join(',')})__`
    }
  }

  // String literal
  if (t.type === 'string') {
    stream.next()
    return t.value
  }

  // Number literal
  if (t.type === 'number') {
    stream.next()
    return t.value
  }

  // Identifier (variable lookup — case-insensitive)
  if (t.type === 'identifier') {
    stream.next()
    const lo = t.value.toLowerCase()
    // Direct lookup first, then case-insensitive scan
    if (Object.prototype.hasOwnProperty.call(vars, lo)) return vars[lo]
    for (const k of Object.keys(vars)) {
      if (k.toLowerCase() === lo) return vars[k]
    }
    return 0
  }

  stream.next()
  return t.value
}

function applyOp(left, op, right) {
  if (right === '__CONTINUE__') return '__CONTINUE__'

  switch (op) {
    case '+': return (left ?? 0) + (right ?? 0)
    case '-': return (left ?? 0) - (right ?? 0)
    case '*': return (left ?? 0) * (right ?? 1)
    case '/': return (right === 0) ? 0 : (left ?? 0) / right
    case '^': return Math.pow(left ?? 0, right ?? 1)
    case '|': return String(left ?? '') + String(right ?? '')
    case '&': return (left ? 1 : 0) && (right ? 1 : 0) ? 1 : 0
    case '%': return (left ? 1 : 0) || (right ? 1 : 0) ? 1 : 0
    case '=': return left === right ? 1 : 0
    case '<>': case '~=': return left !== right ? 1 : 0
    case '<': return (left ?? 0) < (right ?? 0) ? 1 : 0
    case '>': return (left ?? 0) > (right ?? 0) ? 1 : 0
    case '<=': return (left ?? 0) <= (right ?? 0) ? 1 : 0
    case '>=': return (left ?? 0) >= (right ?? 0) ? 1 : 0
    case '@=': return String(left ?? '') === String(right ?? '') ? 1 : 0
    default: return left
  }
}

// ── Lookup variable value in scope (case-insensitive) ─────────────────────────

function lookupVar(vars, name) {
  const lo = name.toLowerCase()
  if (Object.prototype.hasOwnProperty.call(vars, lo)) return vars[lo]
  for (const k of Object.keys(vars)) {
    if (k.toLowerCase() === lo) return vars[k]
  }
  return undefined
}

// ── Statement types ───────────────────────────────────────────────────────────

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

      let condition = null
      if (type === 'if' || type === 'elseif' || type === 'while') {
        const condMatch = text.match(/\((.*)\)\s*;?$/i)
        if (condMatch) condition = condMatch[1]
      }

      let errorMsg = null
      if (type === 'error') {
        const errMatch = text.match(/^\s*ProcessError\s*\(\s*(.+?)\s*\)\s*;?$/i)
        if (errMatch) errorMsg = errMatch[1]
      }

      statements.push({
        type,
        text,
        line: startLine + 1,
        assignVar,
        assignExpr,
        condition,
        errorMsg,
      })
    }
  }

  return statements
}

function buildBlocks(statements) {
  let i = 0

  function parseBlock() {
    const items = []
    while (i < statements.length) {
      const stmt = statements[i]
      i++

      if (stmt.type === 'if') {
        const ifBlock = { type: 'if_block', line: stmt.line, condition: stmt.condition, branches: [], elseBranch: null }
        const ifBranch = { type: 'branch', condition: stmt.condition, body: parseBlock() }
        ifBlock.branches.push(ifBranch)

        // After parseBlock, i points at 'endif', 'elseif', or 'else' (backed up one position)
        while (i < statements.length && statements[i].type === 'elseif') {
          const eif = statements[i]
          i++
          ifBlock.branches.push({ type: 'branch', condition: eif.condition, body: parseBlock() })
        }

        if (i < statements.length && statements[i].type === 'else') {
          i++
          ifBlock.elseBranch = parseBlock()
        }

        // Consume the closing 'endif' that parseBlock backed up to
        if (i < statements.length && statements[i].type === 'endif') {
          i++
        }

        items.push(ifBlock)

      } else if (stmt.type === 'while') {
        const whileBlock = {
          type: 'while_block',
          line: stmt.line,
          condition: stmt.condition,
          body: parseBlock(),
        }
        // Consume the closing 'end' that parseBlock backed up to
        if (i < statements.length && statements[i].type === 'end') {
          i++
        }
        items.push(whileBlock)

      } else if (stmt.type === 'endif' || stmt.type === 'end' || stmt.type === 'else' || stmt.type === 'elseif') {
        // Back up so the caller (if/while handler) can check this keyword
        i--
        break

      } else {
        items.push(stmt)
      }
    }
    return items
  }

  return parseBlock()
}

// ── Execute blocks ────────────────────────────────────────────────────────────

function executeBlocks(blocks, ctx, bpLines, watches, initialVars = {}) {
  const events = []
  const vars = Object.assign({}, initialVars)

  function emitWatch(line) {
    for (const w of watches) {
      const val = lookupVar(vars, w.name)
      events.push({
        type: 'watch',
        name: w.name,
        section: ctx.section,
        line,
        value: val === undefined || val === null ? '(null)' : String(val),
      })
    }
  }

  function captureBreakpoint(line) {
    if (!bpLines.has(line)) return
    events.push({ type: 'breakpoint', section: ctx.section, line })
    emitWatch(line)
  }

  function evalExpr(exprText) {
    if (!exprText || exprText === '__CONTINUE__') return null
    try {
      const tokens = tokenizeLine(exprText)
      if (!tokens.length) return null
      const stream = new ParseStream(tokens)
      return evaluateExpression(stream, vars)
    } catch {
      return null
    }
  }

  function evalCond(condText) {
    const val = evalExpr(condText)
    return val !== 0 && val !== null && val !== false && val !== ''
  }

  function execItem(stmt) {
    if (typeof stmt === 'object' && stmt.type) {
      captureBreakpoint(stmt.line)

      switch (stmt.type) {
        case 'stmt': {
          if (stmt.assignVar && stmt.assignExpr) {
            const val = evalExpr(stmt.assignExpr)
            vars[stmt.assignVar.toLowerCase()] = val
          } else {
            evalExpr(stmt.text.replace(/;\s*$/, ''))
          }
          return null
        }
        case 'quit':
          return { action: 'quit' }
        case 'error':
          const errToks = tokenizeLine(stmt.errorMsg ?? '')
          const errStream = new ParseStream(errToks)
          const errMsg = evaluateExpression(errStream, vars)
          return { action: 'error', message: String(errMsg ?? 'ProcessError') }
        case 'break':
          return { action: 'break' }
        case 'reject':
          return { action: 'reject' }
        case 'skip':
          return { action: 'skip' }
        case 'if_block':
          return execIfBlock(stmt)
        case 'while_block':
          return execWhileBlock(stmt)
        default:
          return null
      }
    }
    return null
  }

  function execBody(body) {
    for (const item of body) {
      const result = execItem(item)
      if (result && (result.action === 'quit' || result.action === 'error' || result.action === 'break')) {
        return result
      }
    }
    return null
  }

  function execIfBlock(block) {
    for (const branch of block.branches) {
      if (evalCond(branch.condition)) {
        return execBody(branch.body)
      }
    }
    if (block.elseBranch) {
      return execBody(block.elseBranch)
    }
    return null
  }

  function execWhileBlock(block) {
    let iterations = 0
    const MAX_ITER = 10000
    while (evalCond(block.condition) && iterations < MAX_ITER) {
      const result = execBody(block.body)
      if (result) {
        if (result.action === 'quit' || result.action === 'error') return result
        if (result.action === 'break') break
      }
      iterations++
    }
    if (iterations >= MAX_ITER) {
      events.push({ type: 'log', message: `WHILE loop exceeded ${MAX_ITER} iterations — halted`, section: ctx.section, line: block.line })
    }
    return null
  }

  execBody(blocks)
  return { events, vars }
}

// ── Public API ─────────────────────────────────────────────────────────────────

const SECTION_NAMES = {
  PrologProcedure:   'Prolog',
  MetaDataProcedure: 'Metadata',
  DataProcedure:     'Data',
  EpilogProcedure:   'Epilog',
}

/**
 * Execute TI process code with breakpoints and watches.
 * Runs all four sections in sequence. Captures watch values at each breakpoint
 * and at the end of every section.
 */
export function executeTI(sections, breakpoints, watches, initialVars = {}) {
  const allEvents = []
  const globalVars = Object.assign({}, initialVars)

  for (const [key, label] of Object.entries(SECTION_NAMES)) {
    const code = sections[key] ?? ''
    if (!code.trim()) continue

    const stmts = parseStatements(code)
    const blocks = buildBlocks(stmts)
    const bpSet = breakpoints?.[key] ?? new Set()

    const { events, vars } = executeBlocks(blocks, { section: label }, bpSet, watches, globalVars)

    Object.assign(globalVars, vars)
    allEvents.push(...events)

    // Always emit section-end breakpoint + watch values
    allEvents.push({ type: 'breakpoint', section: label, line: null })
    for (const w of watches) {
      const val = lookupVar(globalVars, w.name)
      allEvents.push({
        type: 'watch',
        name: w.name,
        section: label,
        line: null,
        value: val === undefined || val === null ? '(null)' : String(val),
      })
    }
  }

  return { events: allEvents, vars: globalVars }
}

// ── Variable scanner — for watch dropdown / auto-detection ────────────────────

function guessType(expr, vars) {
  const t = expr.trim()
  if (/^-?\d+(\.\d*)?$/.test(t)) return 'number'
  if (/^'.*'$/.test(t)) return 'string'
  if (t.includes('|')) return 'string'
  if (/^(CellGetN|DimSiz|DimIx|ElLev|ElCompN|ElWeight|Numbr|Str\b|Int|Round|Mod|Max|Min|Abs|Sign|Rand|Exp|Log|Ln|Sqrt|Power|Month|Day|Year|DayNo|Long|Scan|Code|IsUnd|ProcessExitNormal|NewDateFormatter|ParseDate|Undef)\s*\(/i.test(t)) return 'number'
  if (/^(CellGetS|DimNm|ElComp|UCase|LCase|Trim|SubSt|Fill|Char|NumberToString|TimSt|Now|Today|Date|Time|AttrS|AttrSL|GetProcessName|GetCurrentUser|TabDim|GetProcessErrorFileDirectory|Undef)\s*\(/i.test(t)) return 'string'
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
 * @param {{ PrologProcedure, MetaDataProcedure, DataProcedure, EpilogProcedure }} sections
 * @param {Array} parameters - Process parameter definitions [{Name, Type, Value, Prompt}]
 * @returns {Array<{name:string, type:'number'|'string', section:string, line:number|null}>}
 */
export function scanVariables(sections, parameters) {
  const vars = new Map()

  const add = (name, type, section, line) => {
    const lo = name.toLowerCase()
    if (lo && !vars.has(lo)) {
      vars.set(lo, { name, type, section, line })
    }
  }

  // Parameters first (they're always defined)
  for (const p of (parameters ?? [])) {
    if (p.Name) add(p.Name, p.Type === 1 ? 'number' : 'string', 'Param', null)
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
