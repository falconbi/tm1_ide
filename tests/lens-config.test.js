'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const os = require('os')
const { loadConfig } = require('../lens-server')

const missing = path.join(os.tmpdir(), `tm1-lens-no-config-${process.pid}-${Date.now()}.json`)

test('a missing real Lens app config fails closed with the create-file message', () => {
    assert.throws(() => loadConfig({ configPath: missing, demo: false }), /No Lens app settings: create/)
})

test('the example server is used only when demo mode is asked for', () => {
    const cfg = loadConfig({ configPath: missing, demo: true })
    assert.equal(cfg.server, '24Retail')
    assert.equal(cfg.port, 8090)
})
