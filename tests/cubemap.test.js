'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { buildCubeMapModel } = require('../core/cubemap')

function client(cubes, processes) {
    return {
        getAllCubesWithRules: async () => cubes,
        getDimensions: async () => ['Period', 'Measure', 'Dim'],
        get: async () => ({ value: processes }),
        getChoresWithTasks: async () => [],
    }
}
const proc = (Name, code, extra = {}) => ({
    Name, PrologProcedure: code, MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
    Parameters: [], DataSource: { Type: 'None' }, ...extra,
})

const cubes = [
    { Name: 'Target', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' },
    { Name: 'Source', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }],
      Rules: "['M'] = N: DB('ReadCube');\nFEEDERS;\n['M'] => DB('FeederCube');" },
    { Name: 'ReadCube', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' },
    { Name: 'FeederCube', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' },
]

test('builds rule, feeder, TI read/write/call and dimension edges', async () => {
    const processes = [
        proc('P Writer', "pTarget = 'Target';\nCellPutN(1, pTarget, 'Jan', 'Amount');\nCellGetN('Source', 'Jan', 'Amount');\nExecuteProcess('P Callee');\nDimensionElementInsert('Dim', '', 'E', 'N');"),
        proc('P Callee', "CellGetN('ReadCube', 'Jan', 'Amount');"),
        proc('}Control', "CellPutN(1, 'Target', 'Jan', 'Amount');"),
    ]
    const m = await buildCubeMapModel(client(cubes, processes))

    assert.deepEqual(m.cubes.Source.ruleCalcRefs, ['ReadCube'])
    assert.deepEqual(m.cubes.Source.ruleFeederRefs, ['FeederCube'])
    assert.deepEqual(m.cubes.Target.tiWriters, ['P Writer'])
    assert.deepEqual(m.cubes.Source.tiReaders, ['P Writer'])
    assert.deepEqual(m.cubes.ReadCube.tiReaders, ['P Callee'])
    assert.deepEqual(m.processCallers['P Callee'], ['P Writer'])
    assert.deepEqual(m.dims.Dim.writers, ['P Writer'])

    const steps = m.processes['P Writer'].steps.map(s => `${s.kind}:${s.target}`)
    assert.ok(steps.includes('write:Target'))
    assert.ok(steps.includes('read:Source'))
    assert.ok(steps.includes('call:P Callee'))
    assert.ok(steps.includes('dimwrite:Dim'))
})

test('control processes are excluded unless includeControl is set', async () => {
    const processes = [proc('}Control', "CellPutN(1, 'Target', 'Jan', 'Amount');")]
    const normal = await buildCubeMapModel(client(cubes, processes))
    const withControl = await buildCubeMapModel(client(cubes, processes), { includeControl: true })
    assert.deepEqual(normal.cubes.Target.tiWriters, [])
    assert.deepEqual(withControl.cubes.Target.tiWriters, ['}Control'])
})
