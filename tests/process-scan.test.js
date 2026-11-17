'use strict'
// Unit tests for the one process scanner both model screens use. The fixture is
// shared with tests/model-process-scan.test.js.

const test = require('node:test')
const assert = require('node:assert')

const fixture = require('./fixtures/process-scan')
const { fetchProcesses, scanProcess, scanRules } = require('../core/process-scan')

const ctx = {
    cubeNames: new Set(fixture.cubes.map(c => c.Name)),
    cubeDims: Object.fromEntries(fixture.cubes.map(c => [c.Name, (c.Dimensions ?? []).map(d => d.Name)])),
    dimNames: new Set(fixture.dimensions),
}
const byName = Object.fromEntries(fixture.processes.map(p => [p.Name, p]))
const facts = name => scanProcess(byName[name], ctx)
const plain = value => JSON.parse(JSON.stringify(value))

test('fetchProcesses asks once for the fields both screens need', async () => {
    const calls = []
    const client = { get: async (...args) => { calls.push(args); return { value: fixture.processes } } }
    assert.equal(await fetchProcesses(client), fixture.processes)
    assert.deepEqual(calls, [['Processes', {
        '$select': 'Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,DataSource,Parameters',
    }]])
})

test('literal, variable, chain and parameter default all name the same cube', () => {
    for (const name of ['P literal', 'P variable', 'P chain', 'P param default']) {
        const write = facts(name).writes[0]
        assert.equal(write.cube, 'Target', name)
        assert.equal(write.kind, 'write', name)
        assert.equal(write.measure, 'Amount', name)
        assert.match(write.code, /CellPutN\(/, name)
    }
    assert.deepEqual(facts('Generic Copy').writes, [], 'an unresolved pCube is not a write on its own')
})

test('facts keep code order with the statement text at each position', () => {
    const p = fixture.proc('P order', [
        "CellGetN('ReadCube', 'Jan', 'Amount');",
        "CellPutN(1, 'Target', 'Jan', 'Amount');",
        "ExecuteProcess('P callee');",
        "DimensionElementInsert('Dim', '', 'E', 'N');",
    ].join('\n'))
    const order = scanProcess(p, ctx)
    const all = [...order.reads, ...order.writes, ...order.calls, ...order.dimWrites].sort((a, b) => a.pos - b.pos)
    assert.deepEqual(all.map(x => x.cube ?? x.dim ?? x.process), ['ReadCube', 'Target', 'P callee', 'Dim'])
    assert.equal(order.reads[0].pos, p.PrologProcedure.indexOf('CellGetN'))
    assert.equal(order.writes[0].pos, p.PrologProcedure.indexOf('CellPutN'))
    assert.equal(order.calls[0].pos, p.PrologProcedure.indexOf('ExecuteProcess'))
    assert.equal(order.dimWrites[0].pos, p.PrologProcedure.indexOf('DimensionElementInsert'))
    assert.match(order.reads[0].code, /^CellGetN\('ReadCube'/)
})

test('clear and feeder calls keep their kinds, and a view source is a read at pos -1', () => {
    const writes = facts('P clear').writes
    assert.deepEqual(plain(writes.map(w => ({ cube: w.cube, kind: w.kind }))), [
        { cube: 'Target', kind: 'clear' },
        { cube: 'Target', kind: 'feeders' },
        { cube: 'Source', kind: 'clear' },
    ])
    const read = facts('P view source').reads
    assert.deepEqual(plain(read), [{ cube: 'Source', how: 'view', pos: -1, code: "Data source: view 'Source View' over 'Source'", view: 'Source View' }])
})

test('cube names come from splitArgs then resolveName, not a regex capture', () => {
    assert.equal(facts('P expr read').reads[0].cube, 'Sales 2026')
    assert.equal(facts('P comma read').reads[0].cube, 'Sales 2026, Ltd')
})

test('a cube or dimension that does not exist is never a fact', () => {
    assert.deepEqual(facts('P missing write').writes, [])
    const p = fixture.proc('P missing dim', "DimensionElementInsert('No Such Dim', '', 'E', 'N');")
    assert.deepEqual(scanProcess(p, ctx).dimWrites, [])
})

test('FEEDERS is found on comment-stripped text with leading whitespace', () => {
    const rules = fixture.cubes.find(c => c.Name === 'Source').Rules
    const refs = scanRules(rules)
    assert.ok(refs.calc.includes('ReadCube'))
    assert.ok(!refs.calc.includes('FeederCube'), 'an indented FEEDERS; ends the calc section')
    assert.deepEqual(refs.feeders, ['FeederCube', 'Source', 'O'])
    assert.match(refs.feederEvidence.FeederCube[0], /=> DB\('FeederCube'/)
})

test('a process calling itself adds no call edge and no cube-parameter write', () => {
    assert.deepEqual(facts('P self').calls, [])
})

test('calls carry their cube parameters and the version dimension', () => {
    const generic = facts('P call generic').calls[0]
    assert.equal(generic.process, 'Generic Copy')
    assert.deepEqual(generic.cubeParams, ['Target'])
    assert.equal(generic.versionDim, undefined)
    const snapshot = facts('P snapshot').calls[0]
    assert.equal(snapshot.process, '}IDE.Version.Copy')
    assert.deepEqual(snapshot.cubeParams, [])
    assert.equal(snapshot.versionDim, 'Version')
})

test('a dimension write is reported from the shared catalog', () => {
    assert.deepEqual(facts('P dim').dimWrites, [{ dim: 'Dim', pos: 0 }])
})

test('comments do not create writes, reads or rule sources', () => {
    const p = fixture.proc('P commented', "# CellPutN(1, 'Target', 'Jan', 'Amount');\n# CellGetN('Source');\n")
    assert.deepEqual(scanProcess(p, ctx), { writes: [], reads: [], calls: [], dimWrites: [] })
    assert.deepEqual(scanRules("# DB('Ghost')\n[] = N: 1;"), {
        calc: [], calcEvidence: {}, feeders: [], feederEvidence: {},
    })
})
