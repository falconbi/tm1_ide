'use strict'

// Part B.2 — attribute definitions and values live on `attrs-<server>`, written
// by the IDE only. These tests cover the file shape (stable, comparable), the
// bulk read (all hierarchies merged by element name, as v11 stores them) and the
// branch write (a no-op run changes nothing; a removed dimension disappears).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const attrs = require('../core/git-attrs')

const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'attr-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'attr-bare-'))

test('the file is stable: attributes and elements sorted, values in attribute order', () => {
    const text = attrs.serialiseAttributes('D', {
        attributes: [{ Name: 'Weight', Type: 'N' }, { Name: 'Caption', Type: 's' }],
        elements: [{ Name: 'E2', Values: { Caption: 'two' } }, { Name: 'E1', Values: { Weight: 1, Caption: 'one', Ignored: 'x' } }],
    })
    const doc = JSON.parse(text)
    assert.deepEqual(doc.Attributes.map(a => a.Name), ['Caption', 'Weight'])
    assert.deepEqual(doc.Attributes.map(a => a.Type), ['String', 'Numeric'])
    assert.deepEqual(doc.Elements.map(e => e.Name), ['E1', 'E2'])
    assert.deepEqual(Object.keys(doc.Elements[0].Values), ['Caption', 'Weight'], 'attribute order, not insertion')
    assert.equal(doc.Elements[0].Values.Ignored, undefined, 'only defined attributes are kept')
    // Same input in another order serialises byte-for-byte the same.
    assert.equal(text, attrs.serialiseAttributes('D', {
        attributes: [{ Name: 'Caption', Type: 'String' }, { Name: 'Weight', Type: 'Numeric' }],
        elements: [{ Name: 'E1', Values: { Caption: 'one', Weight: 1 } }, { Name: 'E2', Values: { Caption: 'two' } }],
    }))
    assert.deepEqual(attrs.parseAttributes(text).dimension, 'D')
})

function fakeClient() {
    return {
        getDimensions: async () => ['D1', '}Control', 'D2'],
        getElementAttributes: async (dim) => dim === 'D1'
            ? [{ Name: 'Weight', Type: 'Numeric' }, { Name: 'Caption', Type: 'String' }]
            : [],
        getHierarchies: async (dim) => (dim === 'D1' ? ['D1', 'Alt'] : [dim]),
        getElements: async (dim, hierarchy) => {
            if (dim === 'D1' && hierarchy === 'D1') return [{ Name: 'E1' }, { Name: 'E2' }]
            if (dim === 'D1' && hierarchy === 'Alt') return [{ Name: 'E1' }, { Name: 'E3' }]
            return [{ Name: 'F1' }]
        },
        // The MDX names the hierarchy it reads; answer from the same fake data.
        executeMDX: async (mdx) => {
            const alt = /\.\[Alt\]/.test(mdx) || /\[D1\]\.\[Alt\]/.test(mdx)
            const rows = alt ? ['E1', 'E3'] : ['E1', 'E2']
            const cols = ['Weight', 'Caption']       // sorted attribute order is the caller's; TM1 returns tuple order
            const vals = alt
                ? { E1: { Weight: 1, Caption: 'one' }, E3: { Caption: 'three' } }
                : { E1: { Weight: 1, Caption: 'one' }, E2: { Weight: 2, Caption: 'two' } }
            const cells = []
            rows.forEach((r, ri) => cols.forEach((c, ci) => {
                const v = vals[r]?.[c]
                if (v !== undefined) cells.push({ Ordinal: ri * cols.length + ci, Value: v })
            }))
            return {
                Axes: [
                    { Ordinal: 0, Tuples: cols.map(c => ({ Members: [{ Name: c }] })) },
                    { Ordinal: 1, Tuples: rows.map(r => ({ Members: [{ Name: r }] })) },
                ],
                Cells: cells,
            }
        },
    }
}

test('one dimension file merges every hierarchy by element name', async () => {
    const r = await attrs.readDimensionAttributes(fakeClient(), 'D1')
    const doc = attrs.parseAttributes(r.text)
    assert.deepEqual(doc.elements.map(e => e.Name), ['E1', 'E2', 'E3'],
        'elements unique to an alternate hierarchy are included')
    assert.equal(doc.elements.find(e => e.Name === 'E3').Values.Caption, 'three')
    assert.equal(doc.elements.find(e => e.Name === 'E1').Values.Weight, 1, 'shared value read once')
})

test('collect covers model dimensions only, one file each', async () => {
    const files = await attrs.collectAttrsFiles(fakeClient())
    assert.deepEqual(Object.keys(files).sort(), ['attributes/D1.json', 'attributes/D2.json'])
    assert.ok(!Object.keys(files).some(f => f.includes('}Control')))
    assert.deepEqual(attrs.parseAttributes(files['attributes/D2.json']).elements.map(e => e.Name), ['F1'])
})

test('the branch holds only attribute files, writes are idempotent, removals land', async () => {
    const bare = BARE()
    execFileSync('git', ['init', '-q', '--bare', bare])
    const files = {
        'attributes/D1.json': attrs.serialiseAttributes('D1', { attributes: [{ Name: 'Caption', Type: 'String' }], elements: [{ Name: 'E1', Values: { Caption: 'one' } }] }),
        'attributes/D2.json': attrs.serialiseAttributes('D2', { attributes: [], elements: [{ Name: 'F1', Values: {} }] }),
    }
    try {
        const first = await attrs.writeAttrsBranch('T1', { repoUrl: bare, files, gitUser: 'tester', message: 'init attributes' })
        assert.equal(first.ok, true, first.error)
        assert.equal(first.changed, true)
        assert.equal(attrs.attrsHead(bare, 'T1'), first.commit)

        const again = await attrs.writeAttrsBranch('T1', { repoUrl: bare, files, gitUser: 'tester' })
        assert.equal(again.ok, true)
        assert.equal(again.changed, false, 'an unchanged snapshot writes no commit')
        assert.equal(again.commit, first.commit)

        const removed = await attrs.writeAttrsBranch('T1', {
            repoUrl: bare, gitUser: 'tester', files: { 'attributes/D1.json': files['attributes/D1.json'] },
        })
        assert.equal(removed.changed, true)
        const work = W()
        try {
            g(work, 'init', '-q')
            g(work, 'remote', 'add', 'origin', bare)
            g(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
            const tree = g(work, 'ls-tree', '-r', '--name-only', 'origin/attrs-T1')
            assert.match(tree, /attributes\/D1\.json/)
            assert.doesNotMatch(tree, /D2\.json/, 'a dimension that no longer exists leaves the branch')
            assert.equal(attrs.readAttrsAt(work, removed.commit, 'D1').dimension, 'D1')
            assert.equal(attrs.readAttrsAt(work, removed.commit, 'D2'), null)
        } finally { fs.rmSync(work, { recursive: true, force: true }) }
    } finally {
        fs.rmSync(bare, { recursive: true, force: true })
    }
})
