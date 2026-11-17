'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))
const fake = {
    async get(route) {
        if (route === 'Dimensions') return { value: [{ Name: 'Region' }] }
        if (route === 'Cubes') return { value: [{ Name: 'C' }] }
        if (String(route).startsWith("Cubes('C')/Views")) return { value: [{ Name: 'Bad,View' }] }
        return { value: [] }
    },
}
const arReal = require(resolve('core/adapter-registry'))
require.cache[resolve('core/adapter-registry')] = {
    id: resolve('core/adapter-registry'), filename: resolve('core/adapter-registry'), loaded: true,
    exports: { ...arReal, makeClient: () => fake },
}
const { memberRefs, pushReadiness } = require(resolve('core/git-readiness'))

test('memberRefs keeps a ]] name intact', () => {
    assert.deepEqual(memberRefs('[A]]B].[A]]B].[X]]Y]'), [{ dim: 'A]B', hier: 'A]B', member: 'X]Y' }])
})

test('pushReadiness exposes scan blockers', async () => {
    const r = await pushReadiness('SRC')
    assert.equal(r.ok, false)
    assert.ok(r.blockers.some(b => /Bad,View/.test(b)))
})
