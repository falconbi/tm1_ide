'use strict'

// One scanner for the Cube Map and the Rules Data Sources strip. It reads every
// process once and reports the same facts to both screens: cube writes and reads
// in code order, process calls (with their cube parameters), dimension writes,
// and the rule calc/feeder references with the lines that prove them.
//
// Names are resolved from literals, variables assigned a literal, variable
// chains and parameter defaults. A cube or dimension is only reported when it
// exists in the model. Comments are stripped quote-aware before scanning.

const CATALOG = require('../shared/tm1-function-catalog.json')

const PROCESS_SELECT = 'Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,DataSource,Parameters'

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
    for (let i = 0; i < ref.length; i++) {
        const ch = ref[i]
        if (ch === "'") {
            if (inStr && ref[i + 1] === "'") { cur += "''"; i++; continue }
            inStr = !inStr
        }
        if (ch === '|' && !inStr) { parts.push(cur); cur = '' } else cur += ch
    }
    parts.push(cur)
    let out = ''
    for (const part of parts.map(s => s.trim())) {
        const lit = part.match(/^'((?:''|[^'])*)'$/)
        const val = lit ? lit[1].replace(/''/g, "'") : varValues[part]
        if (val === undefined) return undefined
        out += val
    }
    return out || undefined
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

const CUBE_FIRST_FNS = ['ViewZeroOut', 'CubeClearData', 'CubeProcessFeeders']

// Dimension-changing TI statements, derived from the shared catalog (never
// hand-listed): a statement taking a dimname and no cubename/subset. Subset calls
// are excluded, as the temp-view scaffolding would link nearly every process.
const DIM_WRITE_FNS = Object.fromEntries(Object.entries(CATALOG)
    .filter(([, f]) => f.language !== 'rules' && f.isStatement && (f.params ?? []).includes('dimname')
        && !(f.params ?? []).some(x => x.startsWith('cubename') || x.startsWith('subset')))
    .map(([name, f]) => [name, f.params.indexOf('dimname')]))
const DIM_CALL_RE = new RegExp(`\\b(${Object.keys(DIM_WRITE_FNS).join('|')})\\s*\\(`, 'gi')

// Subset and view statements, also derived from the catalog. They are excluded
// from dimension writes (temp-view scaffolding would link nearly every process),
// but a run capture needs the dimension/cube they name so it can compare the
// content of that dimension's subsets or that cube's views.
const SUBSET_CALL_FNS = Object.fromEntries(Object.entries(CATALOG)
    .filter(([, f]) => f.language !== 'rules' && (f.params ?? []).includes('dimname') && (f.params ?? []).includes('subset'))
    .map(([name, f]) => [name, { dim: f.params.indexOf('dimname'), subset: f.params.indexOf('subset') }]))
const SUBSET_CALL_RE = new RegExp(`\\b(${Object.keys(SUBSET_CALL_FNS).join('|')})\\s*\\(`, 'gi')
const VIEW_CALL_FNS = Object.fromEntries(Object.entries(CATALOG)
    .filter(([name, f]) => f.language !== 'rules' && /^(VIEW|PUBLISHVIEW)/i.test(name) && (f.params ?? []).includes('cubename'))
    .map(([name, f]) => [name, { cube: f.params.indexOf('cubename'), view: Math.max(0, f.params.indexOf('value')) }]))
const VIEW_CALL_RE = new RegExp(`\\b(${Object.keys(VIEW_CALL_FNS).join('|')})\\s*\\(`, 'gi')

