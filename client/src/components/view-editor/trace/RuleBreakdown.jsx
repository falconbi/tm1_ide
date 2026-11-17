import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useTraceCellCalc, elementAttrsQuery, cubeDimensionsQuery } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import { extractRuleCalls, splitArgs, resolveArg, matchingCloseParen, splitTopLevelOps, rhsOf, splitComparison } from '@/lib/tm1-rule-parser'
import { isGuardStatement, fmtTraceValue, formatStatement } from '@/lib/view-editor/trace-format.js'

function RuleBreakdown({ server, statements: allStatements, dimElemPairs, cube, onDrill }) {
    // the statements that actually calculate the cell: no guards, no repeats
    const { statements, guardCount } = useMemo(() => {
        const seen = new Set(), real = []
        let guards = 0
        for (const st of allStatements) {
            if (isGuardStatement(st)) { guards++; continue }
            const k = st.replace(/\s+/g, ' ').trim()
            if (!seen.has(k)) { seen.add(k); real.push(st) }
        }
        return { statements: real, guardCount: guards }
    }, [allStatements])
    const [attrValues,   setAttrValues]   = useState({})
    const [loadingAttrs, setLoadingAttrs] = useState(false)

    const allCalls = useMemo(() => statements.flatMap(s => extractRuleCalls(s)), [statements])

    useEffect(() => {
        const attrCalls = allCalls.filter(c => c.funcName === 'ATTRN' || c.funcName === 'ATTRS')
        if (!attrCalls.length) return
        const toFetch = new Map()
        for (const call of attrCalls) {
            const args = splitArgs(call.argsStr)
            if (args.length < 2) continue
            const dim  = resolveArg(args[0], dimElemPairs)
            const elem = resolveArg(args[1], dimElemPairs)
            const key  = `${dim}::${elem}`
            if (!toFetch.has(key)) toFetch.set(key, { dim, elem })
        }
        if (!toFetch.size) return
        setLoadingAttrs(true)
        Promise.all([...toFetch.entries()].map(([key, { dim, elem }]) =>
            queryClient.fetchQuery(elementAttrsQuery(server, dim, elem)).then(v => [key, v]).catch(() => [key, {}])
        )).then(results => {
            const map = {}
            for (const [key, vals] of results) map[key] = vals
            setAttrValues(map)
            setLoadingAttrs(false)
        })
    }, [allCalls, server, dimElemPairs, queryClient])

    // Resolve an ATTRS('Dim', elem, 'Attr') expression to its fetched attribute
    // value; element arg may be a quoted name, a !Dim ref, or another expr.
    const attrArgRx = /^ATTRS\(\s*'([^']+)'\s*,\s*([^,]+)\s*,\s*'([^']+)'\s*\)$/i
    const resolveAttrArg = (arg) => {
        const m = arg.match(attrArgRx)
        if (!m) return null
        const elem = resolveArg(m[2].trim(), dimElemPairs)
        const value = attrValues[`${m[1]}::${elem}`]?.[m[3]]
        return value != null ? { value: String(value), source: arg } : null
    }

    // Cache for fetched cell values (DB targets + relative refs) and cube dims.
    const valCache = useRef({})
    const dimCache = useRef({})
    const [, bumpVal] = useReducer(x => x + 1, 0)
    const traceCell = useTraceCellCalc()
    const queryClient = useQueryClient()

    const fetchCellValue = useCallback(async (targetCube, pairs) => {
        const key = `${targetCube}::${pairs.map(p => p.element).join('|')}`
        if (valCache.current[key] !== undefined) return valCache.current[key]
        try {
            const d = await traceCell.mutateAsync({ server, cube: targetCube, dimElemPairs: pairs })
            valCache.current[key] = d?.Value
            bumpVal()
            return d?.Value
        } catch { return undefined }
    }, [server, traceCell])

    const getCubeDims = useCallback(async (cubeName) => {
        if (dimCache.current[cubeName]) return dimCache.current[cubeName]
        try {
            const dims = await queryClient.fetchQuery(cubeDimensionsQuery(server, cubeName))
            dimCache.current[cubeName] = dims
            return dims
        } catch { return [] }
    }, [server, queryClient])

    // Attribute values by dimension + element, fetched once.
    const attrCache = useRef({})
    const fetchAttrs = useCallback(async (dim, elem) => {
        const key = `${dim}::${elem}`
        if (attrCache.current[key]) return attrCache.current[key]
        try {
            attrCache.current[key] = await queryClient.fetchQuery(elementAttrsQuery(server, dim, elem))
        } catch { attrCache.current[key] = {} }
        return attrCache.current[key]
    }, [server, queryClient])

    // Work out what a coordinate expression comes to for this cell: a 'literal', a !Dim reference,
    // ATTRS(...), DB(...) or IF(cond, a, b) -- nested as deep as the rule goes. { value, source }
    // where source is the expression it came from (null for a plain name).
    const resolveArgAsync = useCallback(async function resolveArgAsync(arg) {
        const a = (arg ?? '').trim()
        const lit = a.match(/^'([^']*)'$/)
        if (lit) return { value: lit[1], source: null, how: 'named in the rule' }
        const inner = () => splitArgs(a.slice(a.indexOf('(') + 1, a.lastIndexOf(')')))
        if (/^ATTRS\s*\(/i.test(a)) {
            const x = inner()
            const dim = resolveArg(x[0] ?? '', dimElemPairs)
            const elem = (await resolveArgAsync(x[1] ?? '')).value
            const vals = await fetchAttrs(dim, elem)
            const attrName = (x[2] ?? '').replace(/^['"]|['"]$/g, '')
            const v = vals?.[attrName]
            return { value: v == null ? '' : String(v), source: a, how: `attribute ${attrName} of ${elem}` }
        }
        if (/^DB\s*\(/i.test(a)) {
            const x = inner()
            const cubeName = (x[0] ?? '').replace(/^['"]|['"]$/g, '')
            const coords = (await Promise.all(x.slice(1).map(resolveArgAsync))).map(r => r.value)
            const dims = await getCubeDims(cubeName)
            const v = await fetchCellValue(cubeName, dims.map((d, i) => ({ dim: d, element: coords[i] })).filter(p => p.element))
            return { value: v == null ? '' : String(v), source: a, how: `${cubeName.replace(/^WFP |^LAB /, '')} · ${coords[coords.length - 1] ?? ''}`, drill: { cube: cubeName, coords } }
        }
        if (/^IF\s*\(/i.test(a)) {
            const open = a.indexOf('('), close = matchingCloseParen(a, open)
            const x = splitArgs(a.slice(open + 1, close))
            const c = splitComparison((x[0] ?? '').trim())
            if (c && c[1] === '@=') {
                const l = (await resolveArgAsync(c[0])).value, r = (await resolveArgAsync(c[2])).value
                const isTrue = String(l).trim().toLowerCase() === String(r).trim().toLowerCase()
                const pick = await resolveArgAsync(isTrue ? x[1] : x[2])
                // the common "use X unless it's blank" fallback reads better said plainly
                const blankTest = /^''$/.test((c[2] ?? '').trim())
                const why = blankTest ? (isTrue ? 'blank, so the fallback is used' : 'set, so used') : `condition ${isTrue ? 'true' : 'false'}`
                return { value: pick.value, source: a, how: `${pick.how ?? ''} (${why})`.trim(), drill: pick.drill }
            }
            return { value: '', source: a }
        }
        return { value: resolveArg(a, dimElemPairs), source: null, how: a.startsWith('!') ? 'this cell' : '' }
    }, [dimElemPairs, fetchAttrs, getCubeDims, fetchCellValue])

    // DB operand text -> its resolved coordinates [{ value, source }]
    const coordCache = useRef({})

    // Re-parse statements into a fetchable operand list whenever they change.
    const operandPlan = useMemo(() => {
        const plan = []
        for (const stmt of statements) {
            // LHS element of the assignment (e.g. 'Employer Pension') — used to
            // resolve relative ['Base'] refs (swap the same dim's element).
            const lhs = stmt.match(/\[\s*['"]([^'"]+)['"]\s*\]\s*=/)?.[1] ?? null
            const rhs = rhsOf(stmt)
            // Collect DB(...) / ATTRS(...) / ['Elem'] operands that need a value
            const visit = (expr) => {
                const s = expr.trim()
                const ifm = s.match(/^IF\s*\(/i)
                if (ifm) {
                    const open = s.indexOf('(')
                    const close = matchingCloseParen(s, open)
                    for (const arg of splitArgs(s.slice(open + 1, close))) visit(arg)
                    return
                }
                // split on operators FIRST: ['Base'] * DB(...) is two operands, not one reference
                const parts = splitTopLevelOps(s)
                if (parts.length > 1) { for (const t of parts) if (t.type === 'operand') visit(t.value); return }
                if (s.startsWith('[')) { plan.push({ kind: 'ref', element: (s.match(/\[['"]([^'"]+)['"]\]/) ?? [])[1] ?? s, lhs }); return }
                if (/^DB\s*\(/i.test(s)) { plan.push({ kind: 'db', text: s, lhs }); return }
                // a leaf with nothing to fetch -- stop (else infinite recursion)
            }
            visit(rhs)
        }
        return plan
    }, [statements])

    // Resolve a relative ['Elem'] ref: swap the element on the dimension that
    // currently holds the LHS measure element (fallback: last dimension).
    const relativeRefPairs = useCallback((refElement, lhsElement) => {
        const idx = dimElemPairs.findIndex(p => p.element === lhsElement)
        const target = idx >= 0 ? idx : dimElemPairs.length - 1
        return dimElemPairs.map((p, i) => i === target ? { dim: p.dim, element: refElement } : p)
    }, [dimElemPairs])

    // Fetch the values for DB targets and relative refs. Re-runs when attribute
    // values arrive so DB() coordinates that use ATTRS() resolve to real names
    // (the first pass uses raw ATTRS text and its cache keys never match).
    useEffect(() => {
        (async () => {
            for (const op of operandPlan) {
                if (op.kind === 'db') {
                    const inner = op.text.slice(op.text.indexOf('(') + 1, op.text.lastIndexOf(')'))
                    const args = splitArgs(inner)
                    const cubeName = (args[0] ?? '').replace(/^['"]|['"]$/g, '')
                    const resolved = await Promise.all(args.slice(1).map(resolveArgAsync))
                    coordCache.current[op.text] = resolved
                    const coords = resolved.map(r => r.value)
                    const dims = await getCubeDims(cubeName)
                    const pairs = dims.map((d, i) => ({ dim: d, element: coords[i] })).filter(p => p.element)
                    await fetchCellValue(cubeName, pairs)
                    bumpVal()
                } else if (op.kind === 'ref') {
                    await fetchCellValue(cube, relativeRefPairs(op.element, op.lhs))
                }
            }
        })()
    }, [operandPlan, getCubeDims, fetchCellValue, relativeRefPairs, resolveArgAsync]) // eslint-disable-line

    // ── Rendering ──────────────────────────────────────────────────────────────

    const renderOperand = (expr, lhs) => {
        const s = expr.trim()
        const dbm = s.match(/^DB\s*\(/i)
        if (dbm) {
            const inner = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'))
            const args = splitArgs(inner)
            const cubeName = (args[0] ?? '').replace(/^['"]|['"]$/g, '')
            const resolvedOps = coordCache.current[s] ?? args.slice(1).map(a => {
                const r = resolveAttrArg(a)
                return r ? { value: r.value, source: r.source } : { value: resolveArg(a, dimElemPairs), source: null }
            })
            const coords   = resolvedOps.map(r => r.value)
            const derived  = resolvedOps.map(r => r.source ? { value: r.value, source: r.source } : null)
            const key = `${cubeName}::${coords.join('|')}`
            const value = valCache.current[key]
            const dims = dimCache.current[cubeName] ?? []
            // Last dimension is the measure in this model — mark it
            const measureIdx = dims.length - 1
            const drillable = onDrill && coords.length > 0 && coords.every(c => c && !c.includes('('))
            return (
                <div
                    onClick={drillable ? () => onDrill(cubeName, coords, derived) : undefined}
                    className={cn('border border-amber-500/20 bg-amber-500/5 rounded px-3 py-2 space-y-1 transition-colors',
                        drillable && 'cursor-pointer hover:bg-amber-500/10')}
                >
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="badge bg-amber-500/20 text-amber-400 font-mono">DB</span>
                        <span className="text-[11px] font-medium">{cubeName}</span>
                        <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">{value != null ? fmtTraceValue(value) : (valCache.current[key] === undefined ? '…' : '—')}</span>
                        {drillable && <ChevronRight size={10} className="text-muted-foreground/50 shrink-0" />}
                    </div>
                    {coordCache.current[s] ? (
                        <div className="grid gap-x-2 gap-y-0.5 text-[10px]" style={{ gridTemplateColumns: 'auto auto 1fr' }} title={coords.join(' · ')}>
                            {resolvedOps.map((r, i) => (
                                <div key={i} className="contents">
                                    <span className="text-muted-foreground/70 truncate">{i === measureIdx ? 'Measure' : (dims[i] ?? '').replace(/^WFP |^LAB /, '')}</span>
                                    <span className={cn('font-mono', i === measureIdx ? 'text-foreground font-semibold' : 'text-foreground')}>{r.value || '—'}</span>
                                    {r.drill && onDrill
                                        ? <button type="button" onClick={e => { e.stopPropagation(); onDrill(r.drill.cube, r.drill.coords) }}
                                            className="text-left text-muted-foreground hover:text-primary truncate" title="Trace this value">{r.how} ›</button>
                                        : <span className="text-muted-foreground truncate">{r.how}</span>}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="font-mono text-[10px] text-muted-foreground">working out the lookup…</div>
                    )}
                </div>
            )
        }
        const am = s.match(/^ATTRS\s*\(/i)
        if (am) {
            const inner = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'))
            const args = splitArgs(inner)
            const dim  = resolveArg(args[0] ?? '', dimElemPairs)
            const elem = resolveArg(args[1] ?? '', dimElemPairs)
            const attr = (args[2] ?? '').replace(/^['"]|['"]$/g, '')
            const value = attrValues[`${dim}::${elem}`]?.[attr] ?? (loadingAttrs ? '…' : '—')
            return (
                <div className="border border-blue-500/20 bg-blue-500/5 rounded px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="badge bg-blue-500/20 text-blue-400 font-mono">ATTRS</span>
                        <span className="text-[11px] font-medium">{dim}</span>
                        <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">{value}</span>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">{elem} · {attr}</div>
                </div>
            )
        }
        const rm = s.match(/^\[['"]?([^'"\]]+)['"]?\]$/)
        if (rm) {
            const pairs = relativeRefPairs(rm[1], lhs)
            const key = `${cube}::${pairs.map(p => p.element).join('|')}`
            const value = key ? valCache.current[key] : undefined
            return (
                <div className="border border-border/50 bg-muted/20 rounded px-3 py-2">
                    <div className="flex items-center gap-2">
                        <span className="badge bg-muted text-muted-foreground font-mono text-[9px]">ref</span>
                        <span className="font-mono text-[11px] font-medium">[{rm[1]}]</span>
                        <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">{value != null ? fmtTraceValue(value) : (valCache.current[key] === undefined ? '…' : '—')}</span>
                    </div>
                </div>
            )
        }
        const num = Number(s.replace(/[(),]/g, ''))
        if (!Number.isNaN(num) && s.trim() !== '') {
            return <div className="border border-border/50 bg-muted/20 rounded px-3 py-2"><span className="font-mono text-[11px] font-semibold tabular-nums">{s.trim()}</span></div>
        }
        return <div className="border border-border/50 bg-muted/20 rounded px-3 py-2"><span className="font-mono text-[10px] text-muted-foreground">{s}</span></div>
    }

    // the number an operand comes to, once fetched (null if not known yet)
    const operandNumber = (expr, lhs) => {
        const t = expr.trim()
        const num = Number(t); if (t !== '' && !Number.isNaN(num)) return num
        const rm = t.match(/^\[['"]?([^'"\]]+)['"]?\]$/)
        let key = null
        if (rm) key = `${cube}::${relativeRefPairs(rm[1], lhs).map(p => p.element).join('|')}`
        else if (/^DB\s*\(/i.test(t) && coordCache.current[t]) {
            const cubeName = (splitArgs(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')')))[0] ?? '').replace(/^['"]|['"]$/g, '')
            key = `${cubeName}::${coordCache.current[t].map(r => r.value).filter(Boolean).join('|')}`
        }
        const v = key ? valCache.current[key] : undefined
        return v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)
    }
    const literalOf = (x) => { const m = x.trim().match(/^'([^']*)'$/); return m ? m[1] : null }
    const valueOfSide = (x) => {
        const lit = literalOf(x); if (lit != null) return lit
        const am = x.trim().match(/^ATTRS\s*\(/i)
        if (am) {
            const inner = x.trim().slice(x.trim().indexOf('(') + 1, x.trim().lastIndexOf(')'))
            const a = splitArgs(inner)
            const v = attrValues[`${resolveArg(a[0] ?? '', dimElemPairs)}::${resolveArg(a[1] ?? '', dimElemPairs)}`]?.[(a[2] ?? '').replace(/^['"]|['"]$/g, '')]
            return v == null ? null : String(v)
        }
        return null
    }
    const evalCondition = (expr) => {
        const c = splitComparison(expr.trim()); if (!c) return null
        const a = valueOfSide(c[0]), b = valueOfSide(c[2]); if (a == null || b == null) return null
        const eq = a.trim().toLowerCase() === b.trim().toLowerCase()
        if (c[1] === '@=') return eq
        if (c[1] === '@<>') return !eq
        return null
    }

    const renderExpr = (expr, lhs) => {
        const s = expr.trim()
        const ifm = s.match(/^IF\s*\(/i)
        if (ifm) {
            const open = s.indexOf('(')
            const close = matchingCloseParen(s, open)
            const args = splitArgs(s.slice(open + 1, close))
            const cond = evalCondition(args[0] ?? '')   // true | false | null (can't tell)
            const branch = (label, cls, taken, body) => (
                <div className={cn('space-y-1', taken === false && 'opacity-40')}>
                    <div className="flex items-center gap-2">
                        <span className={cn('badge font-mono text-[9px]', cls)}>{label}</span>
                        {taken === true && <span className="text-[10px] text-foreground">this applies</span>}
                        {taken === false && <span className="text-[10px] text-muted-foreground">not used</span>}
                    </div>
                    <div className="pl-3">{body}</div>
                </div>
            )
            return (
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="badge bg-amber-500/20 text-amber-400 font-mono text-[9px]">IF</span>
                        {cond != null && <span className="text-[10px] text-foreground">is {cond ? 'true' : 'false'}</span>}
                    </div>
                    <div className="pl-3">{renderExpr(args[0] ?? '', lhs)}</div>
                    {branch('THEN', 'bg-emerald-500/20 text-emerald-400', cond == null ? null : cond, renderExpr(args[1] ?? '', lhs))}
                    {branch('ELSE', 'bg-purple-500/20 text-purple-400', cond == null ? null : !cond, renderExpr(args[2] ?? '', lhs))}
                </div>
            )
        }
        // Comparison (e.g. ATTRS(...) @= 'Contractor') → show both sides
        const cmp = splitComparison(s)
        if (cmp) {
            return (
                <div className="flex items-center gap-2 flex-wrap">
                    <div>{renderExpr(cmp[0], lhs)}</div>
                    <span className="font-mono text-[11px] text-muted-foreground font-semibold">{cmp[1]}</span>
                    <div>{renderOperand(cmp[2], lhs)}</div>
                </div>
            )
        }
        const parts = splitTopLevelOps(s)
        if (parts.length === 1) return renderOperand(parts[0].value, lhs)
        const nums = parts.map(t => t.type === 'op' ? t.value : operandNumber(t.value, lhs))
        const known = nums.every((x, i) => parts[i].type === 'op' ? /^[-+*/]$/.test(x) : typeof x === 'number')
        let result = null
        if (known) { try { result = Function(`return (${nums.join(' ')})`)() } catch { result = null } }
        return (
            <div className="space-y-1.5">
                <div className="flex items-stretch gap-2 flex-wrap">
                    {parts.map((t, i) => t.type === 'op'
                        ? <span key={i} className="self-center font-mono text-[12px] text-muted-foreground font-semibold">{t.value === '*' ? '×' : t.value}</span>
                        : <div key={i}>{renderOperand(t.value, lhs)}</div>
                    )}
                </div>
                {known && Number.isFinite(result) && (
                    <div className="font-mono text-[11px] text-foreground tabular-nums">
                        = {nums.map((x, i) => parts[i].type === 'op' ? (x === '*' ? '×' : x) : fmtTraceValue(x)).join(' ')} = <span className="font-semibold">{fmtTraceValue(result)}</span>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {statements.length === 0 && guardCount > 0 && (
                <div className="text-[11px] text-muted-foreground">Only the static-version guard applies here — no rule calculates this cell.</div>
            )}
            {statements.map((s, i) => (
                <div key={i} className="space-y-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{statements.length > 1 ? `Rule ${i + 1}` : 'Rule'}</div>
                    <pre className="font-mono text-[11px] bg-muted/50 rounded px-3 py-2 whitespace-pre-wrap break-words leading-relaxed overflow-x-auto">
                        {formatStatement(s)}
                    </pre>
                    <div className="pl-1">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">How it works out for this cell</div>
                        {renderExpr(rhsOf(s), (s.match(/\[\s*['"]([^'"]+)['"]\s*\]\s*=/) ?? [])[1] ?? null)}
                    </div>
                </div>
            ))}
            {guardCount > 0 && statements.length > 0 && (
                <div className="text-[10px] text-muted-foreground/70 border-t border-border/40 pt-2">
                    Static-version guard passed ({guardCount} {guardCount === 1 ? 'check' : 'checks'} along the way, hidden)
                </div>
            )}
        </div>
    )
}

export default RuleBreakdown
