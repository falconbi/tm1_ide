'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const file = path.join(os.tmpdir(), `process-summaries-${process.pid}.json`)
process.env.PROCESS_SUMMARIES_FILE = file
const store = require('../core/process_summaries')

test.before(() => { try { fs.unlinkSync(file) } catch {} })
test.after(() => { try { fs.unlinkSync(file) } catch {} })

test('summaries are keyed by server + process and invalidated by the code hash', async () => {
    const h1 = store.hashCode('code one')
    const h2 = store.hashCode('code two')
    assert.notEqual(h1, h2)
    await store.put('srv', 'P', { hash: h1, summary: 'Does a thing.', source: 'ai' })
    assert.equal(store.get('srv', 'P', h1).summary, 'Does a thing.')
    assert.equal(store.get('srv', 'P', h2), null, 'changed code invalidates the summary')
    assert.equal(store.getLatest('srv', 'P').hash, h1, 'the old summary is still there to show as stale')
    assert.equal(store.get('other', 'P', h1), null)
})

test('manual summaries can be edited, listed and removed', async () => {
    const h = store.hashCode('code one')
    await store.put('srv', 'P', { hash: h, summary: 'Edited by hand.', source: 'manual' })
    assert.equal(store.get('srv', 'P', h).source, 'manual')
    assert.deepEqual(Object.keys(store.list('srv')), ['P'])
    assert.equal(await store.remove('srv', 'P'), true)
    assert.equal(await store.remove('srv', 'P'), false)
    assert.equal(store.getLatest('srv', 'P'), null)
})

test('concurrent writes keep both summaries', async () => {
    const h = store.hashCode('concurrent')
    await Promise.all([
        store.put('srv', 'P1', { hash: h, summary: 'one', source: 'manual' }),
        store.put('srv', 'P2', { hash: h, summary: 'two', source: 'manual' }),
    ])
    assert.equal(store.get('srv', 'P1', h).summary, 'one')
    assert.equal(store.get('srv', 'P2', h).summary, 'two')
    await store.remove('srv', 'P1')
    await store.remove('srv', 'P2')
})
