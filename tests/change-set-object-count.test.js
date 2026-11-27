'use strict'

// The Change Sets header/panel count is "objects touched", not log rows. Moving
// two elements into a new consolidation records five rows on ONE dimension, and
// reads as one change — the same number the release ships.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

// In-memory change log (change-log.js opens `data/change_log.db` at require time).
const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))

const SERVER = 'COUNT-TEST'
const log = (action, type, name, detail = null) =>
    cl.writeLog({ server: SERVER, action, objectType: type, objectName: name, detail, user: 'admin' })

test('five element edits on one dimension are one change', () => {
    const s = cl.startSession('Contractor rollup', SERVER, 'admin')
    log('ELEMENT_ADDED', 'dimension', 'WFP Employee', 'Contractors before All Employees')
    log('ELEMENT_LINKED', 'dimension', 'WFP Employee', 'E10001 under Contractors')
    log('ELEMENT_LINKED', 'dimension', 'WFP Employee', 'E10002 under Contractors')
    log('EDGE_REMOVED', 'dimension', 'WFP Employee', 'All Employees · removed E10001')
    log('EDGE_REMOVED', 'dimension', 'WFP Employee', 'All Employees · removed E10002')

    const entries = cl.getSessionLog(s.id)
    assert.equal(entries.length, 5, 'five rows are kept (the audit)')
    assert.equal(cl.changeObjectCount(entries), 1, 'but one object changed')

    // The SQL used by the Change Sets list agrees with the JS used by the header.
    const list = cl.getSessions(SERVER, 10)
    assert.equal(list.length, 1)
    assert.equal(list[0].entry_count, 1)
})

test('a subset is its own object; two same-named subsets on different dimensions do not merge', () => {
    const s = cl.startSession('Subsets', SERVER, 'admin')
    log('SUBSET_SAVED', 'subset', 'Default', 'WFP Employee')
    log('SUBSET_SAVED', 'subset', 'Default', 'WFP Position')
    assert.equal(cl.changeObjectCount(cl.getSessionLog(s.id)), 2)
})

test('a rule belongs to its cube; runs and decisions are not objects', () => {
    const s = cl.startSession('Rules', SERVER, 'admin')
    log('RULES_SAVED', 'rules', 'WFP Assignment')
    log('CUBE_UPDATED', 'cube', 'WFP Assignment')
    log('PROCESS_RUN', 'process-run', 'Load People')
    log('REFRESH_DECISION', 'decision', 'delete E10001')
    assert.equal(cl.changeObjectCount(cl.getSessionLog(s.id)), 1)
    assert.equal(cl.getSessions(SERVER, 10).find(x => x.id === s.id).entry_count, 1)
})
