'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { attributeTypeStops, changedAttributeValues, scanDeletedUsage } = require('../core/close-check')

test('an attribute type change text ↔ number is a hard stop', () => {
    const before = { Employee: { attributes: [{ Name: 'Grade', Type: 'String' }, { Name: 'Number', Type: 'String' }], elements: [] } }
    const after = { Employee: { attributes: [{ Name: 'Grade', Type: 'Numeric' }, { Name: 'Number', Type: 'Alias' }], elements: [] } }
    const stops = attributeTypeStops(before, after)
    assert.equal(stops.length, 1)
    assert.match(stops[0], /Employee\.Grade/)
    assert.match(stops[0], /String → Numeric/)
})

test('every attribute value changed since the last close is listed with its owner', () => {
    const before = { Employee: { attributes: [{ Name: 'Grade', Type: 'String' }], elements: [{ Name: 'Sarah', Values: { Grade: '3' } }, { Name: 'Tom', Values: { Grade: '1' } }] } }
    const after = { Employee: { attributes: [{ Name: 'Grade', Type: 'String' }], elements: [{ Name: 'Sarah', Values: { Grade: '4' } }, { Name: 'Tom', Values: { Grade: '1' } }] } }
    const values = changedAttributeValues(before, after, {
        ownerOf: () => ({ sessionId: 's1', sessionName: 'Contractor rollup', mine: true }),
    })
    assert.equal(values.length, 1)
    assert.deepEqual(values[0], { dimension: 'Employee', element: 'Sarah', attribute: 'Grade', before: '3', after: '4', owner: { sessionId: 's1', sessionName: 'Contractor rollup', mine: true } })
})

test('DEV deleting a dimension or attribute a process writes stops the close', async () => {
    const client = {
        async get(route) {
            if (route === 'Processes') {
                return { value: [{
                    Name: 'Load Employee',
                    PrologProcedure: "DimensionElementInsert('Employee', '', 'A', 'N');\nAttrPutS('x', 'Employee', 'A', 'Code');",
                    MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
                }] }
            }
            if (route === 'Dimensions') return { value: [{ Name: 'Employee' }, { Name: 'Other' }] }
            if (route === 'Cubes') return { value: [] }
            return { value: [] }
        },
        async getDimensions() { return [{ Name: 'Employee' }, { Name: 'Other' }] },
        async getCubes() { return [] },
    }
    const hits = await scanDeletedUsage(client, { dimensions: ['Employee'], cubes: [], attributes: [{ dim: 'Employee', name: 'Code' }] })
    assert.ok(hits.some(h => /writes dimension Employee/.test(h.what)), JSON.stringify(hits))
    assert.ok(hits.some(h => /writes attribute Employee\.Code/.test(h.what)), JSON.stringify(hits))
})
