'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, o) => { const r = resolve(rel); require.cache[r] = { id: r, filename: r, loaded: true, exports: o } }

const { sameCommit } = require(resolve('core/git-approvals'))

test('a short stored ID is found by its full ID', () => {
    assert.equal(sameCommit('73c5f1a', '73c5f1a98b4def01234567abcdef0123456789ab'), true)
})

test('a full stored ID is found by its short ID', () => {
    assert.equal(sameCommit('73c5f1a98b4def01234567abcdef0123456789ab', '73c5f1a'), true)
})

test('a 6-character prefix does NOT match (too ambiguous)', () => {
    assert.equal(sameCommit('73c5f1', '73c5f1a98b4def'), false)
})

test('a different commit does not match', () => {
    assert.equal(sameCommit('73c5f1a1111', '73c5f2a2222'), false)
    assert.equal(sameCommit('1111111', '2222222'), false)
})

test('find() resolves a truncated commit to the stored full ID', async () => {
    // Force the local-file read path (no model / makeClient needed).
    const realStore = require(resolve('core/model-store'))
    stub('core/model-store', { ...realStore, isMigrated: () => false })
    const ga = require(resolve('core/git-approvals'))
    const FILE = ga.FILE
    const backup = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null
    const stored = [{ target: 'TG1', commit: '73c5f1a98b4def01234567abcdef0123456789ab', approver: 'u', approved_at: 'now' }]
    try {
        fs.writeFileSync(FILE, JSON.stringify(stored, null, 2))
        const found = await ga.find('TG1', '73c5f1a')
        assert.ok(found, 'short query must find the stored full ID')
        assert.equal(found.commit, stored[0].commit)
        const miss = await ga.find('TG1', '73c5f1')     // 6 chars — too short
        assert.equal(miss, null)
        const other = await ga.find('TG1', '9999999')   // different commit
        assert.equal(other, null)
    } finally {
        if (backup === null) { try { fs.rmSync(FILE, { force: true }) } catch { /* ignore */ } }
        else fs.writeFileSync(FILE, backup)
    }
})