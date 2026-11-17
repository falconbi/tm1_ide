'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))
const arReal = require(resolve('core/adapter-registry'))
const doc = [{ id: 'a1', description: 'one', mdx: 'SELECT 5', expected: 5, tolerance: 0.01, tags: [], kind: 'control', severity: 'block' }]
const fake = {
    async listFiles() { return [{ name: 'assertions.json', isFolder: false }] },
    async getFileContent() { return doc },
    async executeMDX() { return { Cells: [{ Value: 5 }] } },
}
require.cache[resolve('core/adapter-registry')] = {
    id: resolve('core/adapter-registry'), filename: resolve('core/adapter-registry'), loaded: true,
    exports: { ...arReal, makeClient: () => fake },
}
let recorded = null
require.cache[resolve('core/test-results')] = {
    id: resolve('core/test-results'), filename: resolve('core/test-results'), loaded: true,
    exports: { recordRun: async (_c, r) => { recorded = r; return 'RUN' }, recentRuns: async () => [] },
}
const assertions = require(resolve('core/assertions'))

test('runOne records the single run to }TestResults', async () => {
    recorded = null
    const r = await assertions.runOne('SRV', 'a1')
    assert.equal(r.pass, true)
    assert.equal(recorded.results.length, 1)
    assert.equal(recorded.results[0].id, 'a1')
})

test('non-finite expected/tolerance are refused before any store write', async () => {
    await assert.rejects(() => assertions.add('SRV', { description: 'bad', mdx: '1', expected: 'not-a-number' }), /finite number/)
    await assert.rejects(() => assertions.update('SRV', 'a1', { tolerance: -1 }), /zero or greater|finite number/)
})
