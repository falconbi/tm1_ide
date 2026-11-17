'use strict'
// A document read must use the v11 .blob / Document/Content shape and ask the
// adapter for binary data — not a PAW-specific URL built in a route.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TM1Client } = require('../core/tm1-client')

test('downloadFile uses the v11 content path and asks for binary', async () => {
    const calls = []
    const adapter = {
        async get(path, params, opts) {
            calls.push({ path, params, opts })
            if (path === 'Configuration/ProductVersion') return { value: '11.8.0' }
            return Buffer.from('file-bytes')
        },
        async post() { throw new Error('not used') },
        async patch() { throw new Error('not used') },
        async delete() { throw new Error('not used') },
        async put() { throw new Error('not used') },
    }
    const c = new TM1Client('TestServer', adapter)
    const buf = await c.downloadFile(['Files'], "a'b")
    assert.equal(buf.toString(), 'file-bytes')
    const read = calls.find(x => x.path.includes('Contents'))
    assert.match(read.path, /^Contents\('Files'\)\/Contents\('a''b\.blob'\)\/Document\/Content$/)
    assert.equal(read.opts.binary, true)
})
