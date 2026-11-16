'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { setup } = require('./_mcp-harness')
const { PACKAGES_DIR } = require('../tools/tm1deploy/src/packager')

test('a packageDir outside the packages root is refused', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1mcp-outside-'))
    try {
        const h = setup({ mode: 'build' })
        const r = await h.call('check_deploy_risk', { packageDir: outside, target: 'TestSrv' })
        assert.equal(r.isError, true)
        assert.match(r.text, /inside the packages root/)
    } finally {
        fs.rmSync(outside, { recursive: true, force: true })
    }
})

test('a failing deploy check surfaces isError', async () => {
    fs.mkdirSync(PACKAGES_DIR, { recursive: true })   // git-ignored: absent in a fresh clone
    const dir = fs.mkdtempSync(path.join(PACKAGES_DIR, 'mcp-test-'))
    try {
        fs.writeFileSync(path.join(dir, 'manifest.json'), '{ not json')
        const h = setup({ mode: 'build' })
        const r = await h.call('check_target_drift', { packageDir: dir, target: 'TestSrv' })
        assert.equal(r.isError, true)
        assert.match(r.text, /drift check failed/)
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})
