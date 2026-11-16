import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultUserGroups, orderGroups } from '../client/src/lib/user-groups.js'

test('a new user starts with no groups', () => {
    assert.deepEqual([...defaultUserGroups()], [])
})

test('the ADMIN group is listed last', () => {
    assert.deepEqual(orderGroups(['Finance', 'ADMIN', 'Planning']), ['Finance', 'Planning', 'ADMIN'])
})
