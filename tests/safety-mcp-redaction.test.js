'use strict'
// Redaction masks, rounds or blocks values per cube / member / attribute before
// anything reaches the agent.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./_mcp-harness')

// A 2-column x 2-row cellset: columns Salary, Headcount; rows Alice, Bob.
const AXES = [
    { Tuples: [{ Members: [{ Name: 'Salary' }] }, { Members: [{ Name: 'Headcount' }] }] },
    { Tuples: [{ Members: [{ Name: 'Alice' }] }, { Members: [{ Name: 'Bob' }] }] },
]
const CELLS = [
    { Ordinal: 0, Value: 123456, FormattedValue: '123,456' }, { Ordinal: 1, Value: 1, FormattedValue: '1' },
    { Ordinal: 2, Value: 98765,  FormattedValue: '98,765' },  { Ordinal: 3, Value: 1, FormattedValue: '1' },
]
const tm1 = { async executeMDX() { return { Axes: AXES, Cells: CELLS } }, async executeView() { return { Axes: AXES, Cells: CELLS } } }
const MDX = 'SELECT {[M].[M].[Salary],[M].[M].[Headcount]} ON 0, {[E].[E].[Alice],[E].[E].[Bob]} ON 1 FROM [Payroll]'

function withRule(rule) {
    const h = setup({ policyRaw: { '*': { redact: { cells: [rule] } } } })
    Object.assign(h.builder, tm1)
    return h
}

test('mask hides the matching cells only', async () => {
    const h = withRule({ cube: 'Payroll', members: ['Salary'], action: 'mask' })
    const { data } = await h.call('read_cells', { mdx: MDX })
    assert.deepEqual(data.cells.map(c => c.formatted), ['***', '1', '***', '1'])
    assert.equal(data.cells[0].value, null)
    assert.equal(data.redacted, 2)
    assert.equal(h.audit[0].redacted, 2, 'the audit row records how many were masked')
})

test('round:-3 rounds to the nearest thousand', async () => {
    const h = withRule({ cube: 'Payroll', members: ['Salary'], action: 'round:-3' })
    const { data } = await h.call('execute_view', { cube: 'Payroll', view: 'All' })
    assert.deepEqual(data.cells.map(c => c.value), [123000, 1, 99000, 1])
})

test('a rule with no members covers the whole cube; WHERE members count too', async () => {
    const h = withRule({ cube: 'Payroll', action: 'mask' })
    assert.ok((await h.call('read_cells', { mdx: MDX })).data.cells.every(c => c.formatted === '***'))
    const w = withRule({ cube: 'Payroll', members: ['Actual'], action: 'mask' })
    const r = await w.call('read_cells', { mdx: MDX + ' WHERE ([Version].[Version].[Actual])' })
    assert.ok(r.data.cells.every(c => c.value === null), 'slicer member Actual matched every cell')
})

test('block refuses the read outright', async () => {
    const h = withRule({ cube: 'Payroll', members: ['Salary'], action: 'block' })
    const r = await h.call('read_cells', { mdx: MDX })
    assert.equal(r.isError, true)
    assert.match(r.text, /blocked by config\/mcp-security.json/)
    assert.doesNotMatch(r.text, /123/)
    assert.equal(h.audit[0].outcome, 'refused')
})

test('other cubes are untouched', async () => {
    const h = withRule({ cube: 'Payroll', action: 'mask' })
    const r = await h.call('read_cells', { mdx: MDX.replace('[Payroll]', '[Sales]') })
    assert.equal(r.data.cells[0].value, 123456)
    assert.equal(r.data.redacted, undefined)
})

test('attribute values are masked per dimension / attribute', async () => {
    const h = setup({ policyRaw: { '*': { redact: { attributes: [{ dimension: 'Employee', attribute: 'Salary*', action: 'mask' }] } } } })
    h.builder.getElementAttributes = async () => [{ Name: 'Name' }, { Name: 'Salary Band' }]
    h.builder.getElementAttributeValues = async () => ({ Name: 'Alice', 'Salary Band': 'B7' })
    const { data } = await h.call('get_element_attributes', { dimension: 'Employee', element: 'E001' })
    assert.deepEqual(data.values, { Name: 'Alice', 'Salary Band': '***' })
    assert.equal(data.redacted, 1)
})
