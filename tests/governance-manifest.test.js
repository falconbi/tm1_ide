'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const store = require(path.join(__dirname, '..', 'core', 'model-store'))
const AREAS = { changeSets: 'model', approvals: 'model', deployState: 'model', assertions: 'local' }

function client({ files = [{ name: 'manifest.json', isFolder: false }], content = null, listError = null, readError = null } = {}) {
    return {
        async listFiles() { if (listError) throw listError; return files },
        async getFileContent() { if (readError) throw readError; return typeof content === 'string' ? content : JSON.stringify(content) },
    }
}
const manifest = (areas = AREAS, version = 1) => ({ version, areas })

test('a missing manifest throws GovernanceManifestError naming the server and the fix', async () => {
    await assert.rejects(
        () => store.readManifest('NO_MANIFEST', { client: client({ files: [] }) }),
        (e) => e instanceof store.GovernanceManifestError &&
            /NO_MANIFEST/.test(e.message) &&
            /node tools\/migrate-governance\.js --manifest NO_MANIFEST --local/.test(e.message)
    )
})

test('a 404 on the Governance folder means the manifest is missing', async () => {
    await assert.rejects(
        () => store.readManifest('NO_FOLDER', { client: client({ listError: { response: { status: 404 } } }) }),
        (e) => e instanceof store.GovernanceManifestError && /missing/.test(e.message)
    )
})

test('bad JSON throws GovernanceManifestError', async () => {
    await assert.rejects(
        () => store.readManifest('BAD_JSON', { client: client({ content: '{ not json' }) }),
        (e) => e instanceof store.GovernanceManifestError
    )
})

test('a bad version throws', async () => {
    await assert.rejects(
        () => store.readManifest('BAD_VERSION', { client: client({ content: manifest(AREAS, 2) }) }),
        (e) => e instanceof store.GovernanceManifestError && /version/.test(e.message)
    )
})

test('a missing area throws', async () => {
    const { assertions, ...missing } = AREAS
    await assert.rejects(
        () => store.readManifest('MISSING_AREA', { client: client({ content: manifest(missing) }) }),
        (e) => e instanceof store.GovernanceManifestError && /assertions/.test(e.message)
    )
})

test('an unknown area value throws', async () => {
    await assert.rejects(
        () => store.readManifest('UNKNOWN_AREA', { client: client({ content: manifest({ ...AREAS, approvals: 'sometimes' }) }) }),
        (e) => e instanceof store.GovernanceManifestError && /approvals/.test(e.message)
    )
})

test('model and local areas are read from the manifest', async () => {
    const c = client({ content: manifest() })
    assert.equal(await store.isMigrated('MIXED', 'changeSets', { client: c, identity: 'u1' }), true)
    assert.equal(await store.isMigrated('MIXED', 'assertions', { client: c, identity: 'u1' }), false)
})

test('a failed read is not cached — the next call retries', async () => {
    let reads = 0
    const flaky = {
        async listFiles() { return [{ name: 'manifest.json', isFolder: false }] },
        async getFileContent() {
            reads++
            if (reads === 1) throw new Error('temporary TM1 failure')
            return JSON.stringify(manifest())
        },
    }
    await assert.rejects(() => store.readManifest('FLAKY', { client: flaky, identity: 'u1' }), /temporary TM1 failure/)
    assert.equal((await store.readManifest('FLAKY', { client: flaky, identity: 'u1' })).version, 1)
    assert.equal(reads, 2)
})

test('a valid manifest is cached per server + identity', async () => {
    let reads = 0
    const c = {
        async listFiles() { return [{ name: 'manifest.json', isFolder: false }] },
        async getFileContent() { reads++; return JSON.stringify(manifest()) },
    }
    await store.readManifest('CACHED', { client: c, identity: 'a' })
    await store.readManifest('CACHED', { client: c, identity: 'a' })
    assert.equal(reads, 1)
    await store.readManifest('CACHED', { client: c, identity: 'b' })
    assert.equal(reads, 2)
})

test('readDoc can return null for a missing model-owned document when the caller is backfilling', async () => {
    const c = { async listFiles() { return [] }, async getFileContent() { return null } }
    assert.equal(await store.readDoc('MISSING_OK', 'changeSets', 'x.json', { client: c, missingOk: true }), null)
})
