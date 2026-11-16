'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))
const arReal = require(resolve('core/adapter_registry'))
const fake = {
    async post(route) {
        if (route === 'GitStatus') return { URL: 'https://repo', Remote: { Branches: [] }, DeployedCommit: { ID: 'C1' } }
        if (route === 'GitPush') return { ID: 'P1' }
        return {}
    },
}
require.cache[resolve('core/adapter_registry')] = {
    id: resolve('core/adapter_registry'), filename: resolve('core/adapter_registry'), loaded: true,
    exports: { ...arReal, makeClient: () => fake },
}
let held = false
require.cache[resolve('core/git-lock')] = {
    id: resolve('core/git-lock'), filename: resolve('core/git-lock'), loaded: true,
    exports: {
        async acquire() {
            if (held) { const e = new Error('busy'); e.refused = true; throw e }
            held = true
            return { by: 'drift check' }
        },
        async release() { held = false; return { ok: true } },
    },
}
require.cache[resolve('core/git-repo')] = {
    id: resolve('core/git-repo'), filename: resolve('core/git-repo'), loaded: true,
    exports: { git: () => '', authUrl: u => u, sanitize: s => s },
}
require.cache[resolve('core/git-state')] = {
    id: resolve('core/git-state'), filename: resolve('core/git-state'), loaded: true,
    exports: { lastDeployed: () => ({ lastDeployedCommit: 'C1' }) },
}
const { driftCheck } = require(resolve('core/git-drift'))

test('concurrent drift checks do not race the prod-live push', async () => {
    const [a, b] = await Promise.all([driftCheck('TGT'), driftCheck('TGT')])
    const results = [a, b]
    assert.equal(results.filter(r => r.busy).length, 1)
    assert.equal(results.filter(r => !r.busy && r.error == null).length, 1)
})
