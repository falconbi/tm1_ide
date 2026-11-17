'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))
let fakeClient = null
const arReal = require(resolve('core/adapter-registry'))
require.cache[resolve('core/adapter-registry')] = {
    id: resolve('core/adapter-registry'), filename: resolve('core/adapter-registry'), loaded: true,
    exports: { ...arReal, makeClient: () => fakeClient },
}
const { firstPullAnalysis } = require(resolve('core/git-readiness'))

function makeRepo(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1firstpull-fixture-'))
    for (const [rel, content] of Object.entries(files)) {
        const full = path.join(dir, rel)
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, content)
    }
    execFileSync('git', ['init', '-q', '-b', 'dev', dir])
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'])
    execFileSync('git', ['-C', dir, 'add', '-A'])
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'fixture'])
    return dir
}

function repoFixture() {
    return {
        'dimensions/Product.json': '{}',
        'dimensions/Product.hierarchies/Product.json': '{"Elements":[{"Name":"A"},{"Name":"B"}]}',
        'dimensions/Product.hierarchies/Product Alt.json': '{"Elements":[{"Name":"X"}]}',
        'dimensions/Product.hierarchies/Leaves.json': '{"Elements":[{"Name":"A"}]}',
        'cubes/Sales.json': '{}',
        'processes/Loader.ti': '# Prolog',
        'chores/Nightly.json': '{}',
    }
}

const TARGET = {
    cubes: ['Sales', 'LocalCube', '}Control'],
    dimensions: ['Product', 'Region', '}ControlDim'],
    hierarchies: { Product: ['Product', 'Product Alt', 'Extra', 'Leaves'], Region: ['Region'] },
    elements: {
        'Product/Product': ['A', 'B', 'C'],
        'Product/Product Alt': ['X', 'Y'],
        'Product/Extra': ['Z'],
        'Product/Leaves': ['A', 'B', 'C'],
        'Region/Region': ['North'],
    },
    processes: ['Loader', 'ExtraProc', '}Proc'],
    chores: ['Nightly', 'OldChore', '}Chore'],
}

function unescapeKey(s) { return decodeURIComponent(s).replace(/''/g, "'") }

function fakeTarget({ failRoute = null } = {}) {
    const calls = []
    return {
        calls,
        async post(route) {
            if (route === 'GitStatus') return { URL: 'REPO_URL', DeployedCommit: {} }
            if (route === 'GitPull') return { Operations: ['Create a', 'Update b', 'Delete c', 'Skip d'] }
            throw new Error(`unexpected POST ${route}`)
        },
        async get(route) {
            if (failRoute && failRoute.test(route)) {
                const e = new Error('HTTP 403')
                e.response = { data: { error: { message: 'Access denied' } } }
                throw e
            }
            calls.push(route)
            if (route === 'Cubes') return { value: TARGET.cubes.map(Name => ({ Name })) }
            if (route === 'Processes') return { value: TARGET.processes.map(Name => ({ Name })) }
            if (route === 'Chores') return { value: TARGET.chores.map(Name => ({ Name })) }
            if (route === 'Dimensions') return { value: TARGET.dimensions.map(Name => ({ Name })) }
            let m = route.match(/^Dimensions\('(.+)'\)\/Hierarchies$/)
            if (m) {
                const dim = unescapeKey(m[1])
                return { value: (TARGET.hierarchies[dim] ?? []).map(Name => ({ Name })) }
            }
            m = route.match(/^Dimensions\('(.+)'\)\/Hierarchies\('(.+)'\)\/Elements$/)
            if (m) {
                const dim = unescapeKey(m[1]), hier = unescapeKey(m[2])
                return { value: (TARGET.elements[`${dim}/${hier}`] ?? []).map(Name => ({ Name })) }
            }
            throw new Error(`unexpected GET ${route}`)
        },
    }
}

