'use strict'

// Where does a cube's data come from? Scans every TI process (CellPut / CellIncrement /
// ViewZeroOut / CubeClearData / CubeProcessFeeders, including cube names held in variables
// or passed to a generic copy process) and the cube's own rules, and returns a compact
// per-cube source list for the Rules editor's Data Sources strip.
//
// Same rules as the Cube Map scan: comments are stripped quote-aware, and a cube may be
// named by a literal, a variable assigned a literal, or an ExecuteProcess cube parameter.
// The result is cached per server briefly because it reads every process.

const { hashCode, getLatest } = require('./process_summaries')

const TTL_MS = 30_000
const cache = new Map() // server -> { at, index }

function stripComments(code) {
    let out = ''
    let i = 0
    const n = code.length
    while (i < n) {
        const ch = code[i]
        if (ch === "'") {
            out += "'"; i++
            while (i < n && code[i] !== "'") { out += code[i]; i++ }
            if (i < n) { out += "'"; i++ }
            continue
        }
        if (ch === '#' || (ch === '/' && code[i + 1] === '/')) {
            while (i < n && code[i] !== '\n') i++
            continue
        }
        out += ch
        i++
    }
    return out
}

function splitArgs(code, openIdx) {
    const args = []; let depth = 0, cur = '', inStr = false
    for (let i = openIdx + 1; i < code.length; i++) {
        const ch = code[i]
        if (inStr) { cur += ch; if (ch === "'") inStr = false; continue }
        if (ch === "'") { inStr = true; cur += ch; continue }
        if (ch === '(') depth++
        if (ch === ')') { if (depth === 0) { args.push(cur); break } depth-- }
        if (ch === ',' && depth === 0) { args.push(cur); cur = ''; continue }
        if (ch === ';' && depth === 0) break
        cur += ch
    }
    return args
}

function resolveName(ref, varValues) {
    if (!ref) return undefined
    const parts = []; let cur = '', inStr = false
    for (const ch of ref) {
        if (ch === "'") inStr = !inStr
        if (ch === '|' && !inStr) { parts.push(cur); cur = '' } else cur += ch
    }
    parts.push(cur)
    let out = ''
    for (const part of parts.map(s => s.trim())) {
        const lit = part.match(/^'([^']*)'$/)
        const val = lit ? lit[1] : varValues[part]
        if (val === undefined) return undefined
        out += val
    }
    return out || undefined
}

