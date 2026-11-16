'use strict'
// Simple mode — a per-server flag that hides the deploy process in the IDE.
// Marked in config/servers.json like read-only ("simpleServers", or "simple": true
// on the adminHost / connection), or switched on in Server Admin, which keeps it
// in config/ide-modes.json.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const SERVERS_PATH = path.join(__dirname, '..', 'config', 'servers.json')
const MODES_PATH = path.join(__dirname, '..', 'config', 'ide-modes.json')

// Serve fake servers.json / ide-modes.json without touching the real files.
// `modes` is an in-memory ide-modes.json (undefined = the file doesn't exist).
function withServers(cfg, fn, files = {}) {
    const real = { statSync: fs.statSync, readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync }
    const missing = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    fs.statSync = (p, ...rest) => (p === SERVERS_PATH ? { mtimeMs: Math.random() } : real.statSync(p, ...rest))
    fs.readFileSync = (p, ...rest) => {
        if (p === SERVERS_PATH) return JSON.stringify(cfg)
        if (p === MODES_PATH) { if (files.modes === undefined) throw missing(); return files.modes }
        return real.readFileSync(p, ...rest)
    }
    fs.writeFileSync = (p, data, ...rest) => (p === `${MODES_PATH}.tmp` ? void (files.tmp = data) : real.writeFileSync(p, data, ...rest))
    fs.renameSync = (a, b, ...rest) => (a === `${MODES_PATH}.tmp` && b === MODES_PATH ? void (files.modes = files.tmp) : real.renameSync(a, b, ...rest))
    const fresh = ['../core/adapter_registry', '../core/ide_modes'].map(m => require.resolve(m))
    try {
        fresh.forEach(m => delete require.cache[m])
        return fn(require('../core/adapter_registry'), require('../core/ide_modes'))
    } finally {
        Object.assign(fs, real)
        fresh.forEach(m => delete require.cache[m])
    }
}

const host = (extra = {}) => ({ name: 'Lab', url: 'http://localhost:5895', adapter: 'direct-v11', servers: ['DEV', 'SANDBOX'], ...extra })

test('no simple setting — every server keeps the full deploy process (the default)', () => {
    withServers({ adminHosts: [host()] }, ({ isSimple }) => {
        assert.equal(isSimple('DEV'), false)
        assert.equal(isSimple('SANDBOX'), false)
    })
})

test('simpleServers marks only the servers it names, case-insensitively', () => {
    withServers({ adminHosts: [host()], simpleServers: ['sandbox'] }, ({ isSimple }) => {
        assert.equal(isSimple('SANDBOX'), true)
        assert.equal(isSimple('DEV'), false)
    })
})

test('"simple": true on an adminHost makes every server it owns simple', () => {
    withServers({ adminHosts: [host({ simple: true })] }, ({ isSimple }) => {
        assert.equal(isSimple('DEV'), true)
        assert.equal(isSimple('SANDBOX'), true)
    })
})

test('the server list carries the simple flag beside readOnly', () => {
    withServers({ adminHosts: [host()], simpleServers: ['SANDBOX'], readOnlyServers: ['DEV'] }, ({ listServersWithFlags }) => {
        const list = listServersWithFlags()
        assert.deepEqual(list.find(s => s.name === 'SANDBOX'), { name: 'SANDBOX', readOnly: false, simple: true, simpleSource: 'config' })
        assert.deepEqual(list.find(s => s.name === 'DEV'), { name: 'DEV', readOnly: true, simple: false, simpleSource: null })
    })
})

test('no server name is never simple', () => {
    withServers({ adminHosts: [host({ simple: true })] }, ({ isSimple }) => {
        assert.equal(isSimple(''), false)
        assert.equal(isSimple(null), false)
    })
})

test('the Server Admin switch turns Simple mode on and off for one server', () => {
    const files = {}
    withServers({ adminHosts: [host()] }, ({ isSimple, simpleSource }, { setSimpleInModes }) => {
        setSimpleInModes('SANDBOX', true)
        assert.equal(isSimple('SANDBOX'), true)
        assert.equal(simpleSource('SANDBOX'), 'ide')
        assert.equal(isSimple('DEV'), false)
        setSimpleInModes('sandbox', false)          // any case turns it off
        assert.equal(isSimple('SANDBOX'), false)
        assert.deepEqual(JSON.parse(files.modes), { simpleServers: [] })
    }, files)
})

test('switching on twice keeps one entry', () => {
    const files = {}
    withServers({ adminHosts: [host()] }, (_, { setSimpleInModes, readModes }) => {
        setSimpleInModes('SANDBOX', true)
        setSimpleInModes('SANDBOX', true)
        assert.deepEqual(readModes().simpleServers, ['SANDBOX'])
    }, files)
})

test('servers.json wins over the switch — reported as config so the UI cannot switch it off', () => {
    withServers({ adminHosts: [host()], simpleServers: ['SANDBOX'] }, ({ simpleSource }) => {
        assert.equal(simpleSource('SANDBOX'), 'config')
    }, { modes: JSON.stringify({ simpleServers: ['SANDBOX'] }) })
})

test('a broken ide-modes.json means no server is simple, not a crash', () => {
    withServers({ adminHosts: [host()] }, ({ isSimple }) => {
        assert.equal(isSimple('SANDBOX'), false)
    }, { modes: '{ not json' })
})
