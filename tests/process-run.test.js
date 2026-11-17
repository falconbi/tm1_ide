'use strict'
const test = require('node:test')
const assert = require('node:assert')

const { runProcess } = require('../core/process-run')

function fakeClient({ executeResult, executeError, runLog = '', errorLog } = {}) {
    const calls = []
    return {
        calls,
        async post(path, body) {
            calls.push({ method: 'post', path, body })
            if (String(path).startsWith('Dimensions')) throw Object.assign(new Error('exists'), { response: { status: 409 } })
            return {}
        },
        async executeProcess(name, params) {
            calls.push({ method: 'execute', name, params })
            if (executeError) throw executeError
            return executeResult ?? { Times: { ExecutionTimeInMilliseconds: 42 }, ErrorLogFile: { Filename: 'tm1.log' } }
        },
        async executeMDX(mdx) {
            calls.push({ method: 'mdx', mdx })
            return { Cells: [{ Value: runLog }] }
        },
        async get(path) {
            calls.push({ method: 'get', path })
            if (errorLog instanceof Error) throw errorLog
            return errorLog
        },
    }
}

test('run clears __RUN_LOG, executes with params and returns duration and log', async () => {
    const client = fakeClient({ runLog: 'line one\r\nline two' })
    const params = [{ Name: 'pYear', Value: '2026' }]

    const result = await runProcess(client, { name: 'Load Sales', params })

    assert.deepEqual(result, { ok: true, duration: 42, runLog: 'line one\nline two', errorLogFilename: 'tm1.log' })
    assert.deepEqual(client.calls.find(c => c.method === 'execute'), { method: 'execute', name: 'Load Sales', params })

    const attr = client.calls.find(c => c.method === 'post' && c.body?.Name === '__RUN_LOG')
    assert.ok(attr)
    const clear = client.calls.find(c => c.method === 'post' && c.body?.Process?.Name === '_IDE_ClearRunLog')
    assert.match(clear.body.Process.PrologProcedure, /AttrPutS\('', '\}Processes', 'Load Sales', '__RUN_LOG'\);/)
})

test('run maps a TM1 execution error and falls back to the process error log', async () => {
    const executeError = Object.assign(new Error('execution failed'), {
        response: {
            data: {
                error: {
                    innererror: {
                        Message: 'Bad value in Data',
                        ProcedureSection: 'Data',
                        LineNumber: 7,
                        ErrorLogFile: { Filename: 'err.log' },
                    },
                },
            },
        },
    })
    const client = fakeClient({ executeError, errorLog: { value: 'fallback error log' } })

    const result = await runProcess(client, { name: 'Broken' })

    assert.deepEqual(result, {
        ok: false,
        status: 500,
        body: {
            error: 'Bad value in Data',
            section: 'Data',
            line: 7,
            runLog: 'fallback error log',
            errorLogFilename: 'err.log',
        },
    })
    assert.ok(client.calls.some(c => c.method === 'get' && c.path === "Processes('Broken')/ErrorLog"))
})

test('run accepts ErrorLogFile from the outer error response body', async () => {
    const executeError = Object.assign(new Error('failed'), {
        response: { data: { error: { innererror: { Message: 'oops' } }, ErrorLogFile: { Filename: 'outer.log' } } },
    })
    const client = fakeClient({ executeError, runLog: 'already captured' })

    const result = await runProcess(client, { name: 'P' })

    assert.equal(result.body.errorLogFilename, 'outer.log')
    assert.equal(result.body.runLog, 'already captured')
    assert.ok(!client.calls.some(c => c.method === 'get'), 'no error-log fallback when __RUN_LOG is present')
})

test('run turns an __ERROR: validation marker into a 500 body without a section or line', async () => {
    const client = fakeClient({ runLog: '__ERROR: Cost centre is required' })

    const result = await runProcess(client, { name: 'Validate' })

    assert.deepEqual(result, {
        ok: false,
        status: 500,
        body: { error: 'Cost centre is required', section: null, line: null, runLog: 'Cost centre is required' },
    })
})
