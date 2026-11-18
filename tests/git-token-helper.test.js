'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))
const secrets = resolve('core/git-secrets')
require.cache[secrets] = {
    id: secrets, filename: secrets, loaded: true,
    exports: { getToken: () => 'saved-token', tokenSource: () => 'saved' },
}
const { createServerHelpers } = require(resolve('core/server_helpers'))

test('the server token helper reads the saved token through git-secrets', () => {
    const h = createServerHelpers({ createCatalogOverrideRoutes: () => ({}) })
    assert.equal(h._GITOK(), 'saved-token')
})
