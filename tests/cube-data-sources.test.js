'use strict'
// The Rules editor's Data sources strip — what a cube's writers/readers are, from TI code
// (literals, variables, generic copy call sites and clear/feeder calls) plus its rules.
const test = require('node:test')
const assert = require('node:assert')
const { getCubeDataSources, invalidate } = require('../core/cube_data_sources')

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
