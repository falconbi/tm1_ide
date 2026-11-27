'use strict'

// The drift refusal is user-facing: it must say what changed and what to do next,
// not just name a Git file.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { driftRefusal, partitionCarriedDrift, unshippedDrift } = require('../core/git-deploy')

const dim = (summary = '+1 element: Planned Hire') => ({
    status: 'M', file: 'dimensions/WFP Employee.hierarchies/WFP Employee.json',
    kind: 'object', object: 'WFP Employee', summary,
})

test('a dimension change names the object, the change and the next step', () => {
    const m = driftRefusal('TM1_Test_PROD', { entries: [dim()] })
    assert.match(m, /TM1_Test_PROD changed after the last deploy/)
    assert.match(m, /Dimension WFP Employee: 1 new element: Planned Hire/)
    assert.match(m, /copy TM1_Test_PROD's change to DEV/)
    assert.match(m, /waiting until this is fixed/)
})

test('a rule or process points at the carry-back', () => {
    const m = driftRefusal('PROD', { entries: [{ status: 'M', file: 'cubes/Salary.rules', kind: 'rule-process', object: 'Salary' }] })
    assert.match(m, /Rules for cube Salary/)
    assert.match(m, /carry-back/)
})

test('a cube structure points at a change on DEV', () => {
    const m = driftRefusal('PROD', { entries: [{ status: 'M', file: 'cubes/Sales.json', kind: 'cube', object: 'Sales' }] })
    assert.match(m, /Cube Sales/)
    assert.match(m, /make the same cube change on DEV/)
})

test('a dimension with no element loss is carried; a loss blocks', () => {
    const carried = partitionCarriedDrift([dim()], [])
    assert.equal(carried.blocking.length, 0)
    assert.equal(carried.carried.length, 1)

    const lost = partitionCarriedDrift([dim()], [{ dimension: 'WFP Employee', hierarchy: 'WFP Employee', count: 1 }])
    assert.equal(lost.blocking.length, 1)
    assert.equal(lost.carried.length, 0)
})

test('a view is never blocking', () => {
    const r = partitionCarriedDrift([{ status: 'M', file: 'cubes/Sales.views/Default.json', blocking: false }], [])
    assert.equal(r.blocking.length, 0)
    assert.equal(r.carried.length, 1)
})

test('drift on an object the pull Skips is ignored', () => {
    const ignored = unshippedDrift([dim('+1 element: Planned Hire')], ["Skip Dimensions('WFP Employee')"])
    assert.equal(ignored.length, 1)
})

test('drift on an object the pull writes is kept', () => {
    const ignored = unshippedDrift([dim('+1 element: Planned Hire')], ["Update Dimensions('WFP Employee')"])
    assert.equal(ignored.length, 0)
})

test('a plan with no operations ignores nothing', () => {
    assert.equal(unshippedDrift([dim()], []).length, 0)
})

test('an unclassified change is never filtered away', () => {
    const e = { status: 'M', file: 'something/unknown.json', object: null }
    assert.equal(unshippedDrift([e], ["Skip Dimensions('WFP Employee')"]).length, 0)
})

test('a view reported as non-blocking is not re-reported as ignored', () => {
    const e = { status: 'M', file: 'cubes/Sales.views/Default.json', object: 'Sales', blocking: false }
    assert.equal(unshippedDrift([e], ["Skip Dimensions('WFP Employee')"]).length, 0)
})
