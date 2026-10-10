'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

// In-memory sqlite for the test — never touch the real change_log.db.
const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

const cl = require(path.join(__dirname, '..', 'core', 'change_log'))

test('a change set started under "JDLove" is the owner\'s set when signed in as "jdlove"', () => {
    cl.startSession('budget round 1', 'DEV1', 'JDLove')
    const owner = cl.getActiveSession('DEV1', 'JDLove')
    const caseInsensitive = cl.getActiveSession('DEV1', 'jdlove')
    const other = cl.getActiveSession('DEV1', 'someone_else')

    assert.ok(owner, 'owner identity finds their own set')
    assert.equal(caseInsensitive?.id, owner?.id, 'case-insensitive match finds the same set')
    assert.equal(other, null, 'another user does not see it as their active set')
})

test('one open change set per person per server regardless of capitals', () => {
    cl.startSession('second person', 'DEV1', 'samtm1')
    const forSam = cl.getActiveSession('DEV1', 'SAMTM1')
    assert.equal(forSam?.name, 'second person')
    assert.equal(forSam?.user, 'samtm1')
})