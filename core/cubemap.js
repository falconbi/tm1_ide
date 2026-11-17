'use strict'

// Builds the Cube Map model: cubes, rules/TI edges, process-call chains and the
// ordered steps the map/Show playback reads. This used to live in server.js with
// its own copies of the comment/argument/name helpers; those now come from
// cube-data-sources so the Cube Map and the Rules Data Sources strip cannot drift.

const { stripComments, splitArgs, resolveName, CUBE_FIRST_FNS } = require('./cube-data-sources')

const CATALOG = require('../shared/tm1-function-catalog.json')

const DB_RE = /\bDBS?\s*\(\s*'([^']+)'/gi

function scanRefs(text) {
    const clean = stripComments(text)
    const refs = new Set()
    DB_RE.lastIndex = 0
    let m
    while ((m = DB_RE.exec(clean)) !== null) refs.add(m[1])
    DB_RE.lastIndex = 0
    return [...refs]
}

// Dimension-changing TI calls, derived from the shared catalog (never hand-listed):
// a statement that takes a dimname and no cubename (View*/CubeCreate take a dimname
// but don't change it). Subset calls are excluded — the temp-view scaffolding every
// clear-and-rebuild process does would link nearly every process to its cube's dimensions.
const DIM_WRITE_FNS = Object.fromEntries(Object.entries(CATALOG)
    .filter(([, f]) => f.language !== 'rules' && f.isStatement && (f.params ?? []).includes('dimname')
        && !(f.params ?? []).some(x => x.startsWith('cubename') || x.startsWith('subset')))
    .map(([name, f]) => [name, f.params.indexOf('dimname')]))
const DIM_CALL_RE = new RegExp(`\\b(${Object.keys(DIM_WRITE_FNS).join('|')})\\s*\\(`, 'gi')
const CUBE_FIRST_RE = new RegExp(`\\b(?:${CUBE_FIRST_FNS.join('|')})\\s*\\(\\s*([^,)]+)`, 'gi')

