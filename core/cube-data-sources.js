'use strict'

// Where does a cube's data come from? Scans every TI process (CellPut / CellIncrement /
// ViewZeroOut / CubeClearData / CubeProcessFeeders, including cube names held in variables
// or passed to a generic copy process) and the cube's own rules, and returns a compact
// per-cube source list for the Rules editor's Data Sources strip.
//
// Same rules as the Cube Map scan: comments are stripped quote-aware, and a cube may be
// named by a literal, a variable assigned a literal, or an ExecuteProcess cube parameter.
// The result is cached per server briefly because it reads every process.

const { hashCode, list } = require('./process-summaries')
const { fetchProcesses, scanProcess, scanRules } = require('./process-scan')

const TTL_MS = 30_000
const MAX_CACHE = 50
// `${server}::${identity}` -> { at, index }. The identity is the per-user session
// token (hashed by the route) or the acting user name; model scans must never be
// shared across TM1 logins.
const cache = new Map()

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

const tidyCode = s => String(s).replace(/\s+/g, ' ').trim().slice(0, 220)

async function buildIndex(client, serverName, { includeControl = false } = {}) {
    const allCubes = await client.getAllCubesWithRules()
    const cubeNames = new Set(allCubes.map(c => c.Name))
    const cubeDims = {}
    for (const c of allCubes) cubeDims[c.Name] = (c.Dimensions ?? []).map(d => d.Name)
    const ctx = { cubeNames, cubeDims }

    const index = {}
    const viewSources = {}
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

    let allProcesses
    try {
        allProcesses = await fetchProcesses(client)
    } catch (e) {
        // Rule sources are still usable; the process scan is not. Keep the same
        // shape so every caller can report the failure instead of throwing.
        for (const entry of Object.values(index)) {
            entry.writers = []
            entry.readers = []
            entry.copiers = []
        }
        return { cubes: index, processes: {}, viewSources: {}, scanError: e.message }
    }

    const meta = {}
    const procReads = {}
    const procCallers = {}
    for (const p of allProcesses) {
        if (!includeControl && p.Name.startsWith('}')) continue
        const rawCode = [p.PrologProcedure, p.MetadataProcedure, p.DataProcedure, p.EpilogProcedure].filter(Boolean).join('\n')
        meta[p.Name] = {
            header: processHeader(p.PrologProcedure, p.Name),
            source: p.DataSource?.Type ?? 'None',
            parameters: (p.Parameters ?? []).map(x => x.Name).filter(Boolean),
            codeHash: hashCode(rawCode),
        }

        const facts = scanProcess(p, ctx)
        for (const w of facts.writes) writer(w.cube, p.Name, w.kind, w.measure, undefined, { code: w.code })
        for (const r of facts.reads) {
            reader(r.cube, p.Name, r.how, { code: r.code })
            ;(procReads[p.Name] ??= new Set()).add(r.cube)
            if (r.how === 'view') {
                const key = r.cube + '\u001f' + (r.view ?? '')
                ;(viewSources[key] ??= []).push({ process: p.Name, cube: r.cube, view: r.view ?? '' })
            }
        }
        for (const call of facts.calls) {
            ;(procCallers[call.process] ??= new Set()).add(p.Name)
            for (const cube of call.cubeParams) {
                writer(cube, call.process, 'write', undefined, p.Name, { code: call.code, by: p.Name })
            }
            if (/Version\.Copy$/i.test(call.process) || /Snapshot/i.test(call.process)) {
                // only the cubes this call's version dimension actually belongs to
                const vdim = call.versionDim
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
            return {
                ...w, ...m,
                kinds: [...w.kinds], measures: [...w.measures], callers: [...w.callers],
                reads: [...(procReads[w.process] ?? [])],
            }
        })
        e.readers = Object.values(e.readers).map(r => ({ ...r, how: [...r.how], evidence: r.evidence ?? [] }))
        e.copiers = [...new Set(e.copiers)]
    }
    return { cubes: index, processes: meta, viewSources }
}

function cacheKey(server, identity) {
    return `${server}::${identity ?? ''}`
}

async function indexFor(client, server, identity, options = {}) {
    const key = cacheKey(server, identity)
    let hit = cache.get(key)
    if (!hit || Date.now() - hit.at > TTL_MS) {
        const index = await buildIndex(client, server, options)
        hit = { at: Date.now(), index }
        // A failed process read is reported and retried, never cached for 30 seconds.
        if (!index.scanError) {
            cache.set(key, hit)
            if (cache.size > MAX_CACHE) {
                const oldest = cache.keys().next().value
                if (oldest !== undefined) cache.delete(oldest)
            }
        }
    }
    return hit.index
}

async function getCubeDataSources(client, server, cube, identity, options = {}) {
    const index = await indexFor(client, server, identity, options)
    const e = index.cubes[cube]
    if (!e) return { cube, dims: [], writers: [], readers: [], ruleReads: { calc: [], feeders: [] }, copiers: [] }
    // summaries are joined at read time so a just-generated one shows without a rescan
    const summaries = list(server)
    const join = (x, meta = {}) => {
        const latest = summaries[x.process]
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
    const writers = e.writers.map(w => join(w, index.processes[w.process] ?? {}))
    const readers = e.readers.map(r => join(r, index.processes[r.process] ?? {}))
    return { cube, ...e, writers, readers }
}

async function getViewSourceUsage(client, server, cube, view, identity, options = {}) {
    const index = await indexFor(client, server, identity, options)
    const key = cube + '\u001f' + (view ?? '')
    const processes = (index.viewSources?.[key] ?? [])
        .filter(p => !/^_IDE_Debug_/i.test(p.process) && !p.process.startsWith('}'))
    return { cube, view, processes: processes.map(p => ({ process: p.process })) }
}


// Everything one process does, for a "what does this do" summary prompt.
async function getProcessFacts(client, server, name, identity, options = {}) {
    const index = await indexFor(client, server, identity, options)
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
    if (!server) return cache.clear()
    const prefix = `${server}::`
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key)
    }
}

// Every process with its summary status — for the server-wide summary review list.
async function listProcessSummaries(client, server, identity, options = {}) {
    const index = await indexFor(client, server, identity, options)
    const summaries = list(server)
    return Object.entries(index.processes).sort(([a], [b]) => a.localeCompare(b)).map(([name, m]) => {
        const latest = summaries[name]
        const current = latest && latest.hash === m.codeHash ? latest : null
        return {
            process: name, header: m.header, parameters: m.parameters, source: m.source,
            summary: latest?.summary ?? null, at: latest?.at ?? null, sourceKind: latest?.source ?? null,
            model: latest?.model ?? null, stale: !!(latest && !current),
        }
    })
}

module.exports = { getCubeDataSources, getViewSourceUsage, getProcessFacts, listProcessSummaries, invalidate }
