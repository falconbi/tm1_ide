'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, o) => { const r = resolve(rel); require.cache[r] = { id: r, filename: r, loaded: true, exports: o } }

const realBsq = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBsq(':memory:') } }

const cl = require(path.join(__dirname, '..', 'core', 'change_log'))
const { linkedChangeSet } = require(path.join(__dirname, '..', 'core', 'git-approvals'))

// COMMIT = the short prefix below is what callers (approve route) usually pass.
const FULL = '5f7a2e10c9d4b8a3f6e1d0c2b4a687950f3e2d1c'

test('approval links only through a release built for the target (rule 1 + target)', () => {
  const s = cl.startSession('Released', 'DEV1', 'admin')
  cl.closeSession(s.id, { user: 'admin' })
  cl.setSessionRelease(s.id, FULL, 'TG1')
  cl.setSessionCommit(s.id, 'aaaaaaaa1111')     // a raw DEV commit too — not linkable

  // Another session holds the same commit as a bare commit_ref — no release.
  const s2 = cl.startSession('Commit-only', 'DEV1', 'admin')
  cl.closeSession(s2.id, { user: 'admin' })
  cl.setSessionCommit(s2.id, FULL)

  assert.equal(linkedChangeSet('5f7a2e10', 'TG1')?.id, s.id, 'short prefix matches the release (sameCommit)')
  assert.equal(linkedChangeSet(FULL, 'TG1')?.id, s.id, 'full id matches too')
  assert.equal(linkedChangeSet('5f7a2e10', 'OTHER'), null, 'release built for another target is refused')
  assert.equal(linkedChangeSet('aaaaaaaa11', 'TG1'), null, 'a raw commit_ref is never linked (rule 1)')
})

test('an open (unclosed) change set is never linkable', () => {
  const open = cl.startSession('Open release', 'DEV1', 'admin')
  cl.setSessionRelease(open.id, 'cafe1234cafe1234cafe1234cafe1234cafe1234', 'TG1')   // not closed
  assert.equal(linkedChangeSet('cafe1234', 'TG1'), null)
})