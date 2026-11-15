'use strict'
// TM1 errors reach users through core/tm1-error.js. These tests pin the message
// and status so a route never has to parse response.data itself.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeError, responseError } = require('../core/tm1-error')

test('a TM1 error body becomes the message', () => {
    const e = normalizeError({
        response: {
            status: 400,
            statusText: 'Bad Request',
            data: { error: { code: '278', message: 'An element with name "X" already exists.' } },
        },
    })
    assert.equal(e.message, 'An element with name "X" already exists.')
    assert.equal(e.status, 400)
    assert.equal(e.tm1, true)
    assert.equal(e.response.status, 400)
})

test('a response without a TM1 body falls back to HTTP status text', () => {
    const e = normalizeError({
        response: { status: 500, statusText: 'Internal Server Error', data: {} },
    })
    assert.equal(e.message, 'HTTP 500 Internal Server Error')
    assert.equal(e.status, 500)
    assert.equal(e.tm1, true)
})

test('a network error with no response keeps its own message and is not marked tm1', () => {
    const e = normalizeError(new Error('connect ECONNREFUSED'))
    assert.equal(e.message, 'connect ECONNREFUSED')
    assert.equal(e.tm1, false)
})

test('responseError normalises a direct-adapter response', () => {
    const e = responseError({ status: 404, statusText: 'Not Found', data: { error: { message: 'Dimension not found' } } })
    assert.equal(e.message, 'Dimension not found')
    assert.equal(e.status, 404)
    assert.equal(e.tm1, true)
})