function processHeader(prolog, name) {
    const lines = String(prolog ?? '').split(/\r?\n/)
    const start = lines.findIndex(l => /^\s*#Region\b/i.test(l))
    let body = []
    if (start >= 0) {
        const end = lines.findIndex((l, i) => i > start && /^\s*#EndRegion\b/i.test(l))
        body = [lines[start].replace(/^\s*#Region\s*/i, ''), ...lines.slice(start + 1, end >= 0 ? end : start + 14)]
    } else {
        for (const l of lines) {
            if (/^\s*#/.test(l)) body.push(l)
            else if (body.length) break
        }
    }
    let text = body.map(l => l.replace(/^\s*#\s?/, '')).join('\n').trim()
    if (name) {
        const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        text = text.replace(new RegExp('^' + esc + '\\s*[—–-]\\s*'), '').replace(new RegExp('^' + esc + '\\s*'), '')
    }
    // keep the tagline, then let the tooltip wrap the hand-wrapped body
    const nl = text.indexOf('\n')
    let first = nl >= 0 ? text.slice(0, nl).trim() : ''
    if (first) first = first[0].toUpperCase() + first.slice(1)
    let rest = (nl >= 0 ? text.slice(nl + 1) : text).replace(/[ \t]*\n[ \t]*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim()
    text = first ? (rest ? first + ' — ' + rest : first) : rest
    return text.length > 600 ? text.slice(0, 600) + '…' : text
}

function statementAt(code, start) {
    let i = start, inStr = false
    while (i < code.length) {
        const ch = code[i]
        if (ch === "'") inStr = !inStr
        if (ch === ';' && !inStr) return code.slice(start, i + 1)
        i++
    }
    return code.slice(start, start + 240)
}
const tidyCode = s => String(s).replace(/\s+/g, ' ').trim().slice(0, 220)

function scanRules(rules) {
    const clean = stripComments(rules ?? '')
    const feederAt = clean.search(/^\s*FEEDERS\s*;/im)
    const calcText = feederAt >= 0 ? clean.slice(0, feederAt) : clean
    const feederText = feederAt >= 0 ? clean.slice(feederAt) : ''
    const refs = text => {
        const re = /\bDB[S]?\s*\(\s*'([^']+)'/i
        const map = new Map() // cube -> [rule line]
        for (const line of text.split('\n')) {
            const m = line.match(re)
            if (!m) continue
            const code = line.trim().replace(/\s+/g, ' ').slice(0, 220)
            if (!map.has(m[1])) map.set(m[1], [])
            if (!map.get(m[1]).includes(code)) map.get(m[1]).push(code)
        }
        return map
    }
    const calc = refs(calcText), feeders = refs(feederText)
    return {
        calc: [...calc.keys()], calcEvidence: Object.fromEntries(calc),
        feeders: [...feeders.keys()], feederEvidence: Object.fromEntries(feeders),
    }
}

async function buildIndex(client, serverName) {
    const allCubes = await client.getAllCubesWithRules()
    const cubeNames = new Set(allCubes.map(c => c.Name))
    const cubeDims = {}
    for (const c of allCubes) cubeDims[c.Name] = (c.Dimensions ?? []).map(d => d.Name)

    const index = {}
    for (const c of allCubes) {
        index[c.Name] = {
            dims: cubeDims[c.Name],
            ruleReads: scanRules(c.Rules ?? ''),
            writers: {},
            readers: {},
            copiers: [],
        }
    }
    const writer = (cube, proc, kind, measure, caller, evidence) => {
        const e = index[cube]; if (!e) return
        const w = (e.writers[proc] ??= { process: proc, kinds: new Set(), measures: new Set(), callers: new Set(), evidence: [] })
        w.kinds.add(kind)
        if (measure) w.measures.add(measure)
        if (caller) w.callers.add(caller)
        if (evidence?.code && w.evidence.length < 8) {
            const code = tidyCode(evidence.code)
            if (!w.evidence.some(x => x.code === code)) w.evidence.push({ kind, measure, code, by: evidence.by })
        }
    }
    const reader = (cube, proc, how, evidence) => {
        const e = index[cube]; if (!e) return
        const r = (e.readers[proc] ??= { process: proc, how: new Set(), evidence: [] })
        r.how.add(how)
        if (evidence?.code && r.evidence.length < 5) {
            const code = tidyCode(evidence.code)
            if (!r.evidence.some(x => x.code === code)) r.evidence.push({ kind: how, code })
        }
    }

    let pd
    try {
        pd = await client.get('Processes', {
            '$select': 'Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,DataSource,Parameters',
        })
    } catch { return index }

    const CELLPUT_RE = /\b(CellPut[NS](?:Complete)?|CellIncrement[NS])\s*\(/gi
    const CELLGET_RE = /\bCellGet[NS]\s*\(/gi
    const CUBE_FIRST_RE = /\b(ViewZeroOut|CubeClearData|CubeProcessFeeders)\s*\(/gi
    const EXEC_RE = /\b(?:ExecuteProcess|RunProcess)\s*\(([\s\S]*?)\)\s*;/gi
    const CUBE_PARAM_RE = /'([pP]\w*[Cc]ube\w*)'\s*,\s*'([^']+)'/g
    const ASSIGN_RE = /\b([A-Za-z_]\w*)\s*=\s*'([^']*)'\s*;/g
    const VAR_ASSIGN_RE = /\b([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*;/g

    const meta = {}
    const procReads = {}
    const procCallers = {}
    for (const p of (pd.value ?? [])) {
        const rawCode = [p.PrologProcedure, p.MetadataProcedure, p.DataProcedure, p.EpilogProcedure].filter(Boolean).join('\n')
        meta[p.Name] = {
            header: processHeader(p.PrologProcedure, p.Name),
            source: p.DataSource?.Type ?? 'None',
            parameters: (p.Parameters ?? []).map(x => x.Name).filter(Boolean),
            codeHash: hashCode(rawCode),
        }
        const code = stripComments(rawCode)
        const varValues = {}
        for (const prm of p.Parameters ?? []) {
            if (typeof prm.Value === 'string' && prm.Value) varValues[prm.Name] = prm.Value
        }
        let m
        ASSIGN_RE.lastIndex = 0
        while ((m = ASSIGN_RE.exec(code)) !== null) varValues[m[1]] = m[2]
        for (let pass = 0; pass < 3; pass++) {
            VAR_ASSIGN_RE.lastIndex = 0
            while ((m = VAR_ASSIGN_RE.exec(code)) !== null) {
                if (varValues[m[1]] === undefined && varValues[m[2]] !== undefined) varValues[m[1]] = varValues[m[2]]
            }
        }

        CELLPUT_RE.lastIndex = 0
        while ((m = CELLPUT_RE.exec(code)) !== null) {
            const args = splitArgs(code, m.index + m[0].length - 1)
            const cube = resolveName(args[1], varValues)
            if (!cube || !cubeNames.has(cube)) continue
            const dims = cubeDims[cube] ?? []
            const mi = dims.findIndex(d => /measure/i.test(d))
            const measure = mi >= 0 ? resolveName(args[2 + mi], varValues) : undefined
            writer(cube, p.Name, 'write', measure, undefined, { code: statementAt(code, m.index) })
        }

        CUBE_FIRST_RE.lastIndex = 0
        while ((m = CUBE_FIRST_RE.exec(code)) !== null) {
            const args = splitArgs(code, m.index + m[0].length - 1)
            const cube = resolveName(args[0], varValues)
            if (!cube || !cubeNames.has(cube)) continue
            writer(cube, p.Name, m[1].toLowerCase() === 'cubeprocessfeeders' ? 'feeders' : 'clear', undefined, undefined, { code: statementAt(code, m.index) })
        }

        CELLGET_RE.lastIndex = 0
        while ((m = CELLGET_RE.exec(code)) !== null) {
            const args = splitArgs(code, m.index + m[0].length - 1)
            const cube = resolveName(args[0], varValues)
            if (cube && cubeNames.has(cube)) { reader(cube, p.Name, 'cellget', { code: statementAt(code, m.index) }); (procReads[p.Name] ??= new Set()).add(cube) }
        }

        // A cube-view datasource reads the whole view before any code runs
        if (p.DataSource?.Type === 'TM1CubeView' && p.DataSource.dataSourceNameForServer) {
            const cube = p.DataSource.dataSourceNameForServer
            reader(cube, p.Name, 'view', { code: `Data source: view '${p.DataSource.view ?? ''}' over '${cube}'` })
            if (cubeNames.has(cube)) (procReads[p.Name] ??= new Set()).add(cube)
        }

        EXEC_RE.lastIndex = 0
        while ((m = EXEC_RE.exec(code)) !== null) {
            const argList = m[1]
            const nameRef = splitArgs(`(${argList})`, 0)[0]
            const called = resolveName(nameRef, varValues)
            if (!called || called === p.Name) continue
            ;(procCallers[called] ??= new Set()).add(p.Name)
            CUBE_PARAM_RE.lastIndex = 0
            let cm
            while ((cm = CUBE_PARAM_RE.exec(argList)) !== null) {
                if (cubeNames.has(cm[2])) writer(cm[2], called, 'write', undefined, p.Name, { code: statementAt(code, m.index), by: p.Name })
            }
            if (/Version\.Copy$/i.test(called) || /Snapshot/i.test(called)) {
                // only the cubes this call's version dimension actually belongs to
                const dimArg = argList.match(/'pVersionDim'\s*,\s*([^,)]+)/i)
                const vdim = dimArg ? resolveName(dimArg[1].trim(), varValues) : undefined
                for (const c of allCubes) {
                    const dims = cubeDims[c.Name] ?? []
                    if (vdim ? !dims.includes(vdim) : !dims.some(d => /version/i.test(d))) continue
                    if (!index[c.Name].copiers.includes(p.Name)) index[c.Name].copiers.push(p.Name)
                }
            }
        }
    }

    for (const [name, m] of Object.entries(meta)) {
        m.reads = [...(procReads[name] ?? [])]
        m.calledBy = [...(procCallers[name] ?? [])]
    }
    for (const e of Object.values(index)) {
        e.writers = Object.values(e.writers).map(w => {
            const m = meta[w.process] ?? {}
            const latest = getLatest(serverName, w.process)
            const current = latest && latest.hash === m.codeHash ? latest : null
            return {
                ...w, ...m,
                kinds: [...w.kinds], measures: [...w.measures], callers: [...w.callers],
                reads: [...(procReads[w.process] ?? [])],
                summary: current?.summary ?? null,
                summaryAt: current?.at ?? null,
                summarySource: current?.source ?? null,
                summaryModel: current?.model ?? null,
                summaryStale: !!(latest && !current),
            }
        })
        e.readers = Object.values(e.readers).map(r => ({ ...r, how: [...r.how], evidence: r.evidence ?? [] }))
        e.copiers = [...new Set(e.copiers)]
    }
    return { cubes: index, processes: meta }
}

async function indexFor(client, server) {
    let hit = cache.get(server)
    if (!hit || Date.now() - hit.at > TTL_MS) {
        hit = { at: Date.now(), index: await buildIndex(client, server) }
        cache.set(server, hit)
    }
    return hit.index
}

async function getCubeDataSources(client, server, cube) {
    const index = await indexFor(client, server)
    const e = index.cubes[cube]
    if (!e) return { cube, dims: [], writers: [], readers: [], ruleReads: { calc: [], feeders: [] }, copiers: [] }
    // summaries are joined at read time so a just-generated one shows without a rescan
    const join = (x, meta = {}) => {
        const latest = getLatest(server, x.process)
        const current = latest && latest.hash === meta.codeHash ? latest : null
        return {
            ...x, ...meta,
            summary: latest?.summary ?? null,
            summaryAt: latest?.at ?? null,
            summarySource: latest?.source ?? null,
            summaryModel: latest?.model ?? null,
            summaryStale: !!(latest && !current),
        }
    }
    const writers = e.writers.map(w => join(w))
    const readers = e.readers.map(r => join(r, index.processes[r.process] ?? {}))
    return { cube, ...e, writers, readers }
}

// Everything one process does, for a "what does this do" summary prompt.
async function getProcessFacts(client, server, name) {
    const index = await indexFor(client, server)
    const meta = index.processes[name] ?? {}
    const writes = [], reads = new Set(meta.reads ?? []), copies = []
    for (const [cube, e] of Object.entries(index.cubes)) {
        const w = e.writers.find(x => x.process === name)
        if (w) writes.push({ cube, measures: w.measures, kinds: w.kinds })
        if (e.readers.some(r => r.process === name)) reads.add(cube)
        if (e.copiers.includes(name)) copies.push(cube)
    }
    return {
        name,
        header: meta.header ?? '',
        source: meta.source ?? 'None',
        parameters: meta.parameters ?? [],
        calledBy: meta.calledBy ?? [],
        hash: meta.codeHash ?? null,
        writes, reads: [...reads], copies: [...new Set(copies)],
    }
}

function invalidate(server) {
    if (server) cache.delete(server)
    else cache.clear()
}

// Every process with its summary status — for the server-wide summary review list.
async function listProcessSummaries(client, server) {
    const index = await indexFor(client, server)
    return Object.entries(index.processes).sort(([a], [b]) => a.localeCompare(b)).map(([name, m]) => {
        const latest = getLatest(server, name)
        const current = latest && latest.hash === m.codeHash ? latest : null
        return {
            process: name, header: m.header, parameters: m.parameters, source: m.source,
            summary: latest?.summary ?? null, at: latest?.at ?? null, sourceKind: latest?.source ?? null,
            model: latest?.model ?? null, stale: !!(latest && !current),
        }
    })
}

module.exports = { getCubeDataSources, getProcessFacts, listProcessSummaries, invalidate }
