import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveArity as deriveClient } from '../shared/catalog-arity.js'
import { deriveArity as deriveServer } from '../core/catalog-arity.js'

const TABLE = [
  { name: 'fixed', entry: { params: ['a', 'b'] }, min: 2, max: 2 },
  { name: 'variadic', entry: { params: ['a', 'b*'] }, min: 2, max: Infinity },
  { name: 'variadicMin', entry: { params: ['a*'], variadicMin: 1 }, min: 1, max: Infinity },
  { name: 'optional', entry: { params: ['a', 'b', 'c?'] }, min: 2, max: 3 },
  { name: 'catalog SUBSETCREATE', entry: { params: ['dimname', 'subset', 'value?'] }, min: 2, max: 3 },
  { name: 'catalog PARSEDATE', entry: { params: ['value', 'value', 'value?'] }, min: 2, max: 3 },
]

for (const row of TABLE) {
  test(`${row.name}: client and server derivations agree`, () => {
    assert.deepEqual(deriveClient(row.entry), { min: row.min, max: row.max })
    assert.deepEqual(deriveServer(row.entry), { min: row.min, max: row.max })
  })
}
