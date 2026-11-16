'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const themes = require('../shared/lens-themes.json')
const { validateThemes, themeCss } = require('../core/lens_prefs')

test('every Lens theme has a label and the colours themeCss needs', () => {
    assert.equal(validateThemes(themes), true)
    for (const name of Object.keys(themes.themes)) {
        assert.doesNotThrow(() => themeCss({ mode: 'system', palette: name }), name)
    }
})

test('an unlabelled theme is refused', () => {
    const bad = JSON.parse(JSON.stringify(themes))
    bad.themes.teal.label = ''
    assert.throws(() => validateThemes(bad), /themes\.teal\.label is missing/)
})

test('a missing base colour is refused with the key name', () => {
    const bad = JSON.parse(JSON.stringify(themes))
    delete bad.base.dark.accent
    assert.throws(() => validateThemes(bad), /base\.dark\.accent is missing/)
})
