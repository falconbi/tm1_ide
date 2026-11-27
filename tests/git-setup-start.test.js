'use strict'

// Part C — setup is TM1 writing its OWN objects into Git, not a pull onto the
// server. A target's own write becomes Last Deployed; DEV keeps `dev` and gets
// no deploy baseline. A server linked under the wrong label is refused.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, exportsObj) => {
    const r = resolve(rel)
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exportsObj }
}

function load({ label = 'PROD', branches = [], link = true } = {}) {
    const calls = []
    const posted = []
    const fake = {
        async post(route, body) {
            posted.push([route, body])
            if (route === 'GitStatus') return {
                URL: link ? 'https://repo' : null,
                Deployment: label,
                Remote: { Branches: branches },
            }
            if (route === 'GitPush') return { ID: 'P1', NewCommit: { ID: 'C' + (posted.length) } }
            return {}
        },
        async get() { return { value: [] } },
    }
    stub('core/adapter-registry', { makeClient: () => fake, isReadOnly: () => false })
    stub('core/git-state', {
        lastDeployed: () => null,
        recordDeploy: async (server, commit, summary) => { calls.push(['record', server, commit, summary]); return { ok: true } },
        load: () => ({}), FILE: '',
    })
    stub('core/git-attrs', {
        attrsBranch: (s) => `attrs-${s}`,
        collectAttrsFiles: async () => ({}),
        writeAttrsBranch: async (server, { message }) => { calls.push(['attrs', server, message]); return { ok: true, changed: true, commit: 'A1' } },
    })
    delete require.cache[resolve('core/git-setup')]
    const mod = require('../core/git-setup')
    return { mod, calls, posted }
}

test('a PROD target pushes its own objects to live-<server> and records that as Last Deployed', async () => {
    const { mod, calls, posted } = load({ label: 'PROD' })
    const r = await mod.setupServer('P1', { gitUser: 'g', token: 't' })
    assert.equal(r.ok, true, r.error)
    assert.equal(r.branch, 'live-P1')
    const push = posted.find(([route]) => route === 'GitPush')[1]
    assert.equal(push.NewBranch, 'live-P1', 'first push creates the live branch')
    assert.ok(calls.some(([what, server, commit]) => what === 'record' && server === 'P1' && commit), 'target write recorded')
    assert.ok(calls.some(([what, server]) => what === 'attrs' && server === 'P1'), 'attributes initialisation written')
    assert.equal(r.lastDeployed, r.commit)
})

test('DEV writes to dev and gets no deploy baseline', async () => {
    const { mod, calls, posted } = load({ label: 'DEV', branches: ['dev'] })
    const r = await mod.setupServer('D1', { gitUser: 'g', token: 't' })
    assert.equal(r.ok, true, r.error)
    assert.equal(r.branch, 'dev')
    assert.equal(r.lastDeployed, null)
    const push = posted.find(([route]) => route === 'GitPush')[1]
    assert.equal(push.Branch, 'dev', 'an existing dev branch is pushed, not recreated')
    assert.ok(!calls.some(([what]) => what === 'record'), 'DEV has no Last Deployed')
})

test('a server linked under the wrong label is refused', async () => {
    const { mod } = load({ label: 'PROD' })
    const r = await mod.setupServer('D1', { deployment: 'DEV', gitUser: 'g', token: 't' })
    assert.equal(r.ok, false)
    assert.equal(r.refused, true)
    assert.match(r.error, /linked as PROD, not DEV/)
})

test('a TEST target uses its own live branch even when other targets exist', async () => {
    const { mod, posted } = load({ label: 'TEST' })
    const r = await mod.setupServer('T1', { gitUser: 'g', token: 't' })
    assert.equal(r.ok, true, r.error)
    assert.equal(r.branch, 'live-T1')
    assert.equal(posted.find(([route]) => route === 'GitPush')[1].NewBranch, 'live-T1')
})

test('startAttrs writes only the attributes branch, never pushes the server objects', async () => {
    const { mod, calls, posted } = load({ label: 'DEV', branches: ['dev'] })
    const r = await mod.startAttrs('D1', { gitUser: 'g', token: 't' })
    assert.equal(r.ok, true, r.error)
    assert.ok(calls.some(([what, server]) => what === 'attrs' && server === 'D1'), 'attributes written')
    assert.ok(!posted.some(([route]) => route === 'GitPush'), 'no server objects pushed')
    assert.ok(!calls.some(([what]) => what === 'record'), 'no deploy baseline recorded')
})
