'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TM1Client } = require('../core/tm1_client')
const { odataKey } = require('../core/odata-key')

// Some TM1 versions NO-OP a rename (PATCH returns 200, the name stays). The IDE
// and the MCP both rely on renameElement — it must verify the rename actually
// took and throw a clear error when it didn't, so a rename that never happened
// is never reported as success or logged as a change.
function clientWith(adapter) {
  return new TM1Client('TestServer', {
    async get(path, params) { return adapter.get(path, params) },
    async patch(path, body) { return adapter.patch(path, body) },
    async post() { throw new Error('not used') },
    async delete() { throw new Error('not used') },
    async put() { throw new Error('not used') },
  })
}

test('renameElement resolves when the rename actually took (verifies the new name exists, old name gone)', async () => {
  const seen = { patch: [], get: [] }
  const c = clientWith({
    async patch(route) { seen.patch.push(String(route)); return {} },
    async get(route) {
      seen.get.push(String(route))
      // The NEW name resolves to the renamed element…
      if (String(route).includes(odataKey(`New's Name`))) return { Name: `New's Name` }
      // …and the OLD name is gone — otherwise the rename didn't really take.
      throw { response: { status: 404 } }
    },
  })
  await c.renameElement('Dim', `Old's Name`, `New's Name`)
  assert.equal(seen.patch[0], `Dimensions('${odataKey('Dim')}')/Hierarchies('${odataKey('Dim')}')/Elements('${odataKey(`Old's Name`)}')`)
  assert.equal(seen.get[0], `Dimensions('${odataKey('Dim')}')/Hierarchies('${odataKey('Dim')}')/Elements('${odataKey(`New's Name`)}')`)
  assert.equal(seen.get[1], `Dimensions('${odataKey('Dim')}')/Hierarchies('${odataKey('Dim')}')/Elements('${odataKey(`Old's Name`)}')`)
})

test('renameElement throws a clear error when TM1 no-ops the rename', async () => {
  const c = clientWith({
    async patch() { return {} },            // TM1 answers OK…
    async get() { throw { response: { status: 404 } } },  // …but the new name never appears
  })
  await assert.rejects(
    () => c.renameElement('Dim', 'Old', 'New'),
    /isn't supported on this TM1 version — create the new element and move its data instead/
  )
})

test('renameElement throws when renaming onto an existing element name (old name never disappears)', async () => {
  // A → B where B ALREADY exists: the new-name read finds B, but the old A is
  // still there too — nothing was actually renamed.
  const c = clientWith({
    async patch() { return {} },
    async get(route) {
      const r = String(route)
      if (r.includes(odataKey('New'))) return { Name: 'New' }   // B pre-existed
      if (r.includes(odataKey('Old'))) return { Name: 'Old' }   // A still present
      throw { response: { status: 404 } }
    },
  })
  let successBranchReached = false
  try {
    await c.renameElement('Dim', 'Old', 'New')
    successBranchReached = true                 // the caller's "renamed + log" path
  } catch (e) {
    assert.match(String(e.message), /isn't supported on this TM1 version/)
  }
  assert.equal(successBranchReached, false, 'a rename onto an existing element never reports success / logs')
})

test('renameElement skips the old-name check for case/space-only renames', async () => {
  // TM1 treats "Men's Wear" and "men'swear" as the same element — the exact
  // new-name comparison decides; the old name is never expected to disappear.
  await assert.rejects(
    () => clientWith({
      async patch() { return {} },
      async get(route) {
        if (String(route).includes(odataKey('MEN\'S'))) return { Name: `Men's Wear` }  // stored casing preserved
        throw { response: { status: 404 } }
      },
    }).renameElement('Dim', `Men's Wear`, `MEN'S WEAR`),
    /isn't supported on this TM1 version/
  )
})

test('renameElement throws when the new-name read returns something unexpected', async () => {
  const c = clientWith({
    async patch() { return {} },
    async get() { return { Name: 'Something Else' } },
  })
  await assert.rejects(() => c.renameElement('Dim', 'Old', 'New'), /isn't supported on this TM1 version/)
})