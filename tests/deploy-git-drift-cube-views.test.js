'use strict'

// A cube file lists its views (`Views@Code.links`), so adding or removing a view
// changes the cube's file too. When the ONLY difference in a drifted cube file is
// that list, the drift is the view family: TM1's pull never applies views, the IDE
// applies them over REST, and a release that carries the cube file replaces the list
// with one that already contains the target's views.
//
// Blocking on it made a target whose cube file was out of date UNDEPLOYABLE: every
// deploy was refused with "re-apply the change and release it", and that release was
// refused by the same gate. (Found live, 22 Nov 2026 — a release had shipped views
// without their cube file.)

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, exportsObj) => {
    const r = resolve(rel)
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exportsObj }
}

const cube = (views, extra = {}) => JSON.stringify({
    '@type': 'Cube', Name: 'C',
    Dimensions: [{ '@id': "Dimensions('D')" }],
    'Rules@Code.link': 'C.rules',
    'Views@Code.links': views,
    ...extra,
}, null, '\t')

function load({ deployedCube, liveCube }) {
    const arReal = require(resolve('core/adapter-registry'))
    stub('core/adapter-registry', {
        ...arReal,
        makeClient: () => ({
            async post(route) {
                if (route === 'GitStatus') return { URL: 'https://repo', Remote: { Branches: ['prod-live'] }, DeployedCommit: { ID: 'C1' } }
                if (route === 'GitPush') return { ID: 'P1' }
                return {}
            },
        }),
    })
    stub('core/git-lock', { acquire: async () => ({}), release: async () => ({}) })
    stub('core/git-repo', {
        authUrl: (u) => u,
        sanitize: (s) => s,
        git: (cwd, ...args) => {
            if (args[0] === 'diff' && args[1] === '--name-status') return 'M\tcubes/C.json\n'
            if (args[0] === 'diff') return ''
            if (args[0] === 'show') {
                const ref = args[1]
                if (ref.startsWith('origin/prod-live:')) return liveCube
                return deployedCube
            }
            return ''
        },
    })
    stub('core/git-state', { lastDeployed: () => ({ lastDeployedCommit: 'C1' }) })
    delete require.cache[resolve('core/git-drift')]
    return require('../core/git-drift')
}

test('a cube file that differs only in its view list does not block', async () => {
    const { driftCheck } = load({
        deployedCube: cube(['C.views/V1.json']),
        liveCube: cube(['C.views/V1.json', 'C.views/V2.json']),
    })
    const r = await driftCheck('TGT', { lock: false })
    assert.equal(r.entries.length, 1)
    assert.equal(r.entries[0].blocking, false)
    assert.equal(r.entries[0].kind, 'cube-views')
    assert.match(r.entries[0].note, /view/i)
})

test('a cube file that changed anywhere else still blocks', async () => {
    const { driftCheck } = load({
        deployedCube: cube(['C.views/V1.json']),
        liveCube: cube(['C.views/V1.json', 'C.views/V2.json'], { Dimensions: [{ '@id': "Dimensions('E')" }] }),
    })
    const r = await driftCheck('TGT', { lock: false })
    assert.equal(r.entries[0].blocking, true)
})
