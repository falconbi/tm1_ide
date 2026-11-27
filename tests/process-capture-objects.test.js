'use strict'

// Objects a TI run creates with a run-time name (Fix 5).
//
// A name built at run time cannot be read from the process text, so the capture
// reads every object's name list around the run. A created subset and a deleted
// view must be recorded in the run's change set.

const { test } = require('node:test')
const assert = require('node:assert/strict')

const cl = require('../core/change-log')
const { beginCapture } = require('../core/process-capture')

function fakeClient(state) {
    const proc = {
        Name: 'Build Top',
        PrologProcedure: "SubsetCreate('RegionDim', 'Top ' | pRegion);",
        MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
        Parameters: [{ Name: 'pRegion', Value: '' }],
    }
    return {
        get: async (path) => {
            if (String(path) === 'Processes') return { value: [proc] }
            throw new Error(`unexpected GET ${path}`)
        },
        getModelDimensions: async () => ['RegionDim'],
        getModelCubes: async () => ['Sales'],
        getProcesses: async () => ['Build Top'],
        getChores: async () => [],
        getCubes: async () => ['Sales'],
        getHierarchies: async () => ['RegionDim'],
        getSubsets: async () => state.created
            ? [{ Name: 'Top North', Expression: '{[RegionDim].[RegionDim].[North]}' }]
            : [],
        getSubset: async (dim, name) => ({ Name: name, Expression: '{[RegionDim].[RegionDim].[North]}' }),
        getSubsetElements: async () => [],
        getViews: async () => state.created ? [] : [{ name: 'V1' }],
        getView: async () => ({ '@odata.type': '#ibm.tm1.api.v1.MDXView', MDX: 'SELECT {} ON 0' }),
        getElements: async () => [],
        getEdges: async () => [],
        getElementAttributes: async () => [],
    }
}

test('a run that creates a run-time-named subset records it, and a deleted view is recorded', async () => {
    const s = cl.startSession('Run capture', 'DEV', 'jo')
    const state = { created: false }
    const client = fakeClient(state)
    const capture = await beginCapture('DEV', client, 'Build Top', { user: 'jo' })

    state.created = true                     // the run happened
    const captured = await capture.complete()

    const log = cl.getSessionLog(s.id)
    const subset = log.find(e => e.action === 'SUBSET_SAVED' && e.object_name === 'Top North')
    assert.ok(subset, JSON.stringify(log.map(e => [e.action, e.object_name])))
    assert.equal(subset.detail, 'RegionDim')
    assert.match(String(subset.after_state?.content), /mdx:\{\[RegionDim\]/)

    const view = log.find(e => e.action === 'VIEW_DELETED' && e.object_name === 'V1')
    assert.ok(view, JSON.stringify(log.map(e => [e.action, e.object_name])))
    assert.equal(view.detail, 'Sales')
    assert.ok(captured.recorded.includes('SUBSET_SAVED'))
    assert.ok(captured.recorded.includes('VIEW_DELETED'))
    // The timing the lab measurement reads.
    assert.equal(typeof captured.timing.namesMs, 'number')
    assert.equal(typeof captured.timing.contentMs, 'number')
})
