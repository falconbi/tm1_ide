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

test('masking a member also masks its parents, so it cannot be worked out from a total', async () => {
    // Org: 100 = 101 + 102 + 103; 101 is masked. Without widening, 100 − 102 − 103 gives 101 back.
    const tree = [
        { Name: '100', Type: 'C', Components: ['101', '102', '103'] },
        { Name: 'All', Type: 'C', Components: ['100'] },
        { Name: '101', Type: 'N', Components: [] }, { Name: '102', Type: 'N', Components: [] }, { Name: '103', Type: 'N', Components: [] },
    ]
    const axes = [{ Tuples: ['All', '100', '101', '102', '103'].map(n => ({ Members: [{ Name: n }] })) }]
    const cells = [500, 400, 150, 120, 130].map((v, i) => ({ Ordinal: i, Value: v, FormattedValue: String(v) }))
    const h = setup({ policyRaw: { '*': { redact: { cells: [{ cube: 'Org', members: ['101'], action: 'mask' }] } } } })
    Object.assign(h.builder, {
        async getCube() { return { Dimensions: [{ Name: 'Org' }] } },
        async getElementsWithTree() { return tree },
        async executeMDX() { return { Axes: axes, Cells: cells } },
    })
    const { data } = await h.call('read_cells', { mdx: 'SELECT {} ON 0 FROM [Org]' })
    assert.deepEqual(data.cells.map(c => c.formatted), ['***', '***', '***', '120', '130'], 'All and 100 are masked with 101')
})

test('if the hierarchy cannot be read, a member rule masks the whole cube (fail closed)', async () => {
    const h = withRule({ cube: 'Payroll', members: ['Salary'], action: 'mask' })
    h.builder.getCube = async () => { throw new Error('no access') }
    const { data } = await h.call('read_cells', { mdx: MDX })
    assert.ok(data.cells.every(c => c.formatted === '***'))
})

test('a password-like key keeps a true/false or number (an assertion "pass") but masks text', () => {
    const { scrubResult } = require('../tools/tm1mcp/guard')
    const res = scrubResult({ content: [{ type: 'text', text: JSON.stringify({ results: [{ pass: true, passed: 3 }, { pass: false }], password: 'hunter2', db_pass: 'x', pwd: 42 }) }] })
    const d = JSON.parse(res.content[0].text)
    assert.equal(d.results[0].pass, true)
    assert.equal(d.results[1].pass, false)
    assert.equal(d.results[0].passed, 3)
    assert.equal(d.password, '***')
    assert.equal(d.db_pass, '***')
    assert.equal(d.pwd, 42, 'a number is never a secret')
})
