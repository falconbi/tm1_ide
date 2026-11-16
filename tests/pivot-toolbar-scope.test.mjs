// Two grids can be mounted in a split workspace. Ctrl+F / Ctrl+Shift+A must act
// on the grid whose wrapper contains the focused element, not on all of them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { inGridScope } from '../client/src/lib/grid-shortcuts.js'

const dom = new JSDOM('<!doctype html><div id="a"><input id="ia"></div><div id="b"><input id="ib"></div>')
globalThis.document = dom.window.document
const a = document.getElementById('a')
const b = document.getElementById('b')

test('only the grid whose wrapper has focus receives the shortcut', () => {
    document.getElementById('ia').focus()
    const event = new dom.window.Event('keydown', { bubbles: true })
    assert.equal(inGridScope(a, event), true)
    assert.equal(inGridScope(b, event), false)
    document.getElementById('ib').focus()
    assert.equal(inGridScope(a, event), false)
    assert.equal(inGridScope(b, event), true)
})

test('a toolbar with no scope keeps the old global behaviour', () => {
    assert.equal(inGridScope(null, {}), true)
})
