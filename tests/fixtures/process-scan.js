'use strict'

// One model for every pattern the process scanner has to understand. The Cube Map
// and the Rules Data Sources strip both read it, so their pinned expectations in
// tests/model-process-scan.test.js describe the same facts from two directions.

const dimensions = ['Period', 'Measure', 'Version', 'Dim']

const cubes = [
    { Name: 'Target', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' },
    {
        Name: 'Source',
        Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }],
        Rules: [
            "['Measure'] = N: DB('ReadCube', 'Measure') + DB('Source', 'Measure') + DB('Missing Cube', 'Measure') + DB('O''Brien Sales', 'Measure');",
            '    FEEDERS;',
            "['Measure'] => DB('FeederCube', 'Measure') + DB('Source', 'Measure') + DB('O''Brien Sales', 'Measure');",
        ].join('\n'),
    },
    { Name: 'ReadCube', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' },
    { Name: 'FeederCube', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' },
    { Name: 'Sales 2026', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' },
    { Name: 'Sales 2026, Ltd', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' },
    { Name: 'Versioned', Dimensions: [{ Name: 'Period' }, { Name: 'Version' }, { Name: 'Measure' }], Rules: '' },
    { Name: 'Unversioned', Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' },
    { Name: "O'Brien Sales", Dimensions: [{ Name: 'Period' }, { Name: 'Measure' }], Rules: '' },
]

const proc = (Name, code, extra = {}) => ({
    Name,
    PrologProcedure: code,
    MetadataProcedure: '',
    DataProcedure: '',
    EpilogProcedure: '',
    Parameters: [],
    DataSource: { Type: 'None' },
    ...extra,
})

const processes = [
    proc('P literal', "CellPutN(1, 'Target', 'Jan', 'Amount');"),
    proc('P variable', "cTarget = 'Target';\nCellPutN(2, cTarget, 'Jan', 'Amount');"),
    proc('P chain', "cBase = 'Target';\ncAlias = cBase;\nCellPutN(3, cAlias, 'Jan', 'Amount');"),
    proc('P param default', 'CellPutN(4, pCube, \'Jan\', \'Amount\');', {
        Parameters: [{ Name: 'pCube', Type: 'String', Value: 'Target' }],
    }),
    proc('P view source', '', {
        DataSource: { Type: 'TM1CubeView', dataSourceNameForServer: 'Source', view: 'Source View' },
    }),
    proc('Generic Copy', 'CellPutN(nValue, pCube, vPeriod, vMeasure);', {
        Parameters: [{ Name: 'pCube', Type: 'String', Value: '' }],
    }),
    proc('P call generic', "ExecuteProcess('Generic Copy', 'pCube', 'Target');"),
    proc('P snapshot', "ExecuteProcess('}IDE.Version.Copy', 'pSource', 'A', 'pTarget', 'B', 'pVersionDim', 'Version');"),
    proc('P self', "ExecuteProcess('P self', 'pCube', 'Target');"),
    proc('P dim', "DimensionElementInsert('Dim', '', 'E', 'N');"),
    proc('P clear', "ViewZeroOut('Target', 'v');\nCubeProcessFeeders('Target');\nCubeClearData('Source');"),
    proc('P expr read', "sYear = '2026';\nCellGetN('Sales ' | sYear, 'Jan', 'Amount');"),
    proc('P comma read', "sYear = '2026';\nCellGetN('Sales ' | sYear | ', Ltd', 'Jan', 'Amount');"),
    proc('P missing write', "CellPutN(6, 'Missing Cube', 'Jan', 'Amount');"),
    proc('P obrien', "CellPutN(7, 'O''Brien Sales', 'Jan', 'Amount');"),
    proc('}Control', "CellPutN(8, 'Target', 'Jan', 'Amount');"),
]

function makeClient(processList = processes, cubeList = cubes) {
    return {
        getAllCubesWithRules: async () => cubeList,
        getDimensions: async () => dimensions,
        get: async () => ({ value: processList }),
        getChoresWithTasks: async () => [],
    }
}

module.exports = { cubes, dimensions, processes, proc, makeClient }