const CELLPUT_RE = /\b(CellPut[NS](?:Complete)?|CellIncrement[NS])\s*\(/gi
const CELLGET_RE = /\bCellGet[NS]\s*\(/gi
// Attribute WRITES, derived from the shared catalog (never hand-listed): a
// statement taking a dimname and an attribute. Reads are left out — only a write
// can change the model a deploy carries.
const ATTR_WRITE_FNS = Object.fromEntries(Object.entries(CATALOG)
    .filter(([, f]) => f.language !== 'rules' && f.isStatement && (f.params ?? []).includes('dimname') && (f.params ?? []).includes('attribute'))
    .map(([name, f]) => [name, f.params.indexOf('dimname')]))
const ATTR_WRITE_RE = new RegExp(`\\b(${Object.keys(ATTR_WRITE_FNS).join('|')})\\s*\\(`, 'gi')
const CUBE_FIRST_RE = new RegExp(`\\b(${CUBE_FIRST_FNS.join('|')})\\s*\\(`, 'gi')
const EXEC_RE = /\b(?:ExecuteProcess|RunProcess)\s*\(([\s\S]*?)\)\s*;/gi
const CUBE_PARAM_RE = /'([pP]\w*[Cc]ube\w*)'\s*,\s*'((?:''|[^'])+)'/g
const VERSION_DIM_RE = /'pVersionDim'\s*,\s*([^,)]+)/i
const ASSIGN_RE = /\b([A-Za-z_]\w*)\s*=\s*'((?:''|[^'])*)'\s*;/g
const VAR_ASSIGN_RE = /\b([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*;/g

function scanRules(rules) {
    const clean = stripComments(rules ?? '')
    const feederAt = clean.search(/^\s*FEEDERS\s*;/im)
    const calcText = feederAt >= 0 ? clean.slice(0, feederAt) : clean
    const feederText = feederAt >= 0 ? clean.slice(feederAt) : ''
    const refs = text => {
        const re = /\bDBS?\s*\(\s*'((?:''|[^'])+)'/gi
        const map = new Map() // cube -> [rule line]
        for (const line of text.split('\n')) {
            re.lastIndex = 0
            let m
            while ((m = re.exec(line)) !== null) {
                const cube = m[1].replace(/''/g, "'")
                const code = line.trim().replace(/\s+/g, ' ').slice(0, 220)
                if (!map.has(cube)) map.set(cube, [])
                if (!map.get(cube).includes(code)) map.get(cube).push(code)
            }
        }
        return map
    }
    const calc = refs(calcText), feeders = refs(feederText)
    return {
        calc: [...calc.keys()], calcEvidence: Object.fromEntries(calc),
        feeders: [...feeders.keys()], feederEvidence: Object.fromEntries(feeders),
    }
}

