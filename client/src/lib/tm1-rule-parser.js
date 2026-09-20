/**
 * tm1-rule-parser — pure helpers for parsing TM1 rule statements and format
 * strings. Extracted from ViewEditor so they're unit-testable and reusable.
 * No React, no aliased imports — plain functions.
 */

// TM1 REST API sometimes prefixes FormattedValue with a single-char type indicator, e.g. "c:12345"
export function stripTm1TypePrefix(fv) {
    if (typeof fv === 'string' && fv.length > 2 && fv[1] === ':') return fv.slice(2)
    return fv
}

export function applyTm1Format(value, fmt) {
    if (!fmt || fmt === 'General') return value != null ? String(value) : ''
    if (typeof fmt !== 'string') return value != null ? String(value) : ''
    if (/^[a-z]:/.test(fmt)) fmt = fmt.slice(2)  // TM1 single-letter type prefix (c:, b:, n: etc) — strip
    if (fmt.startsWith('@')) return String(value ?? '')
    if (typeof value !== 'number') return String(value ?? '')
    const parts = fmt.split(';')
    const activeFmt = value < 0 && parts[1] ? parts[1] : parts[0]
    const absVal = Math.abs(value)
    // Accounting-style parens: either a negative section that has parens, or a
    // single-section format wrapped in parens (e.g. "(0.00)").
    const useParens = value < 0 && (parts[1] ? parts[1].includes('(') : /^\(.*\)$/.test(activeFmt.trim()))
    // Strip outer parens from negative section before extracting prefix/number pattern
    const cleanFmt = useParens ? activeFmt.replace(/^\(/, '').replace(/\)$/, '') : activeFmt
    const pctDiv = cleanFmt.includes('%/')
    const isPct = cleanFmt.includes('%')
    const adjustedVal = isPct && pctDiv ? absVal / 100 : absVal
    const num = isPct ? adjustedVal * 100 : adjustedVal
    const useGrouping = cleanFmt.includes(',')
    const decMatch = cleanFmt.replace(/\[[^\]]*\]/g, '').match(/\.([0#]+)/)
    const dec = decMatch ? decMatch[1].length : 0
    // Prefix = leading literal text that isn't part of the number pattern.
    // Digits must NOT be treated as prefix — "1,000" is a grouping format
    // (no decimals), not a literal "1" prefix; excluding digits prevents
    // applyTm1Format(0, "1,000") from rendering "10".
    const prefixMatch = cleanFmt.match(/^([^#,0-9.@%[\\]*)/)
    const prefix = prefixMatch?.[1] ?? ''
    const formatted = num.toLocaleString('en-US', { useGrouping, minimumFractionDigits: dec, maximumFractionDigits: dec })
    let out = prefix + formatted + (isPct ? '%' : '')
    if (useParens) return '(' + out + ')'
    if (value < 0 && !parts[1]) return '-' + out
    return out
}

// ── Rule statement parsing ─────────────────────────────────────────────────────

const TRACKED_FUNCS = new Set(['DB', 'ATTRN', 'ATTRS', 'DIMIX', 'DIMSIZ', 'TABDIM', 'ELISANC'])

export function extractRuleCalls(stmt) {
    const calls = []
    const re = /\b([A-Z][A-Z0-9]*)\s*\(/gi
    let match
    while ((match = re.exec(stmt)) !== null) {
        const funcName = match[1].toUpperCase()
        if (!TRACKED_FUNCS.has(funcName)) continue
        const open = match.index + match[0].length - 1
        let depth = 1, i = open + 1, inStr = false, strChar = ''
        while (i < stmt.length && depth > 0) {
            const c = stmt[i]
            if (inStr) { if (c === strChar) inStr = false }
            else if (c === "'" || c === '"') { inStr = true; strChar = c }
            else if (c === '(') depth++
            else if (c === ')') depth--
            i++
        }
        calls.push({ funcName, argsStr: stmt.slice(open + 1, i - 1), start: match.index, end: i })
    }
    return calls
}

export function splitArgs(argsStr) {
    const args = []
    let cur = '', depth = 0, inStr = false, strChar = ''
    for (const c of argsStr) {
        if (inStr) { cur += c; if (c === strChar) inStr = false }
        else if (c === "'" || c === '"') { inStr = true; strChar = c; cur += c }
        else if (c === '(') { depth++; cur += c }
        else if (c === ')') { depth--; cur += c }
        else if (c === ',' && depth === 0) { args.push(cur.trim()); cur = '' }
        else cur += c
    }
    if (cur.trim()) args.push(cur.trim())
    return args
}

export function resolveArg(arg, dimElemPairs) {
    if ((arg.startsWith("'") && arg.endsWith("'")) || (arg.startsWith('"') && arg.endsWith('"')))
        return arg.slice(1, -1)
    if (arg.startsWith('!')) {
        const dimName = arg.slice(1).split(/[\\.]/).pop()
        return dimElemPairs.find(p => p.dim.toLowerCase() === dimName.toLowerCase())?.element ?? arg
    }
    return arg
}

// Index of the ')' that closes the '(' at openIdx (quote-aware).
export function matchingCloseParen(s, openIdx) {
    let depth = 1, i = openIdx + 1, inStr = false, strChar = ''
    while (i < s.length && depth > 0) {
        const c = s[i]
        if (inStr) { if (c === strChar) inStr = false }
        else if (c === "'" || c === '"') { inStr = true; strChar = c }
        else if (c === '(') depth++
        else if (c === ')') depth--
        i++
    }
    return i - 1
}

// Split an expression on + - * / \ at paren-depth 0, preserving order.
// Returns [{ type: 'op', value } | { type: 'operand', value }].
export function splitTopLevelOps(s) {
    const out = []
    let cur = '', depth = 0, inStr = false, strChar = ''
    for (const c of s) {
        if (inStr) { cur += c; if (c === strChar) inStr = false }
        else if (c === "'" || c === '"') { inStr = true; strChar = c; cur += c }
        else if (c === '(') { depth++; cur += c }
        else if (c === ')') { depth--; cur += c }
        else if (depth === 0 && (c === '+' || c === '-' || c === '*' || c === '/' || c === '\\')) {
            if (cur.trim()) out.push({ type: 'operand', value: cur.trim() })
            out.push({ type: 'op', value: c })
            cur = ''
        }
        else cur += c
    }
    if (cur.trim()) out.push({ type: 'operand', value: cur.trim() })
    return out
}

// RHS of a rule statement: after the assignment '=', with the N:/C:/S: area
// qualifier and trailing ';' stripped, so the expression parser sees IF(...).
export function rhsOf(stmt) {
    const eq = stmt.indexOf('=')
    let rhs = eq >= 0 ? stmt.slice(eq + 1).trim() : stmt.trim()
    rhs = rhs.replace(/^[NCS]\d*\s*:\s*/, '')
    rhs = rhs.replace(/;\s*$/, '')
    return rhs
}

// Split a comparison like `expr @= 'Contractor'` at depth 0 → [left, op, right].
export function splitComparison(s) {
    let depth = 0, inStr = false, strChar = ''
    for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (inStr) { if (c === strChar) inStr = false; continue }
        if (c === "'" || c === '"') { inStr = true; strChar = c; continue }
        if (c === '(') { depth++; continue }
        if (c === ')') { depth--; continue }
        if (depth !== 0) continue
        const rest = s.slice(i)
        const m = rest.match(/^(@=|<=|>=|=|<>|<|>)/)
        if (m) {
            return [s.slice(0, i).trim(), m[1], s.slice(i + m[1].length).trim()]
        }
    }
    return null
}