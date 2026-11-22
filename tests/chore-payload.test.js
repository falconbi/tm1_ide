'use strict'

// The two TM1 v11 chore-creation traps, pinned: the task's process is an entity
// bind (not a nested object) and the parameter count must equal the process's.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { toCreateChoreBody } = require('../core/chore-payload')

const proc = { Name: 'WFP Recalculate If Needed', Parameters: [{ Name: 'pForce', Value: 0 }] }
const byName = (n) => (n === proc.Name ? proc : null)

test('a nested Process becomes an entity bind', () => {
    const b = toCreateChoreBody({ Name: 'C', Tasks: [{ Step: 0, Process: { Name: proc.Name } }] }, byName)
    assert.deepEqual(b.Tasks[0]['Process@odata.bind'], `Processes('${proc.Name}')`)
    assert.ok(!('Process' in b.Tasks[0]), 'the nested object is gone')
})

test('a ProcessName becomes an entity bind too', () => {
    const b = toCreateChoreBody({ Name: 'C', Tasks: [{ Step: 0, ProcessName: proc.Name }] }, byName)
    assert.equal(b.Tasks[0]['Process@odata.bind'], `Processes('${proc.Name}')`)
})

test('missing parameters are filled from the process — the counts must match', () => {
    const b = toCreateChoreBody({ Name: 'C', Tasks: [{ Step: 0, Process: { Name: proc.Name } }] }, byName)
    assert.deepEqual(b.Tasks[0].Parameters, [{ Name: 'pForce', Value: '0' }])
})

test('a complete parameter list is kept as given', () => {
    const b = toCreateChoreBody({ Name: 'C', Tasks: [{ Step: 0, Process: { Name: proc.Name }, Parameters: [{ Name: 'pForce', Value: 1 }] }] }, byName)
    assert.deepEqual(b.Tasks[0].Parameters, [{ Name: 'pForce', Value: '1' }])
})

test('a short parameter list is replaced, not sent (TM1 would reject it)', () => {
    const two = { Name: 'P2', Parameters: [{ Name: 'a', Value: 0 }, { Name: 'b', Value: 1 }] }
    const b = toCreateChoreBody({ Name: 'C', Tasks: [{ Step: 0, Process: { Name: 'P2' }, Parameters: [{ Name: 'a', Value: 9 }] }] }, () => two)
    assert.deepEqual(b.Tasks[0].Parameters.map(p => p.Name), ['a', 'b'])
})

test('a process with no parameters needs none', () => {
    const b = toCreateChoreBody({ Name: 'C', Tasks: [{ Step: 0, Process: { Name: 'Plain' } }] }, () => ({ Name: 'Plain', Parameters: [] }))
    assert.deepEqual(b.Tasks[0].Parameters, [])
})

test('an apostrophe in a process name is escaped for the bind', () => {
    const b = toCreateChoreBody({ Name: 'C', Tasks: [{ Step: 0, ProcessName: "It's mine" }] }, () => null)
    assert.equal(b.Tasks[0]['Process@odata.bind'], "Processes('It''s mine')")
})
