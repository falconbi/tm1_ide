'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TM1Client } = require('../core/tm1-client')

test('saveNativeView keeps the format string and a named-subset title selection', async () => {
  const calls = []
  const fake = {
    async getCube() { return { Dimensions: [{ Name: 'D1' }, { Name: 'D2' }] } },
    async _defaultMember() { return 'Budget' },
    async deleteView() {},
    async post(url, body) { calls.push({ url, body }) },
  }

  await TM1Client.prototype.saveNativeView.call(fake, 'CubeA', 'ViewA', {
    rows: [{ dimension: 'D1', subset: 'Rows' }],
    columns: [],
    titles: [{ dimension: 'D2', subset: 'All Versions', member: 'Forecast' }],
    suppressEmptyRows: false,
    suppressEmptyColumns: false,
    formatString: '0.00',
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "Cubes('CubeA')/Views")
  assert.equal(calls[0].body.FormatString, '0.00')
  assert.equal(calls[0].body.Titles[0]['Subset@odata.bind'], "Dimensions('D2')/Hierarchies('D2')/Subsets('All%20Versions')")
  assert.equal(calls[0].body.Titles[0]['Selected@odata.bind'], "Dimensions('D2')/Hierarchies('D2')/Elements('Forecast')")
})

test('saveNativeView omits FormatString when the caller did not supply one', async () => {
  const calls = []
  const fake = {
    async getCube() { return { Dimensions: [{ Name: 'D1' }] } },
    async _defaultMember() { return 'E1' },
    async deleteView() {},
    async post(url, body) { calls.push({ url, body }) },
  }

  await TM1Client.prototype.saveNativeView.call(fake, 'CubeA', 'ViewA', {
    rows: [{ dimension: 'D1', subset: 'Rows' }],
    columns: [],
    titles: [],
  })

  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, 'FormatString'), false)
})