async function buildCubeMapModel(client, { includeControl = false } = {}) {
    const allCubes = await client.getAllCubesWithRules()
    const cubeNames = new Set(allCubes.map(c => c.Name))
    const cubeDims = Object.fromEntries(allCubes.map(c => [c.Name, (c.Dimensions ?? []).map(d => d.Name)]))
    const dimNames = new Set(await client.getDimensions().catch(() => []))

    // Fetch TI process code for write-ref and call-chain analysis (best-effort — skip if slow/unavailable)
    // Catches three patterns, not just a literal cube name in CellPutN:
    //   1. CellPutN(value, 'Literal Cube', ...)              — direct literal
    //   2. cCube = 'Literal Cube'; ... CellPutN(value, cCube, ...) — var assigned a literal earlier, then used
    //   3. ExecuteProcess('GenericCopier', 'pCube', 'Literal Cube', ...) — a generic process (its own
    //      CellPutN target is a parameter, unresolvable in isolation) attributed via the call site that
    //      names the real cube — this is how Bedrock-style reusable copy processes get credited correctly.
    const tiWriteMap = {}
    const tiReadMap = {}
    const processCallers = {} // calledProcess -> [callerProcess, ...] (reverse of ExecuteProcess/RunProcess)
    // Per-process view for the map's "All TI" mode and the Show playback. `steps` is every distinct
    // read/write/call in code order (first occurrence), which is the order the playback walks.
    const processes = {}
    const procEntry = name => (processes[name] ??= { reads: [], writes: [], calls: [], dimWrites: [], steps: [] })
    const dimWriteMap = {} // dim -> [process, ...]

    try {
        const pd = await client.get('Processes', {
            '$select': 'Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,DataSource,Parameters',
        })
        const ASSIGN_RE     = /\b([A-Za-z_]\w*)\s*=\s*'([^']*)'\s*;/g
        const VAR_ASSIGN_RE = /\b([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*;/g
        // cube is the 2nd arg: CellPutN/S, CellPutNComplete, CellIncrementN/S (accumulating write)
        const CELLPUT_RE    = /\b(CellPut[NS](?:Complete)?|CellIncrement[NS])\s*\(/gi
        // reads: cube is the 1st arg
        const CELLGET_RE    = /\bCellGet[NS]\s*\(\s*([^,)]+)/gi
        const EXEC_RE       = /\b(?:ExecuteProcess|RunProcess)\s*\(([\s\S]*?)\)\s*;/gi
        const CUBE_PARAM_RE = /'([pP]\w*[Cc]ube\w*)'\s*,\s*'([^']+)'/g

        const addStep = (proc, kind, target, pos, measure) => {
            const e = procEntry(proc)
            const list = { read: e.reads, write: e.writes, call: e.calls, dimwrite: e.dimWrites }[kind]
            if (list.includes(target)) {
                if (kind === 'write' && measure) {
                    const st = e.steps.find(x => x.kind === 'write' && x.target === target)
                    if (st) { st.measures = st.measures ?? []; if (!st.measures.includes(measure)) st.measures.push(measure) }
                }
                return
            }
            list.push(target)
            const step = { kind, target, pos }
            if (kind === 'write' && measure) step.measures = [measure]
            e.steps.push(step)
        }
        const addWriter = (cube, proc, pos = Infinity) => {
            if (!cubeNames.has(cube)) return
            if (!tiWriteMap[cube]) tiWriteMap[cube] = []
            if (!tiWriteMap[cube].includes(proc)) tiWriteMap[cube].push(proc)
            addStep(proc, 'write', cube, pos)
        }
        const addReader = (cube, proc, pos) => {
            if (!cubeNames.has(cube)) return
            if (!tiReadMap[cube]) tiReadMap[cube] = []
            if (!tiReadMap[cube].includes(proc)) tiReadMap[cube].push(proc)
            addStep(proc, 'read', cube, pos)
        }

        for (const p of (pd.value ?? []).filter(p => includeControl || !p.Name.startsWith('}'))) {
            const code = stripComments([p.PrologProcedure, p.MetadataProcedure, p.DataProcedure, p.EpilogProcedure]
                .filter(Boolean).join('\n'))

            // Resolve `var = 'literal';` assignments so CellPutN(value, var, ...) can be traced, seeded
            // with parameter defaults and following `a = b;` chains (sDimension = pDimension). A default is
            // what the process uses when run as-is, so it's the name the map attributes it to.
            const varValues = {}
            for (const prm of p.Parameters ?? []) {
                if (typeof prm.Value === 'string' && prm.Value) varValues[prm.Name] = prm.Value
            }
            let am
            ASSIGN_RE.lastIndex = 0
            while ((am = ASSIGN_RE.exec(code)) !== null) varValues[am[1]] = am[2]
            for (let pass = 0; pass < 3; pass++) {
                VAR_ASSIGN_RE.lastIndex = 0
                while ((am = VAR_ASSIGN_RE.exec(code)) !== null) {
                    if (varValues[am[1]] === undefined && varValues[am[2]] !== undefined) varValues[am[1]] = varValues[am[2]]
                }
            }

            CELLPUT_RE.lastIndex = 0
            let m
            while ((m = CELLPUT_RE.exec(code)) !== null) {
                const args = splitArgs(code, m.index + m[0].length - 1)
                const cubeName = resolveName(args[1], varValues)
                if (!cubeName) continue
                addWriter(cubeName, p.Name, m.index)
                const dims = cubeDims[cubeName] ?? []
                const mi = dims.findIndex(d => /measure/i.test(d))
                const measure = mi >= 0 ? resolveName(args[2 + mi], varValues) : undefined
                addStep(p.Name, 'write', cubeName, m.index, measure)
            }

            CUBE_FIRST_RE.lastIndex = 0
            while ((m = CUBE_FIRST_RE.exec(code)) !== null) {
                const cubeName = resolveName(m[1], varValues)
                if (cubeName) addWriter(cubeName, p.Name, m.index)
            }

            CELLGET_RE.lastIndex = 0
            while ((m = CELLGET_RE.exec(code)) !== null) {
                const cubeName = resolveName(m[1], varValues)
                if (cubeName) addReader(cubeName, p.Name, m.index)
            }

            DIM_CALL_RE.lastIndex = 0
            while ((m = DIM_CALL_RE.exec(code)) !== null) {
                const ref = splitArgs(code, m.index + m[0].length - 1)[DIM_WRITE_FNS[m[1].toUpperCase()]]
                const dim = ref && resolveName(ref, varValues)
                if (!dim || !dimNames.has(dim)) continue
                if (!dimWriteMap[dim]) dimWriteMap[dim] = []
                if (!dimWriteMap[dim].includes(p.Name)) dimWriteMap[dim].push(p.Name)
                addStep(p.Name, 'dimwrite', dim, m.index)
            }

            // A cube-view datasource is a read of the whole view, before any code runs
            const ds = p.DataSource
            if (ds?.Type === 'TM1CubeView' && ds.dataSourceNameForServer) addReader(ds.dataSourceNameForServer, p.Name, -1)

            EXEC_RE.lastIndex = 0
            while ((m = EXEC_RE.exec(code)) !== null) {
                const argList = m[1]
                const nameRef = splitArgs(`(${argList})`, 0)[0]
                const called = nameRef && resolveName(nameRef, varValues)
                if (!called) continue
                if (called !== p.Name) {
                    if (!processCallers[called]) processCallers[called] = []
                    if (!processCallers[called].includes(p.Name)) processCallers[called].push(p.Name)
                    addStep(p.Name, 'call', called, m.index)
                }
                CUBE_PARAM_RE.lastIndex = 0
                let cm
                while ((cm = CUBE_PARAM_RE.exec(argList)) !== null) addWriter(cm[2], called)
            }
        }
    } catch { /* TI refs unavailable — continue without them */ }

    const cubes = {}

    for (const c of allCubes) {
        const rules = c.Rules ?? ''
        const feederIdx = rules.search(/^FEEDERS\s*;/im)
        const calcText   = feederIdx >= 0 ? rules.slice(0, feederIdx) : rules
        const feederText = feederIdx >= 0 ? rules.slice(feederIdx) : ''

        const calcRefs   = scanRefs(calcText).filter(n => cubeNames.has(n) && n !== c.Name)
        const feederRefs = scanRefs(feederText).filter(n => cubeNames.has(n) && n !== c.Name)

        // Non-blank, non-comment lines in the calc section
        const ruleLoc = calcText.split('\n')
            .filter(l => { const t = l.trim(); return t && !t.startsWith('#') && !t.startsWith('//') })
            .length

        cubes[c.Name] = {
            dims:           (c.Dimensions ?? []).map(d => d.Name),
            hasRules:       rules.trim().length > 0,
            ruleCalcRefs:   calcRefs,
            ruleFeederRefs: feederRefs,
            ruleLoc,
            tiWriters:      tiWriteMap[c.Name] ?? [],
            tiReaders:      tiReadMap[c.Name] ?? [],
        }
    }

    for (const e of Object.values(processes)) e.steps.sort((a, b) => a.pos - b.pos)

    // Only dimensions some process changes — the map never draws every dimension (see IMPROVEMENTS 7.1)
    const dims = Object.fromEntries(Object.entries(dimWriteMap).map(([d, procs]) => [d, {
        writers: procs,
        cubes:   allCubes.filter(c => (c.Dimensions ?? []).some(x => x.Name === d)).map(c => c.Name),
    }]))

    const chores = await client.getChoresWithTasks().catch(() => [])

    return { cubes, processCallers, processes, dims, chores }
}

module.exports = { buildCubeMapModel }
