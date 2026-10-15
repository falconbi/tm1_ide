'use strict'
// Denylisted cubes / dimensions / processes are refused before TM1 is asked,
// and left out of every list. Security control objects are always denied.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./_mcp-harness')
const guard = require('../tools/tm1mcp/guard')

const POLICY = { '*': { cubes: { deny: ['Payroll*'] }, processes: { deny: ['HR *'] } } }

test('a denylisted cube is refused on every way in — and TM1 is never asked', async () => {
    const h = setup({ policyRaw: POLICY })
    for (const [tool, args] of [
        ['get_cube_rules', { cube: 'Payroll' }],
        ['execute_view', { cube: 'Payroll Detail', view: 'Default' }],
        ['read_cells', { mdx: 'SELECT {[Measure].[Measure].[Salary]} ON 0 FROM [Payroll]' }],
        ['read_cells', { mdx: 'SELECT {} ON 0 FROM (SELECT {} ON 0 FROM [payroll])' }],
        ['get_transaction_log', { cube: 'PAYROLL' }],
    ]) {
        const r = await h.call(tool, args)
        assert.equal(r.isError, true, `${tool} should refuse`)
        assert.match(r.text, /not allowed through the MCP/)
    }
    assert.equal(h.builder.calls.length, 0, 'refused before any TM1 call')
    assert.ok(h.audit.every(a => a.outcome === 'refused'), 'each refusal is audited as refused')
})

test('denied cubes are left out of list_cubes', async () => {
    const h = setup({ policyRaw: POLICY })
    assert.deepEqual((await h.call('list_cubes')).data, ['Sales'])
})

test('security control objects are always denied, with no policy file', async () => {
    const pol = guard.buildPolicy({}, 'X')
    for (const c of ['}ClientGroups', '}ClientProperties', '}CellSecurity_Capital', '}ElementSecurity_Region', '}CubeSecurity', '}Capabilities'])
        assert.equal(guard.allowed(pol, 'cubes', c), false, c)
    assert.equal(guard.allowed(pol, 'dimensions', '}Clients'), false)
    assert.equal(guard.allowed(pol, 'cubes', 'Sales'), true)
    const h = setup()
    assert.deepEqual((await h.call('list_dimensions')).data, ['Region'])
})

test('an allow list narrows to just those objects', () => {
    const pol = guard.buildPolicy({ '*': { cubes: { allow: ['Sales*'] } } }, 'X')
    assert.equal(guard.allowed(pol, 'cubes', 'Sales Plan'), true)
    assert.equal(guard.allowed(pol, 'cubes', 'Opex'), false)
})

test('a denied process is refused and skipped by search_ti_code', async () => {
    const h = setup({ policyRaw: POLICY })
    assert.equal((await h.call('get_process', { process: 'HR Load' })).isError, true)
    h.builder.getProcesses = async () => ['HR Load', 'Sales Load']
    h.builder.getProcess = async (n) => ({ PrologProcedure: `# ${n} touches Payroll` })
    const r = await h.call('search_ti_code', { pattern: 'Payroll' })
    assert.deepEqual(r.data.map(x => x.process), ['Sales Load'])
})

test('a policy file that is not valid JSON stops start-up', () => {
    const fs = require('fs'), os = require('os'), path = require('path')
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcpsec-')), 'mcp-security.json')
    fs.writeFileSync(f, '{ "cubes": ')
    assert.throws(() => guard.loadPolicy('X', f), /not valid JSON/)
    fs.writeFileSync(f, JSON.stringify({ '*': { redact: { cells: [{ cube: 'P', action: 'hide' }] } } }))
    assert.throws(() => guard.loadPolicy('X', f), /use "mask", "block" or "round:N"/)
})
