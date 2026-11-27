'use strict'

// Part D.4 — bring PROD's own rule/process text onto DEV in a `carry-back`
// change set; stop when a developer already owns the same object. Part D.5 — the
// pre-deploy check stops when DEV deleted something a PROD process uses.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))
const { bringToDev } = require(path.join(__dirname, '..', 'core', 'carry-back'))
const { preDeployCheck } = require(path.join(__dirname, '..', 'core', 'pre-deploy'))

function fakeClient(server, store) {
    return {
        server,
        async get(p) {
            let m = p.match(/^Cubes\('(.+)'\)$/)
            if (m) {
                const name = decodeURIComponent(m[1]).replace(/''/g, "'")
                return store.rules[name] === undefined ? null : { Name: name, Rules: store.rules[name] }
            }
            m = p.match(/^Processes\('(.+)'\)$/)
            if (m) {
                const name = decodeURIComponent(m[1]).replace(/''/g, "'")
                return store.processes[name] ?? null
            }
            throw new Error(`unexpected GET ${p}`)
        },
        async patch(p, body) {
            let m = p.match(/^Cubes\('(.+)'\)$/)
            if (m) { store.rules[decodeURIComponent(m[1]).replace(/''/g, "'")] = body.Rules; return }
            m = p.match(/^Processes\('(.+)'\)$/)
            if (m) {
                const name = decodeURIComponent(m[1]).replace(/''/g, "'")
                const p0 = store.processes[name] ?? {}
                store.processes[name] = {
                    ...p0,
                    PrologProcedure: body.PrologProcedure,
                    MetadataProcedure: body.MetadataProcedure,
                    DataProcedure: body.DataProcedure,
                    EpilogProcedure: body.EpilogProcedure,
                }
                return
            }
            throw new Error(`unexpected PATCH ${p}`)
        },
    }
}

const noFinalize = async () => ({ ok: true, skipped: true })
const closeNow = (id, { user }) => cl.closeSession(id, { user, tests: { passed: 1, total: 1, blocking: 0 } })

test('PROD rule text is copied onto DEV in a closed carry-back change set', async () => {
    const prod = { rules: { Salary: 'NEW RULE FROM PROD;' }, processes: {} }
    const dev = { rules: { Salary: 'OLD RULE;' }, processes: {} }
    const r = await bringToDev({ target: 'PROD', dev: 'DEV', objects: [{ type: 'rules', name: 'Salary' }], user: 'admin' }, {
        clientFor: (s) => fakeClient(s, s === 'PROD' ? prod : dev),
        close: closeNow, finalize: noFinalize, runTests: async () => ({ total: 1, passed: 1, results: [{ pass: true, severity: 'block' }] }),
    })
    assert.equal(r.ok, true, r.error)
    assert.equal(dev.rules.Salary, 'NEW RULE FROM PROD;')
    assert.equal(r.session.kind, 'carry-back')
    assert.ok(r.session.closed_at)
    assert.equal(r.alreadyOnProd, true)
    assert.match(r.session.description, /Already on PROD/)
    const log = cl.getSessionLog(r.session.id)
    assert.equal(log.length, 1)
    assert.equal(log[0].action, 'RULES_SAVED')
    assert.equal(log[0].before_state.text, 'OLD RULE;')
    assert.equal(log[0].after_state.text, 'NEW RULE FROM PROD;')
})

test('a developer already owning the same rule stops the carry-back and is named', async () => {
    const prod = { rules: { Salary: 'PROD TEXT;' }, processes: {} }
    const dev = { rules: { Salary: 'DEV TEXT;' }, processes: {} }
    const mine = cl.startSession('Jo UI work', 'DEV', 'jo')
    cl.writeLog({
        server: 'DEV', action: 'RULES_SAVED', objectType: 'rules', objectName: 'Salary',
        beforeState: { text: 'OLD;' }, afterState: { text: 'DEV TEXT;' }, user: 'jo',
    })

    const before = cl.getSessions('DEV', 1000).length
    const r = await bringToDev({ target: 'PROD', dev: 'DEV', objects: [{ type: 'rules', name: 'Salary' }], user: 'admin' }, {
        clientFor: (s) => fakeClient(s, s === 'PROD' ? prod : dev),
        close: closeNow, finalize: noFinalize, runTests: async () => ({ total: 1, passed: 1, results: [{ pass: true, severity: 'block' }] }),
    })
    assert.equal(r.ok, false)
    assert.equal(r.refused, true)
    assert.match(r.error, /Jo UI work/)
    assert.equal(cl.getSessions('DEV', 1000).length, before, 'no new change set was created')
    assert.equal(dev.rules.Salary, 'DEV TEXT;', 'nothing was written')
    assert.ok(mine.id)
})

