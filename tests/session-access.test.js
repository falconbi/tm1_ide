'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { canManageSession } = require('../core/session_access')

test('owner can manage a change set, another user cannot', () => {
    const s = { user: 'JDLove' }
    assert.equal(canManageSession('jdlove', s), true)
    assert.equal(canManageSession('someone-else', s), false)
    assert.equal(canManageSession('someone-else', s, { isAdmin: true }), true)
})
