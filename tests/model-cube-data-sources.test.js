'use strict'
// The Rules editor's Data sources strip — what a cube's writers/readers are, from TI code
// (literals, variables, generic copy call sites and clear/feeder calls) plus its rules.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const summaryFile = path.join(os.tmpdir(), `process-scan-summaries-${process.pid}.json`)
process.env.PROCESS_SUMMARIES_FILE = summaryFile
const summaries = require('../core/process-summaries')
const { getCubeDataSources, getViewSourceUsage, getProcessFacts, listProcessSummaries, invalidate } = require('../core/cube-data-sources')

test.after(() => { try { fs.unlinkSync(summaryFile) } catch { /* best effort */ } })

function client(processes, cubes) {
    return {
        getAllCubesWithRules: async () => cubes,
        get: async () => ({ value: processes }),
    }
}
const proc = (Name, code, extra = {}) => ({
    Name, PrologProcedure: code, MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
    Parameters: [], DataSource: { Type: 'None' }, ...extra,
})

test('writers: literal, variable, generic copy, clear and feeders', async () => {
    const cubes = [
        { Name: 'Cube A', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: "['M'] = N: DB('Cube B', 'x');\nFEEDERS;\n['M'] => DB('Cube C', 'x');" },
        { Name: 'Cube B', Dimensions: [{ Name: 'Period' }], Rules: '' },
        { Name: 'Cube C', Dimensions: [{ Name: 'Period' }], Rules: '' },
        { Name: 'Versioned', Dimensions: [{ Name: 'Period' }, { Name: 'Version' }, { Name: 'Measure' }], Rules: '' },
        { Name: 'Unversioned', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' },
    ]
    const processes = [
        proc('P literal', "#Region P literal — writes a literal\n# Does a thing for the hover.\n#EndRegion\nCellPutN(1, 'Cube A', 'Jan', 'Amount');"),
        proc('P variable', "cTarget = 'Cube A';\nCellPutN(2, cTarget, 'Jan', 'Amount');"),
        proc('P clear', "ViewZeroOut('Cube A', 'v');\nCubeProcessFeeders('Cube A');"),
        proc('P call', "ExecuteProcess('Generic Copy', 'pCube', 'Cube A');"),
        proc('P source', "CellGetN('Cube A', 'Jan', 'Amount');"),
        proc('P snapshot', "ExecuteProcess('}IDE.Version.Copy', 'pSource', 'A', 'pTarget', 'B', 'pVersionDim', 'Version');"),
        proc('Generic Copy', "CellPutN(n, pCube, vPer, vMeasure);"),
    ]
    invalidate()
    const d = await getCubeDataSources(client(processes, cubes), 'unit-1', 'Cube A')
    const w = Object.fromEntries(d.writers.map(x => [x.process, x]))
    assert.deepEqual(w['P literal'].measures, ['Amount'])
    assert.match(w['P literal'].header, /writes a literal/i)
    assert.match(w['P literal'].header, /does a thing/i)
    assert.match(w['P literal'].evidence[0].code, /CellPutN\(1, 'Cube A'/)
    assert.deepEqual(w['P variable'].measures, ['Amount'])
    assert.ok(w['P clear'].kinds.includes('clear'))
    assert.ok(w['P clear'].kinds.includes('feeders'))
    assert.deepEqual(w['Generic Copy'].callers, ['P call'])
    assert.deepEqual(d.readers.map(r => r.process), ['P source'])
    assert.deepEqual(d.ruleReads.calc, ['Cube B'])
    assert.deepEqual(d.ruleReads.feeders, ['Cube C'])
    assert.match(d.ruleReads.calcEvidence['Cube B'][0], /DB\('Cube B'/)
    assert.match(d.ruleReads.feederEvidence['Cube C'][0], /DB\('Cube C'/)

    // the version-copy wrapper only targets cubes carrying that version dimension
    const versioned = await getCubeDataSources(client(processes, cubes), 'unit-1', 'Versioned')
    const unversioned = await getCubeDataSources(client(processes, cubes), 'unit-1', 'Unversioned')
    assert.deepEqual(versioned.copiers, ['P snapshot'])
    assert.deepEqual(unversioned.copiers, [])
})

test('comments do not create phantom writers or readers', async () => {
    const cubes = [{ Name: 'Cube A', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '# DB(\'Ghost\')\n[] = N: 1;' }]
    const processes = [proc('P commented', "# CellPutN(1, 'Cube A', 'Jan', 'Amount');\n# CellGetN('Cube A');\nCellPutN(2, 'Cube A', 'Jan', 'Amount');")]
    invalidate()
    const d = await getCubeDataSources(client(processes, cubes), 'unit-2', 'Cube A')
    assert.equal(d.writers.length, 1)
    assert.equal(d.readers.length, 0)
    assert.deepEqual(d.ruleReads.calc, [])
    assert.deepEqual(d.ruleReads.feeders, [])
    assert.deepEqual(d.ruleReads.calcEvidence, {})
})

test('a view used as a TI datasource is reported, without debug copies', async () => {
    const cubes = [{ Name: 'Cube A', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' }]
    const source = { Type: 'TM1CubeView', dataSourceNameForServer: 'Cube A', view: 'Source View' }
    const processes = [
        proc('P source', '', { DataSource: source }),
        proc('_IDE_Debug_123', '', { DataSource: source }),
        proc('P other', '', { DataSource: { Type: 'None' } }),
    ]
    invalidate()
    const d = await getViewSourceUsage(client(processes, cubes), 'unit-view-source', 'Cube A', 'Source View')
    assert.deepEqual(d.processes, [{ process: 'P source' }])
})

test('the index cache is per user identity', async () => {
    const cubes = [{ Name: 'Cube A', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' }]
    const clientA = client([proc('User A writer', "CellPutN(1, 'Cube A', 'Jan', 'Amount');")], cubes)
    const clientB = client([proc('User B writer', "CellPutN(2, 'Cube A', 'Jan', 'Amount');")], cubes)
    invalidate()
    const a = await getCubeDataSources(clientA, 'unit-cache', 'Cube A', 'user-a')
    const b = await getCubeDataSources(clientB, 'unit-cache', 'Cube A', 'user-b')
    assert.deepEqual(a.writers.map(w => w.process), ['User A writer'])
    assert.deepEqual(b.writers.map(w => w.process), ['User B writer'])
})

test('a writer summary is stale only when the process code changed', async () => {
    const cubes = [{ Name: 'Cube A', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' }]
    const code = "CellPutN(1, 'Cube A', 'Jan', 'Amount');"
    const processes = [proc('P summary', code)]
    const server = 'unit-summary-stale'

    await summaries.put(server, 'P summary', { hash: summaries.hashCode(code), summary: 'Writes Cube A.', source: 'manual' })
    invalidate(server)
    const current = await getCubeDataSources(client(processes, cubes), server, 'Cube A')
    assert.equal(current.writers[0].summary, 'Writes Cube A.')
    assert.equal(current.writers[0].summaryStale, false, 'matching hash is not stale')

    await summaries.put(server, 'P summary', { hash: summaries.hashCode('old code'), summary: 'Old summary.', source: 'manual' })
    invalidate(server)
    const changed = await getCubeDataSources(client(processes, cubes), server, 'Cube A')
    assert.equal(changed.writers[0].summary, 'Old summary.')
    assert.equal(changed.writers[0].summaryStale, true, 'changed process is stale')
    await summaries.remove(server, 'P summary')
})

test('a failed process read keeps the index shape and is not cached', async () => {
    const cubes = [{ Name: 'Cube A', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' }]
    const processes = [proc('P writer', "CellPutN(1, 'Cube A', 'Jan', 'Amount');")]
    let fail = true
    let calls = 0
    const stub = {
        getAllCubesWithRules: async () => cubes,
        get: async () => { calls++; if (fail) throw new Error('TM1 is unavailable'); return { value: processes } },
    }
    const server = 'unit-scan-failure'
    invalidate(server)

    const sources = await getCubeDataSources(stub, server, 'Cube A', 'user')
    assert.deepEqual(sources.writers, [])
    assert.deepEqual(sources.readers, [])

    const facts = await getProcessFacts(stub, server, 'P writer', 'user')
    assert.deepEqual(facts.writes, [])
    assert.deepEqual(facts.reads, [])

    assert.deepEqual(await listProcessSummaries(stub, server, 'user'), [])
    assert.ok(calls >= 3, 'each failed read is retried, not served from the cache')

    fail = false
    const recovered = await getProcessFacts(stub, server, 'P writer', 'user')
    assert.deepEqual(recovered.writes, [{ cube: 'Cube A', measures: ['Amount'], kinds: ['write'] }])
})

test('every DB and DBS call on a line is a rule source', async () => {
    const cubes = [
        { Name: 'Cube A', Dimensions: [{ Name: 'Measure' }], Rules: "['M'] = N: DB('One') + DBS('Two');" },
        { Name: 'One', Dimensions: [{ Name: 'Measure' }], Rules: '' },
        { Name: 'Two', Dimensions: [{ Name: 'Measure' }], Rules: '' },
    ]
    invalidate()
    const d = await getCubeDataSources(client([], cubes), 'unit-dbs', 'Cube A')
    assert.deepEqual(d.ruleReads.calc.sort(), ['One', 'Two'])
})
