'use strict'
const test = require('node:test')
const assert = require('node:assert')

const { debugProcess, instrumentSection } = require('../core/process-debug')

function fakeClient({ proc, dbgLog = '', execute, getError, createError } = {}) {
    const calls = []
    return {
        calls,
        async get(path) {
            calls.push({ method: 'get', path })
            if (getError) throw getError
            return proc
        },
        async post(path, body) {
            calls.push({ method: 'post', path, body })
            if (String(path).startsWith('Dimensions')) throw Object.assign(new Error('exists'), { response: { status: 409 } })
            return {}
        },
        async createOrReplaceProcess(value) {
            calls.push({ method: 'create', value })
            if (createError) throw createError
        },
        async executeProcess(name, params) {
            calls.push({ method: 'execute', name, params })
            return execute ? execute() : { ProcessExecuteStatusCode: 'CompletedSuccessfully' }
        },
        async executeMDX(mdx) {
            calls.push({ method: 'mdx', mdx })
            return { Cells: [{ Value: dbgLog }] }
        },
        async getErrorLogContent(filename) {
            calls.push({ method: 'errorlog', filename })
            return { Content: 'from error log' }
        },
        async deleteProcess(name) {
            calls.push({ method: 'delete', name })
        },
    }
}

test('debug instruments breakpoints and watches into a temp process, then deletes it', async () => {
    const client = fakeClient({
        proc: {
            Parameters: [{ Name: 'pYear', Type: 'String', Value: '2026', Prompt: 'Year' }],
            DataSource: { '@odata.type': '#ibm.tm1.api.v1.ViewDataSource', Type: 'View', Cube: { Name: 'Sales' } },
            Variables: [{ '@odata.type': '#ibm.tm1.api.v1.Variable', Name: 'vValue', Type: 'Numeric' }],
        },
        dbgLog: '__DBG_BP:2:Prolog',
    })

    const result = await debugProcess(client, {
        name: 'My Process',
        params: [{ Name: 'pYear', Value: '2027' }],
        sections: {
            PrologProcedure: 'a = 1;\nb = 2;',
            MetadataProcedure: '',
            DataProcedure: '',
            EpilogProcedure: '',
        },
        watches: [{ name: 'vValue', type: 'string' }],
        breakpoints: { PrologProcedure: [2] },
        joinContinuations: code => code,
    })

    assert.deepEqual(result, { log: '__DBG_BP:2:Prolog\n__DBG_DONE:ok', error: null, noCapture: false })

    const created = client.calls.find(c => c.method === 'create').value
    assert.match(created.prolog, /^nDBGHit__IDE__ = 0;/)
    assert.match(created.prolog, /__DBG_BP:2:Prolog/)
    assert.match(created.prolog, /__DBG_VAR:vValue__Prolog__2=/)
    assert.match(created.prolog, /AttrPutS\(sDBGLog__IDE__, '\}Processes', 'My Process', '__DBG_LOG'\);/)
    assert.equal(created.parameters[0].Name, 'pYear')
    assert.equal(created.datasource.Type, 'View')
    assert.equal(created.datasource['@odata.type'], undefined, 'OData metadata is stripped from the copy')
    assert.equal(created.variables[0].Name, 'vValue')

    assert.ok(client.calls.some(c => c.method === 'post' && c.body?.Name === '__DBG_LOG'))
    assert.ok(client.calls.some(c => c.method === 'post' && c.body?.Process?.Name === '_IDE_ClearDbg'))
    assert.ok(client.calls.some(c => c.method === 'delete' && c.name.startsWith('_IDE_Debug_')))
})

test('debug without watches or breakpoints only runs the process and reports noCapture', async () => {
    const client = fakeClient({ proc: { Parameters: [] } })

    const result = await debugProcess(client, {
        name: 'Plain',
        sections: { PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '' },
        watches: [],
        breakpoints: {},
        joinContinuations: code => code,
    })

    assert.deepEqual(result, { log: '__DBG_DONE:ok', error: null, noCapture: true })
    assert.ok(!client.calls.some(c => c.method === 'post'))
    assert.ok(!client.calls.some(c => c.method === 'mdx'))
    assert.ok(client.calls.some(c => c.method === 'delete'))
})

test('debug reports the metadata fetch failure in the route body', async () => {
    const client = fakeClient({ getError: new Error('not found') })

    const result = await debugProcess(client, {
        name: 'Missing',
        sections: {},
        joinContinuations: code => code,
    })

    assert.deepEqual(result, { failure: 'Failed to create debug process: not found' })
    assert.ok(!client.calls.some(c => c.method === 'create'))
    assert.ok(!client.calls.some(c => c.method === 'delete'))
})

test('debug reports a temp process creation failure', async () => {
    const client = fakeClient({ proc: { Parameters: [] }, createError: new Error('rejected') })

    const result = await debugProcess(client, {
        name: 'Bad',
        sections: { PrologProcedure: '' },
        watches: [],
        breakpoints: {},
        joinContinuations: code => code,
    })

    assert.deepEqual(result, { failure: 'Failed to create debug process: rejected' })
    assert.ok(!client.calls.some(c => c.method === 'execute'))
})

test('instrumentSection uses the already-escaped safe process name', () => {
    const code = instrumentSection('x = 1;', 'PrologProcedure', 'Prolog', {
        watches: [],
        breakpoints: { PrologProcedure: [1] },
        safeProcName: "O''Brien",
        joinContinuations: value => value,
    })

    assert.match(code, /AttrPutS\(sDBGLog__IDE__, '\}Processes', 'O''Brien', '__DBG_LOG'\);/)
})
