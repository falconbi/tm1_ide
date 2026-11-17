import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadViewSessions } from '../client/src/lib/view-editor/view-sessions.js'

test('a throwing localStorage reads as no sessions', () => {
  globalThis.localStorage = { getItem() { throw new Error('denied') }, setItem() {} }
  assert.deepEqual(loadViewSessions(), [])
})
