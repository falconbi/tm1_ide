'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))
const docs = {}
const fakeClient = {
    async ensureFolderPath() {},
    async listFiles() { return Object.keys(docs).map(name => ({ name, isFolder: false })) },
    async createFileDocument(_parts, name) { docs[name] = '' },
    async putFileContent(_parts, name, body) { docs[name] = body },
    async getFileContent(_parts, name) { return docs[name] },
}
require.cache[resolve('core/adapter-registry')] = {
    id: resolve('core/adapter-registry'), filename: resolve('core/adapter-registry'), loaded: true,
    exports: { makeClient: () => fakeClient, isReadOnly: () => false, listServers: () => [] },
}
const tool = require(resolve('tools/migrate-governance.js'))

test('manifest-only arguments keep the server and areas', () => {
    const opts = tool.parseArgs(['--manifest', 'TM1_Test_DEV', '--local', '--areas', 'changeSets,assertions'])
    assert.equal(opts.manifestServer, 'TM1_Test_DEV')
    assert.equal(opts.local, true)
    assert.deepEqual(opts.areas, ['changeSets', 'assertions'])
})

test('normal migration arguments collect every server', () => {
    const opts = tool.parseArgs(['TM1_Test_DEV', 'TM1_Test_PROD'])
    assert.deepEqual(opts.servers, ['TM1_Test_DEV', 'TM1_Test_PROD'])
    assert.equal(opts.fromMarkers, false)
})

test('the default manifest has all four areas set to local', () => {
    assert.deepEqual(tool.emptyManifest(), {
        version: 1,
        areas: { changeSets: 'local', approvals: 'local', deployState: 'local', assertions: 'local' },
    })
})

test('writeManifest writes and reads the document back', async () => {
    const manifest = { version: 1, areas: { changeSets: 'model', approvals: 'model', deployState: 'model', assertions: 'local' } }
    const log = console.log
    console.log = () => {}
    try {
        const back = await tool.writeManifest('TM1_Test_DEV', manifest)
        assert.deepEqual(back, manifest)
        assert.deepEqual(JSON.parse(docs['manifest.json']), manifest)
    } finally { console.log = log }
})

test('--areas changes only the named areas and preserves the others', async () => {
    docs['manifest.json'] = JSON.stringify({
        version: 1,
        areas: { changeSets: 'model', approvals: 'model', deployState: 'model', assertions: 'local' },
    })
    const log = console.log
    console.log = () => {}
    try {
        await tool.writeOnly({ manifestServer: 'TM1_Test_DEV', model: true, local: false, areas: ['assertions'] })
        assert.deepEqual(JSON.parse(docs['manifest.json']).areas, {
            changeSets: 'model', approvals: 'model', deployState: 'model', assertions: 'model',
        })
    } finally { console.log = log }
})
