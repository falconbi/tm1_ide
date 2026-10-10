'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sanitize } = require('../core/git-repo')

test('sanitize masks every occurrence of the token, not just the first', () => {
    const token = 'supersecret'
    const text = `https://${token}@github.com/falconbi/tm1_ide.git?token=${token}&again=${token}`
    const out = sanitize(text, token)
    assert.equal(out.includes(token), false, 'token must not survive anything')
    assert.equal(out.split('***').length - 1, 3, 'token appears 3 times → 3 masks')
})

test('sanitize leaves text untouched when no token is provided', () => {
    assert.equal(sanitize('no secrets here', null), 'no secrets here')
    assert.equal(sanitize('no secrets here', ''), 'no secrets here')
})