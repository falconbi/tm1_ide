'use strict'

// A TI can build an object name at run time, so the dimensions it writes are not
// the ones its text names. The capture must still record those changes, or the
// object arrives at close unowned and cannot be merged into a release.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const written = []
const clPath = require.resolve(path.join(__dirname, '..', 'core', 'change-log'))
require.cache[clPath] = {
    id: clPath, filename: clPath, loaded: true,
    exports: {
        getActiveSession: () => ({ id: 's1', name: 'Sweep' }),
        writeLog: (e) => { written.push(e); return { hasSession: true } },
    },
}

const { beginCapture } = require(path.join(__dirname, '..', 'core', 'process-capture'))

// A tiny model: one dimension the process names, one it only reaches by a
// run-time name. `after` flips the second dimension's element list.
function client({ namedElements = [['A', 'Numeric']], hiddenElements = [['X', 'Numeric']], typo = null } = {}) {
    const elements = {
        'Named Dim': namedElements.map(([Name, Type]) => ({ Name, Type })),
        'Hidden Dim': hiddenElements.map(([Name, Type]) => ({ Name, Type })),
    }
    return {
        // process-scan reads the whole Processes collection through client.get.
        get: async () => ({
            value: [{
                Name: 'Build', PrologProcedure: typo ?? "DimensionElementInsert('Named Dim', '', 'A', 'N');",
                MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
            }],
        }),
        getModelDimensions: async () => [{ Name: 'Named Dim' }, { Name: 'Hidden Dim' }],
        getDimensions: async () => [{ Name: 'Named Dim' }, { Name: 'Hidden Dim' }],
        getProcesses: async () => [{
            Name: 'Build', PrologProcedure: typo ?? "DimensionElementInsert('Named Dim', '', 'A', 'N');",
            MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
        }],
        getHierarchies: async (dim) => [dim],
        getElements: async (dim) => (elements[dim] ?? []).map(e => ({ ...e })),
        getEdges: async () => [],
        getElementAttributes: async () => [],
        getCubes: async () => [],
        getSubsets: async () => [],
        getViews: async () => [],
    }
}

test('a dimension changed under a run-time name is recorded, though the text never names it', async () => {
    written.length = 0
    const c = client()
    const capture = await beginCapture('DEV1', c, 'Build', { user: 'u' })
    assert.deepEqual(capture.dims, ['Named Dim'])
    // The run builds the name at run time and adds an element to Hidden Dim.
    c.getElements = async (dim) => dim === 'Hidden Dim'
        ? [{ Name: 'X', Type: 'Numeric' }, { Name: 'ZZ NEW', Type: 'Numeric' }]
        : [{ Name: 'A', Type: 'Numeric' }]
    const out = await capture.complete()
    const added = written.filter(w => w.action === 'ELEMENT_ADDED' && w.objectName === 'Hidden Dim')
    assert.equal(added.length, 1, JSON.stringify(written.map(w => `${w.action} ${w.objectName}`)))
    assert.deepEqual(out.swept, ['Hidden Dim'])
})

test('a run that changes nothing outside the named dimensions records nothing extra', async () => {
    written.length = 0
    const c = client()
    const capture = await beginCapture('DEV1', c, 'Build', { user: 'u' })
    const out = await capture.complete()
    assert.deepEqual(out.swept, [])
    assert.equal(written.filter(w => w.objectName === 'Hidden Dim').length, 0)
})
