'use strict'
// TM1 reads %20 as a space but not '+' — query options must keep spaces as %20.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { serializeParams } = require('../core/odata-params')

test("spaces stay %20; $, commas, colons and brackets as axios sends them", () => {
  assert.equal(serializeParams({ '$filter': "Cube eq 'WFP Assumptions'", '$top': 5 }), "$filter=Cube%20eq%20'WFP%20Assumptions'&$top=5")
  assert.equal(serializeParams({ '$select': 'Name,Type', '$expand': 'Components($select=Name)' }), '$select=Name,Type&$expand=Components($select%3DName)')
  assert.equal(serializeParams({ '$orderby': 'TimeStamp desc', a: undefined, b: null }), '$orderby=TimeStamp%20desc')
  assert.equal(serializeParams({ q: "it's 50% & more" }), "q=it's%2050%25%20%26%20more")
})
