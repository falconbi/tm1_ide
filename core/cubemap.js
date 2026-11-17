'use strict'

// Builds the Cube Map model: cubes, rules/TI edges, process-call chains and the
// ordered steps the map/Show playback reads. The process and rule scanning lives in
// core/process-scan.js and is shared with the Rules Data Sources strip; this module
// folds the facts into edges, steps and dimension nodes, filters rule refs to the
// cubes that exist (and are not the cube itself), and reports a failed process scan
// without losing the rule edges.

const { fetchProcesses, scanProcess, scanRules, stripComments } = require('./process-scan')

async function buildCubeMapModel(client, { includeControl = false } = {}) {
    const allCubes = await client.getAllCubesWithRules()
    const cubeNames = new Set(allCubes.map(c => c.Name))
    const cubeDims = Object.fromEntries(allCubes.map(c => [c.Name, (c.Dimensions ?? []).map(d => d.Name)]))
    const dimNames = new Set(await client.getDimensions().catch(() => []))
    const ctx = { cubeNames, cubeDims, dimNames }

    // Fetch TI process code for write-ref and call-chain analysis (best-effort — skip if slow/unavailable)
    // The scanner resolves literal cubes, variables assigned a literal, variable chains, parameter
    // defaults, and ExecuteProcess cube parameters (how Bedrock-style reusable copy processes get
    // credited correctly). It returns the facts in code order; the arrays below fold them into the
    // map's edges and Show playback steps.
    const tiWriteMap = {}
    const tiReadMap = {}
    const processCallers = {} // calledProcess -> [callerProcess, ...] (reverse of ExecuteProcess/RunProcess)
    // Per-process view for the map's "All TI" mode and the Show playback. `steps` is every distinct
    // read/write/call in code order (first occurrence), which is the order the playback walks.
    const processes = {}
    const procEntry = name => (processes[name] ??= { reads: [], writes: [], calls: [], dimWrites: [], steps: [] })
    const dimWriteMap = {} // dim -> [process, ...]

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

    let scanError = null
    let allProcesses = []
    try {
        allProcesses = await fetchProcesses(client)
    } catch (e) {
        // The cubes and their rule edges still draw; the TI side reports the failure.
        scanError = e.message
    }

    for (const p of allProcesses.filter(p => includeControl || !p.Name.startsWith('}'))) {
        const facts = scanProcess(p, ctx)

        for (const w of facts.writes) {
            // The scanner keeps clear/feeders; the map draws both as cube writes.
            addWriter(w.cube, p.Name, w.pos)
            if (w.measure) addStep(p.Name, 'write', w.cube, w.pos, w.measure)
        }
        for (const r of facts.reads) addReader(r.cube, p.Name, r.pos)
        for (const d of facts.dimWrites) {
            if (!dimWriteMap[d.dim]) dimWriteMap[d.dim] = []
            if (!dimWriteMap[d.dim].includes(p.Name)) dimWriteMap[d.dim].push(p.Name)
            addStep(p.Name, 'dimwrite', d.dim, d.pos)
        }
        for (const call of facts.calls) {
            if (!processCallers[call.process]) processCallers[call.process] = []
            if (!processCallers[call.process].includes(p.Name)) processCallers[call.process].push(p.Name)
            addStep(p.Name, 'call', call.process, call.pos)
            for (const cube of call.cubeParams) addWriter(cube, call.process)
        }
    }

    const cubes = {}

    for (const c of allCubes) {
        const rules = c.Rules ?? ''
        const refs = scanRules(rules)
        const clean = stripComments(rules)
        const feederAt = clean.search(/^\s*FEEDERS\s*;/im)
        const calcText = feederAt >= 0 ? clean.slice(0, feederAt) : clean

        const calcRefs   = refs.calc.filter(n => cubeNames.has(n) && n !== c.Name)
        const feederRefs = refs.feeders.filter(n => cubeNames.has(n) && n !== c.Name)

        // Non-blank, non-comment lines in the calc section
        const ruleLoc = calcText.split('\n').filter(l => l.trim()).length

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

    const model = { cubes, processCallers, processes, dims, chores }
    if (scanError) model.scanError = scanError
    return model
}

module.exports = { buildCubeMapModel }
