import { formatRules } from '../formatters/rules-formatter.js'
import { loadSettings as loadFormatSettings } from '../formatters/settings.js'
import { getNamingMap } from '../formatters/naming.js'

// The static-version guard at the top of every rule file (IF(ELPAR(...) @= 'Non-Calculating', STET,
// CONTINUE)). TM1's trace lists it once for every cube the calculation touches; it explains nothing.
export const GUARD_RX = /IF\s*\(\s*ELPAR\s*\([^)]*\)\s*@=\s*'[^']*'\s*,\s*STET\s*,\s*CONTINUE\s*\)/i
export const isGuardStatement = s => GUARD_RX.test(s)

// 366.666666 -> 366.67, 10833.33333 -> 10,833.33; strings unchanged
export const fmtTraceValue = v => {
    if (v == null || v === '') return v
    const n = typeof v === 'number' ? v : (/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(String(v).trim()) ? Number(v) : NaN)
    if (Number.isNaN(n)) return String(v)
    return n.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })
}

// A rule statement laid out with the IDE's TM1 Structured formatter (DB arguments on their own lines)
export const formatStatement = stmt => {
    try {
        const { map } = getNamingMap()
        return formatRules(stmt, { ...loadFormatSettings().rules, expressionFormatter: 'tm1-structured' }, map)
    } catch { return stmt }
}