test('the analysis compares every hierarchy, lists target-only objects and counts loss', async () => {
    const dir = makeRepo(repoFixture())
    const client = fakeTarget()
    fakeClient = client
    try {
        const r = await firstPullAnalysis('TM1_TEST', { repoUrl: dir, branch: 'dev', token: 'secret' })
        assert.equal(r.complete, true)
        assert.equal(r.deployedCommit, null)
        assert.deepEqual(r.plan, { create: 1, update: 1, delete: 1, skip: 1 })
        assert.deepEqual(r.targetOnly, {
            cubes: ['LocalCube'],
            dimensions: ['Product', 'Region'],
            processes: ['ExtraProc'],
            chores: ['OldChore'],
        })
        assert.deepEqual(r.elementLoss, [
            { dimension: 'Product', hierarchy: 'Product', count: 1, sample: ['C'] },
            { dimension: 'Product', hierarchy: 'Product Alt', count: 1, sample: ['Y'] },
        ])
        assert.deepEqual(r.loss, { elements: 2, dimensions: 1 })
        assert.equal(r.confirmText, 'I understand this overwrites TM1_TEST and removes 2 elements in 1 dimensions')
        assert.ok(!client.calls.some(c => /Hierarchies\('Leaves'\)\/Elements/.test(c)), 'Leaves is never read')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a clean target asks for the plain overwrite sentence', async () => {
    const dir = makeRepo(repoFixture())
    const clean = {
        ...TARGET,
        cubes: ['Sales'], dimensions: ['Product'], processes: ['Loader'], chores: ['Nightly'],
        hierarchies: { Product: ['Product', 'Product Alt', 'Leaves'] },
        elements: {
            'Product/Product': ['A', 'B'],
            'Product/Product Alt': ['X'],
        },
    }
    const client = fakeTarget()
    client.get = (route => {
        const original = fakeTarget().get
        return async (r) => {
            const saved = TARGET
            void saved
            if (r === 'Cubes') return { value: clean.cubes.map(Name => ({ Name })) }
            if (r === 'Processes') return { value: clean.processes.map(Name => ({ Name })) }
            if (r === 'Chores') return { value: clean.chores.map(Name => ({ Name })) }
            if (r === 'Dimensions') return { value: clean.dimensions.map(Name => ({ Name })) }
            let m = r.match(/^Dimensions\('(.+)'\)\/Hierarchies$/)
            if (m) return { value: clean.hierarchies[unescapeKey(m[1])].map(Name => ({ Name })) }
            m = r.match(/^Dimensions\('(.+)'\)\/Hierarchies\('(.+)'\)\/Elements$/)
            if (m) return { value: clean.elements[`${unescapeKey(m[1])}/${unescapeKey(m[2])}`].map(Name => ({ Name })) }
            return original(r)
        }
    })()
    fakeClient = client
    try {
        const r = await firstPullAnalysis('TM1_TEST', { repoUrl: dir, branch: 'dev', token: 'secret' })
        assert.equal(r.complete, true)
        assert.deepEqual(r.elementLoss, [])
        assert.deepEqual(r.loss, { elements: 0, dimensions: 0 })
        assert.equal(r.confirmText, 'I understand this overwrites TM1_TEST')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('any failed target read makes the analysis incomplete with TM1\'s message', async () => {
    const dir = makeRepo(repoFixture())
    fakeClient = fakeTarget({ failRoute: /Hierarchies\('Product'\)\/Elements$/ })
    try {
        const r = await firstPullAnalysis('TM1_TEST', { repoUrl: dir, branch: 'dev', token: 'secret' })
        assert.equal(r.complete, false)
        assert.match(r.reason, /Product/)
        assert.match(r.reason, /Access denied/)
        assert.equal(r.confirmText, null)
        assert.deepEqual(r.elementLoss, [])
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a missing repo URL is incomplete, not safe', async () => {
    fakeClient = {
        async post(route) {
            if (route === 'GitStatus') return {}
            if (route === 'GitPull') return { Operations: [] }
            throw new Error('unexpected')
        },
        async get() { throw new Error('should not read the target') },
    }
    const r = await firstPullAnalysis('TM1_TEST', { token: 'secret' })
    assert.equal(r.complete, false)
    assert.match(r.reason, /no repository URL/)
    assert.equal(r.confirmText, null)
})

test('a GitStatus failure is incomplete and never leaks the token', async () => {
    fakeClient = {
        async post(route) {
            if (route === 'GitStatus') {
                const e = new Error('bad https://user:secret@example.invalid/repo.git')
                throw e
            }
            throw new Error('unexpected')
        },
        async get() { throw new Error('should not read the target') },
    }
    const r = await firstPullAnalysis('TM1_TEST', { token: 'secret' })
    assert.equal(r.complete, false)
    assert.match(r.reason, /GitStatus failed/)
    assert.ok(!r.reason.includes('secret'))
})
