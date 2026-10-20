'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { listTemplates, readTemplate, lensHtml } = require('../core/viewfinder')
const { lensWrites } = require('../core/lens_bridge')

// Viewfinder: Lenses built from a template share its code; they store only the
// template name and their config.
test('templates list with their settings help and an example config; each has code', () => {
  const t = listTemplates()
  const form = t.find(x => x.name === 'input-form')
  assert.ok(form, 'the Input form template ships')
  for (const k of ['title', 'description', 'icon', 'settings', 'example']) assert.ok(form[k], k)
  assert.match(readTemplate('input-form'), /Lens\.config\(\)/, 'it is driven by its config')
})

test('a template Lens runs the template\'s code; an unknown or odd name is refused', () => {
  assert.equal(lensHtml({ template: 'input-form', html: 'stale copy' }), readTemplate('input-form'))
  assert.equal(lensHtml({ template: '', html: '<p>own</p>' }), '<p>own</p>')
  assert.throws(() => readTemplate('../../etc/passwd'), /Unknown Viewfinder template/)
  assert.throws(() => readTemplate('no-such-template'), /Unknown Viewfinder template/)
})

test('what a template Lens may write comes from its config (the template declares nothing itself)', () => {
  assert.deepEqual(lensWrites({ template: 'input-form', config: { writes: ['Income Statement'] } }), ['Income Statement'])
})

test('saving a template Lens keeps no copy of the code; an unknown template is refused', async () => {
  const store = require('../core/model-store')
  const saved = {}
  const orig = { readDoc: store.readDoc, writeDoc: store.writeDoc }
  store.readDoc = async () => null
  store.writeDoc = async (s, a, n, doc) => { saved[n] = doc }
  try {
    const ls = require('../core/lens_store')
    const d = await ls.saveLens('S', 'Budget', '<p>ignored</p>', 'me', { template: 'input-form', config: { cube: 'Plan' } })
    assert.equal(d.template, 'input-form')
    assert.equal(saved['Budget.json'].html, '', 'no stale copy of the template stored')
    await assert.rejects(ls.saveLens('S', 'X', '', 'me', { template: 'nope' }), /Unknown Viewfinder template/)
  } finally { Object.assign(store, orig) }
})

test('model templates: saved in the model, listed after the built-ins, found by name; built-in names refused', async () => {
  const store = require('../core/model-store')
  const vf = require('../core/viewfinder')
  const docs = {}
  const orig = { listDocs: store.listDocs, readDoc: store.readDoc, writeDoc: store.writeDoc, deleteDoc: store.deleteDoc }
  store.listDocs = async () => Object.keys(docs)
  store.readDoc = async (s, a, n) => docs[n] ?? null
  store.writeDoc = async (s, a, n, d) => { docs[n] = d }
  store.deleteDoc = async (s, a, n) => { delete docs[n] }
  try {
    const saved = await vf.saveModelTemplate('S', 'pnl-review', { html: '<p>pnl</p>', title: 'P&L review', example: { cube: 'IS' } }, 'me')
    assert.equal(saved.version, 1)
    const all = await vf.listAll('S')
    assert.deepEqual(all.map(t => [t.name, t.source]), [['input-form', 'built-in'], ['line-item-form', 'built-in'], ['pnl-review', 'model']])
    assert.equal((await vf.findTemplate('S', 'pnl-review')).html, '<p>pnl</p>')
    assert.equal(await vf.codeOf('S', { template: 'pnl-review' }), '<p>pnl</p>')
    await assert.rejects(vf.saveModelTemplate('S', 'input-form', { html: 'x' }), /built-in template/)
    await assert.rejects(vf.saveModelTemplate('S', 'Bad Name', { html: 'x' }), /lower-case/)
    await assert.rejects(vf.deleteModelTemplate('S', 'input-form'), /built-in template/)
    await vf.deleteModelTemplate('S', 'pnl-review')
    await assert.rejects(vf.findTemplate('S', 'pnl-review'), /Unknown Viewfinder template/)
  } finally { Object.assign(store, orig) }
})

// Everything the model needs goes with the model: a built-in template is copied
// into the model when a Lens there uses it, and the copy is what Lenses run.
test('saving a Lens copies its built-in template into the model, once; Lenses then run the model copy', async () => {
  const store = require('../core/model-store')
  const vf = require('../core/viewfinder')
  const docs = {}
  const orig = { listDocs: store.listDocs, readDoc: store.readDoc, writeDoc: store.writeDoc }
  store.listDocs = async (s, a) => Object.keys(docs).filter(k => k.startsWith(a + '/')).map(k => k.slice(a.length + 1))
  store.readDoc = async (s, a, n) => docs[`${a}/${n}`] ?? null
  store.writeDoc = async (s, a, n, d) => { docs[`${a}/${n}`] = d }
  try {
    const ls = require('../core/lens_store')
    const first = await ls.saveLens('S', 'Budget', '', 'me', { template: 'input-form', config: { cube: 'Plan' } })
    assert.deepEqual(first.templateCopied, { name: 'input-form', version: 1 }, 'first Lens on a built-in copies it')
    const copy = docs['viewfinder/input-form.json']
    assert.equal(copy.builtIn, true)
    assert.equal(copy.html, vf.readTemplate('input-form'), 'the copy is the built-in code')
    assert.equal(copy.builtInFingerprint, vf.fingerprint(copy.html))

    const second = await ls.saveLens('S', 'Target', '', 'me', { template: 'input-form', config: { cube: 'Target' } })
    assert.equal(second.templateCopied, undefined, 'already in the model — not copied again')

    // The model copy is what runs — even if the built-in on disk is newer.
    docs['viewfinder/input-form.json'] = { ...copy, html: '<p>model copy</p>' }
    assert.equal(await vf.codeOf('S', { template: 'input-form' }), '<p>model copy</p>')
    assert.equal((await vf.findTemplate('S', 'input-form')).source, 'built-in copy')
    const listed = (await vf.listAll('S')).find(t => t.name === 'input-form')
    assert.equal(listed.inModel, true)
    assert.equal(listed.html, '<p>model copy</p>', 'listed with the code the model runs')
    assert.equal(listed.newerBuiltIn, false, 'fingerprint still matches the built-in it was copied from')
    assert.equal((await vf.listAll('S')).filter(t => t.name === 'input-form').length, 1, 'shown once, not twice')

    // A newer built-in is flagged, and reaches the model only by a deliberate update.
    docs['viewfinder/input-form.json'] = { ...docs['viewfinder/input-form.json'], builtInFingerprint: 'older0000000' }
    assert.equal((await vf.listAll('S')).find(t => t.name === 'input-form').newerBuiltIn, true)
    const updated = await vf.updateBuiltInCopy('S', 'input-form', 'me')
    assert.equal(updated.version, 2)
    assert.equal(docs['viewfinder/input-form.json'].html, vf.readTemplate('input-form'))
    assert.equal((await vf.listAll('S')).find(t => t.name === 'input-form').newerBuiltIn, false)
  } finally { Object.assign(store, orig) }
})

test('a Lens saved before templates were copied still runs the built-in until its next save', async () => {
  const store = require('../core/model-store')
  const vf = require('../core/viewfinder')
  const orig = { readDoc: store.readDoc }
  store.readDoc = async () => null
  try {
    assert.equal(await vf.codeOf('S', { template: 'line-item-form' }), vf.readTemplate('line-item-form'))
    assert.equal((await vf.findTemplate('S', 'line-item-form')).source, 'built-in')
  } finally { Object.assign(store, orig) }
})