test('PROD process text is copied section by section', async () => {
    const prod = { rules: {}, processes: { 'Load People': { Name: 'Load People', PrologProcedure: 'P1;', MetadataProcedure: 'M1;', DataProcedure: 'D1;', EpilogProcedure: 'E1;' } } }
    const dev = { rules: {}, processes: { 'Load People': { Name: 'Load People', PrologProcedure: 'P0;', MetadataProcedure: 'M0;', DataProcedure: 'D0;', EpilogProcedure: 'E0;' } } }
    const r = await bringToDev({ target: 'PROD', dev: 'DEV', objects: [{ type: 'process', name: 'Load People' }], user: 'admin' }, {
        clientFor: (s) => fakeClient(s, s === 'PROD' ? prod : dev),
        close: closeNow, finalize: noFinalize, runTests: async () => ({ total: 1, passed: 1, results: [{ pass: true, severity: 'block' }] }),
    })
    assert.equal(r.ok, true, r.error)
    assert.equal(dev.processes['Load People'].PrologProcedure, 'P1;')
    assert.equal(dev.processes['Load People'].EpilogProcedure, 'E1;')
    const log = cl.getSessionLog(r.session.id)
    assert.equal(log[0].action, 'PROCESS_SAVED')
})

test('a failing block test leaves the carry-back set open', async () => {
    const prod = { rules: { Salary: 'PROD TEXT;' }, processes: {} }
    const dev = { rules: { Salary: 'DEV TEXT;' }, processes: {} }
    const r = await bringToDev({ target: 'PROD2', dev: 'DEV2', objects: [{ type: 'rules', name: 'Salary' }], user: 'admin' }, {
        clientFor: (s) => fakeClient(s, s === 'PROD2' ? prod : dev),
        close: closeNow, finalize: noFinalize,
        runTests: async () => ({ total: 1, passed: 0, results: [{ pass: false, severity: 'block', description: 'Salary total' }] }),
    })
    assert.equal(r.ok, false)
    assert.match(r.error, /left open/)
    assert.match(r.error, /Salary total/)
    assert.equal(cl.getSession(r.session.id).closed_at, null)
    assert.equal(dev.rules.Salary, 'PROD TEXT;', 'the text is still copied; only the close stopped')
})

test('D.5 — a PROD process that uses an object DEV deleted stops the pre-deploy check', async () => {
    const out = await preDeployCheck('PROD', {
        token: 't', gitUser: 'g', session: 'S1',
        deps: {
            idleCheck: async () => ({ running: [] }),
            driftCheck: async () => ({ deployed: 'C1', liveBranch: 'live-PROD', entries: [] }),
            collectAttrsFiles: async () => ({}),
            writeAttrsBranch: async () => ({ ok: true, commit: 'A1', branch: 'attrs-PROD' }),
            sessionLog: () => [],
            recordedChanges: () => ({ deletes: [{ type: 'dimension', name: 'Employee' }], dimensions: new Map() }),
            scanDeletedUsage: async () => [{ process: 'PROD Load', what: 'writes dimension Employee' }],
        },
        client: { post: async () => ({ URL: 'https://repo' }) },
    })
    assert.equal(out.ok, false)
    const stop = out.stops.find(s => s.kind === 'deleted-usage')
    assert.ok(stop, out.stops.map(s => s.kind).join(','))
    assert.match(stop.reason, /PROD Load/)
    assert.match(stop.reason, /deploy that first/)
})
