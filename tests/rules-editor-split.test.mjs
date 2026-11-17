import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeCheckErrors } from '../client/src/lib/rules-editor/check-merge.js'
import { scanRegions } from '../client/src/lib/rules-editor/regions.js'
import { getRevealTarget } from '../client/src/lib/reveal-target.js'

const staticError = (line, message = `static ${line}`, severity = 'error') => ({ line, message, severity })
const tm1Error = (LineNumber, Message = `tm1 ${LineNumber}`) => ({ LineNumber, Message })

test('check merge: no TM1 errors shows every static finding', () => {
  const staticErrors = [staticError(5), staticError(20, 'warn', 'warning')]
  const merged = mergeCheckErrors(staticErrors, [])
  assert.equal(merged.firstTm1Line, null)
  assert.deepEqual(merged.staticToShow, staticErrors)
  assert.deepEqual(merged.errors, [
    { severity: 'error', line: 5, message: 'static 5' },
    { severity: 'warning', line: 20, message: 'warn' },
  ])
})

test('check merge: a TM1 error at line 10 keeps only static findings before it', () => {
  const merged = mergeCheckErrors([staticError(5), staticError(20)], [tm1Error(10)])
  assert.equal(merged.firstTm1Line, 10)
  assert.deepEqual(merged.staticToShow, [staticError(5)])
  assert.deepEqual(merged.errors, [
    { severity: 'error', line: 10, message: 'tm1 10' },
    { severity: 'error', line: 5, message: 'static 5' },
  ])
})

test('check merge: a non-numeric TM1 LineNumber counts as line 0 and still shows the TM1 error', () => {
  const merged = mergeCheckErrors([staticError(5), staticError(20)], [tm1Error('abc', 'bad line')])
  assert.equal(merged.firstTm1Line, 0)
  assert.deepEqual(merged.staticToShow, [])
  assert.deepEqual(merged.errors, [{ severity: 'error', line: 'abc', message: 'bad line' }])
})

test('regions: nested regions are listed in file order', () => {
  const lines = [
    '#Region Outer',
    'a = 1;',
    '  #region Inner',
    'b = 2;',
    '#EndRegion',
    '#EndRegion',
  ]
  assert.deepEqual(scanRegions(lines), [
    { line: 1, name: 'Outer' },
    { line: 3, name: 'Inner' },
  ])
})

test('regions: an unclosed region is still listed and a blank name becomes Region', () => {
  const lines = ['#Region', 'a = 1;', '#Region Unclosed']
  assert.deepEqual(scanRegions(lines), [
    { line: 1, name: 'Region' },
    { line: 3, name: 'Unclosed' },
  ])
})

test('reveal target: one per tab type', () => {
  assert.deepEqual(getRevealTarget({ type: 'rules', server: 'dev', cube: 'Sales' }),
    { type: 'rules', server: 'dev', cube: 'Sales' })
  assert.deepEqual(getRevealTarget({ type: 'process', server: 'dev', name: 'p' }),
    { type: 'process', server: 'dev', name: 'p' })
  assert.deepEqual(getRevealTarget({ type: 'subset', server: 'dev', dimension: 'Dim', hierarchy: 'Alt', subsetName: 'Sub' }),
    { type: 'subset', server: 'dev', dimension: 'Dim', hierarchy: 'Alt', subsetName: 'Sub' })
  assert.deepEqual(getRevealTarget({ type: 'dimension', server: 'dev', dimension: 'Dim' }),
    { type: 'dimension', server: 'dev', dimension: 'Dim' })
})

test('reveal target: a cube view with a view name, without one, and both view types', () => {
  assert.deepEqual(getRevealTarget({ type: 'cubeview', server: 'dev', cube: 'Sales', viewName: 'MyView' }),
    { type: 'view', server: 'dev', cube: 'Sales', viewName: 'MyView' })
  assert.deepEqual(getRevealTarget({ type: 'cubeview', server: 'dev', cube: 'Sales' }),
    { type: 'cube', server: 'dev', cube: 'Sales' })
  assert.deepEqual(getRevealTarget({ type: 'view', server: 'dev', cube: 'Sales', viewName: '' }),
    { type: 'cube', server: 'dev', cube: 'Sales' })
})

test('reveal target: unknown type and no tab are null', () => {
  assert.equal(getRevealTarget({ type: 'sql', server: 'dev' }), null)
  assert.equal(getRevealTarget(null), null)
})