function scanProcess(p, { cubeNames = new Set(), cubeDims = {}, dimNames = new Set() } = {}) {
    const rawCode = [p.PrologProcedure, p.MetadataProcedure, p.DataProcedure, p.EpilogProcedure]
        .filter(Boolean).join('\n')
    const code = stripComments(rawCode)
    const writes = [], reads = [], calls = [], dimWrites = [], attrWrites = []
    const subsetOps = [], viewOps = []

    const varValues = {}
    for (const prm of p.Parameters ?? []) {
        if (typeof prm.Value === 'string' && prm.Value) varValues[prm.Name] = prm.Value
    }
    let m
    ASSIGN_RE.lastIndex = 0
    while ((m = ASSIGN_RE.exec(code)) !== null) varValues[m[1]] = m[2].replace(/''/g, "'")
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
        writes.push({ cube, kind: 'write', measure, pos: m.index, code: statementAt(code, m.index) })
    }

    CUBE_FIRST_RE.lastIndex = 0
    while ((m = CUBE_FIRST_RE.exec(code)) !== null) {
        const args = splitArgs(code, m.index + m[0].length - 1)
        const cube = resolveName(args[0], varValues)
        if (!cube || !cubeNames.has(cube)) continue
        const kind = m[1].toLowerCase() === 'cubeprocessfeeders' ? 'feeders' : 'clear'
        writes.push({ cube, kind, measure: undefined, pos: m.index, code: statementAt(code, m.index) })
    }

    CELLGET_RE.lastIndex = 0
    while ((m = CELLGET_RE.exec(code)) !== null) {
        const args = splitArgs(code, m.index + m[0].length - 1)
        const cube = resolveName(args[0], varValues)
        if (cube && cubeNames.has(cube)) {
            reads.push({ cube, how: 'cellget', pos: m.index, code: statementAt(code, m.index) })
        }
    }

    // A cube-view datasource reads the whole view before any code runs.
    const ds = p.DataSource
    if (ds?.Type === 'TM1CubeView' && ds.dataSourceNameForServer && cubeNames.has(ds.dataSourceNameForServer)) {
        const cube = ds.dataSourceNameForServer
        const view = ds.view ?? ''
        reads.push({ cube, how: 'view', pos: -1, code: `Data source: view '${view}' over '${cube}'`, view })
    }

    DIM_CALL_RE.lastIndex = 0
    while ((m = DIM_CALL_RE.exec(code)) !== null) {
        const ref = splitArgs(code, m.index + m[0].length - 1)[DIM_WRITE_FNS[m[1].toUpperCase()]]
        const dim = ref && resolveName(ref, varValues)
        if (!dim || !dimNames.has(dim)) continue
        dimWrites.push({ dim, pos: m.index })
    }

    ATTR_WRITE_RE.lastIndex = 0
    while ((m = ATTR_WRITE_RE.exec(code)) !== null) {
        const fn = m[1].toUpperCase()
        const args = splitArgs(code, m.index + m[0].length - 1)
        const dimAt = ATTR_WRITE_FNS[fn]
        const dim = resolveName(args[dimAt], varValues)
        if (!dim || !dimNames.has(dim)) continue
        // AttrPut*(value, dim, element, attribute)
        // ElementAttrPut*(value, dim, hierarchy, element, attribute)
        const elementAt = fn.startsWith('ELEMENTATTRPUT') ? dimAt + 2 : dimAt + 1
        const attributeAt = fn.startsWith('ELEMENTATTRPUT') ? dimAt + 3 : dimAt + 2
        const element = resolveName(args[elementAt], varValues)
        const attribute = resolveName(args[attributeAt], varValues)
        attrWrites.push({ dim, element, attribute, pos: m.index })
    }

    SUBSET_CALL_RE.lastIndex = 0
    while ((m = SUBSET_CALL_RE.exec(code)) !== null) {
        const fn = m[1].toUpperCase()
        const args = splitArgs(code, m.index + m[0].length - 1)
        const at = SUBSET_CALL_FNS[fn]
        const dim = resolveName(args[at.dim], varValues)
        if (!dim || !dimNames.has(dim)) continue
        subsetOps.push({ dim, subset: resolveName(args[at.subset], varValues) ?? null, pos: m.index })
    }
    VIEW_CALL_RE.lastIndex = 0
    while ((m = VIEW_CALL_RE.exec(code)) !== null) {
        const fn = m[1].toUpperCase()
        const args = splitArgs(code, m.index + m[0].length - 1)
        const at = VIEW_CALL_FNS[fn]
        const cube = resolveName(args[at.cube], varValues)
        if (!cube || !cubeNames.has(cube)) continue
        viewOps.push({ cube, view: resolveName(args[at.view], varValues) ?? null, pos: m.index })
    }

    EXEC_RE.lastIndex = 0
    while ((m = EXEC_RE.exec(code)) !== null) {
        const argList = m[1]
        const called = resolveName(splitArgs(`(${argList})`, 0)[0], varValues)
        if (!called || called === p.Name) continue
        const cubeParams = []
        CUBE_PARAM_RE.lastIndex = 0
        let cm
        while ((cm = CUBE_PARAM_RE.exec(argList)) !== null) {
            const cube = cm[2].replace(/''/g, "'")
            if (cubeNames.has(cube)) cubeParams.push(cube)
        }
        const dimArg = argList.match(VERSION_DIM_RE)
        const versionDim = dimArg ? resolveName(dimArg[1].trim(), varValues) : undefined
        calls.push({ process: called, pos: m.index, code: statementAt(code, m.index), cubeParams, versionDim })
    }

    const byPos = (a, b) => a.pos - b.pos
    return {
        writes: writes.sort(byPos),
        reads: reads.sort(byPos),
        calls: calls.sort(byPos),
        dimWrites: dimWrites.sort(byPos),
        attrWrites: attrWrites.sort(byPos),
        subsetOps: subsetOps.sort(byPos),
        viewOps: viewOps.sort(byPos),
    }
}

async function fetchProcesses(client) {
    const pd = await client.get('Processes', { '$select': PROCESS_SELECT })
    return pd.value ?? []
}

module.exports = {
    fetchProcesses, scanProcess, scanRules,
    stripComments, splitArgs, resolveName, CUBE_FIRST_FNS,
}
