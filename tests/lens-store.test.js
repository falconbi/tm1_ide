'use strict'
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

// Lenses live in the model: core/lens_store.js stores one document per Lens
// through core/model-store.js. Swap model-store for an in-memory stand-in so the
// test runs offline, then check save / version / read / list / delete behaviour.
const storePath = path.join(__dirname, '..', 'core', 'model-store.js')
const docs = new Map()            // `${server}|${area}|${name}` -> data
const calls = []
require.cache[require.resolve(storePath)] = {
  id: storePath, filename: storePath, loaded: true,
  exports: {
    async listDocs(server, area, opts) {
      calls.push(['list', server, area, opts?.client])
      return [...docs.keys()].filter(k => k.startsWith(`${server}|${area}|`)).map(k => k.split('|')[2])
    },
    async readDoc(server, area, name, opts) { calls.push(['read', server, area, name, opts?.client]); return docs.get(`${server}|${area}|${name}`) ?? null },
    async writeDoc(server, area, name, data, opts) { calls.push(['write', server, area, name, opts?.client]); docs.set(`${server}|${area}|${name}`, data); return data },
    async deleteDoc(server, area, name, opts) {
      calls.push(['delete', server, area, name, opts?.client])
      const k = `${server}|${area}|${name}`
      if (!docs.has(k)) throw new Error(`Applications/Governance/Lenses/${name} not found on ${server}`)
      docs.delete(k)
    },
  },
}
delete require.cache[require.resolve('../core/lens_store')]
const lens = require('../core/lens_store')

beforeEach(() => { docs.clear(); calls.length = 0 })

test('saveLens writes one document per Lens in the lenses area of that server', async () => {
  const saved = await lens.saveLens('SrvA', 'Ownership-Tree', '<p>hi</p>', 'admin', { description: 'who owns whom' })
  assert.equal(saved.name, 'Ownership-Tree')
  assert.equal(saved.version, 1)
  assert.equal(saved.status, 'draft')
  assert.equal(saved.toolkitVersion, lens.TOOLKIT_VERSION)
  assert.equal(saved.html, undefined, 'details returned without the HTML')
  assert.deepEqual(calls.find(c => c[0] === 'write'), ['write', 'SrvA', 'lenses', 'Ownership-Tree.json'])
  assert.equal(docs.get('SrvA|lenses|Ownership-Tree.json').html, '<p>hi</p>')
})

test('saving again counts the version up and keeps who created it', async () => {
  await lens.saveLens('SrvA', 'L1', '<p>1</p>', 'admin')
  const second = await lens.saveLens('SrvA', 'L1', '<p>2</p>', 'jdlove', { publish: true })
  assert.equal(second.version, 2)
  assert.equal(second.status, 'published')
  assert.equal(second.owner, 'jdlove')
  assert.equal(second.createdBy, 'admin')
  assert.equal((await lens.readLens('SrvA', 'L1')).html, '<p>2</p>')
})

test('listLenses returns details only, sorted, for that server only', async () => {
  await lens.saveLens('SrvA', 'Zeta', '<p/>', 'a')
  await lens.saveLens('SrvA', 'Alpha', '<p/>', 'a')
  await lens.saveLens('SrvB', 'Other', '<p/>', 'a')
  const list = await lens.listLenses('SrvA')
  assert.deepEqual(list.map(l => l.name), ['Alpha', 'Zeta'])
  assert.ok(list.every(l => l.html === undefined))
})

test('readLens of a missing Lens is an error, not an empty result', async () => {
  await assert.rejects(() => lens.readLens('SrvA', 'Nope'), /Lens "Nope" not found on SrvA/)
})

test('deleteLens removes it; deleting a missing Lens is an error', async () => {
  await lens.saveLens('SrvA', 'Gone', '<p/>', 'a')
  await lens.deleteLens('SrvA', 'Gone')
  assert.equal(docs.has('SrvA|lenses|Gone.json'), false)
  await assert.rejects(() => lens.deleteLens('SrvA', 'Gone'), /not found/)
})

test('names with anything but letters, digits, - or _ are refused', async () => {
  await assert.rejects(() => lens.saveLens('SrvA', '../escape', '<p/>', 'a'), /Invalid lens name/)
  await assert.rejects(() => lens.readLens('SrvA', 'a b'), /Invalid lens name/)
})

test('reads/list can run through a given client (the Lens app reads as the viewer)', async () => {
  await lens.saveLens('SrvA', 'Mine', '<p>1</p>', 'a')
  const viewerClient = { fake: true }
  await lens.listLenses('SrvA', { client: viewerClient })
  await lens.readLens('SrvA', 'Mine', { client: viewerClient })
  assert.equal(calls.find(c => c[0] === 'list')[3], viewerClient, 'listDocs got the viewer client')
  assert.equal(calls.find(c => c[0] === 'read')[4], viewerClient, 'readDoc got the viewer client')
})
