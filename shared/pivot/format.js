/**
 * Shared pivot · format — TM1 number formats ('#,##0.00', '0.0%', '(#,##0)', '@' text…)
 * and TM1's FormattedValue type prefix. The single copy: the IDE's
 * tm1-rule-parser re-exports these. Pure, no imports.
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
