import { test } from 'node:test'
import assert from 'node:assert/strict'
import { afterLensSave } from '../client/src/lib/lens-save-state.js'

test('a new Lens takes the name returned by the save', () => {
    assert.deepEqual(afterLensSave('', { name: 'Target-Input' }), {
        savedName: 'Target-Input',
        patch: { name: 'Target-Input', label: 'Target-Input' },
    })
})

test('a rename moves the tab and the saved name to the new name', () => {
    assert.deepEqual(afterLensSave('Old-Name', { name: 'New-Name' }), {
        savedName: 'New-Name',
        patch: { name: 'New-Name', label: 'New-Name' },
    })
})

test('an unchanged save leaves the tab label alone', () => {
    assert.deepEqual(afterLensSave('Same', { name: 'Same' }), { savedName: 'Same', patch: null })
})
