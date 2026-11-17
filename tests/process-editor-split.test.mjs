import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionsFromEdits, runParamArray } from '../client/src/lib/process-editor/sections.js'
import { parseAsciiPreview, asciiFileReadMessage } from '../client/src/lib/process-editor/ascii-preview.js'
import { debugIssues, unknownWatches } from '../client/src/lib/process-editor/debug-result.js'

test('sections: an edit wins over the saved body, a missing section is empty', () => {
  const sections = sectionsFromEdits(
    { PrologProcedure: 'edited prolog' },
    { PrologProcedure: 'saved prolog', MetadataProcedure: 'saved metadata' },
  )
  assert.equal(sections.PrologProcedure, 'edited prolog')
  assert.equal(sections.MetadataProcedure, 'saved metadata')
  assert.equal(sections.DataProcedure, '')
  assert.equal(sections.EpilogProcedure, '')
})

test('sections: an edited empty section stays empty rather than falling back', () => {
  const sections = sectionsFromEdits(
    { DataProcedure: '' },
    { DataProcedure: 'saved data' },
  )
  assert.equal(sections.DataProcedure, '')
})

test('sections: no saved process yet means the edits and empty strings', () => {
  const sections = sectionsFromEdits({ EpilogProcedure: 'new' })
  assert.deepEqual(sections, {
    PrologProcedure: '',
    MetadataProcedure: '',
    DataProcedure: '',
    EpilogProcedure: 'new',
  })
})

test('run parameters: a typed value wins, a missing one uses the process default', () => {
  const params = runParamArray(
    [{ Name: 'pYear', Value: '2026' }, { Name: 'pRegion', Value: 'All' }],
    { pYear: '2027' },
  )
  assert.deepEqual(params, [
    { Name: 'pYear', Value: '2027' },
    { Name: 'pRegion', Value: 'All' },
  ])
})

test('ascii preview: header row names the columns and is not a data row', () => {
  const result = parseAsciiPreview('Name;Amount\nENG-001;10\nENG-002;20', { delimiter: ';', headerRecords: 1 })
  assert.deepEqual(result.columns, ['Name', 'Amount'])
  assert.deepEqual(result.rows, [['ENG-001', '10'], ['ENG-002', '20']])
  assert.equal(result.rowCount, 2)
  assert.equal(result.note, 'first 20 records')
})

test('ascii preview: no header row numbers the columns instead', () => {
  const result = parseAsciiPreview('ENG-001;10\nENG-002;20', { delimiter: ';', headerRecords: 0 })
  assert.deepEqual(result.columns, ['Column 1', 'Column 2'])
  assert.deepEqual(result.rows, [['ENG-001', '10'], ['ENG-002', '20']])
  assert.equal(result.rowCount, 2)
})

test('ascii preview: blank lines are skipped and the default delimiter is a comma', () => {
  const result = parseAsciiPreview('A,B\n\n1,2\n', { headerRecords: 1 })
  assert.deepEqual(result.columns, ['A', 'B'])
  assert.deepEqual(result.rows, [['1', '2']])
  assert.equal(result.rowCount, 1)
})

test('ascii preview: an empty file with a header row shows numbered columns and no rows', () => {
  const result = parseAsciiPreview('', { headerRecords: 1 })
  assert.deepEqual(result.columns, ['Column 1'])
  assert.deepEqual(result.rows, [])
  assert.equal(result.rowCount, 0)
})

test('ascii error: a bare status is replaced with the v12 guidance', () => {
  const message = asciiFileReadMessage('load.csv', new Error('404'))
  assert.match(message, /load\.csv/)
  assert.match(message, /Planning Analytics v12/)
})

test('ascii error: a server message that says something real is kept', () => {
  assert.equal(asciiFileReadMessage('load.csv', new Error('Permission denied')), 'Permission denied')
})

test('debug result: warnings become issues, a missing message names the function', () => {
  const issues = debugIssues({
    warnings: [
      { section: 'Prolog', line: 3, name: 'NotAThing' },
      { section: 'Data', line: 9, msg: 'A real explanation' },
    ],
  })
  assert.deepEqual(issues, [
    { severity: 'warning', section: 'Prolog', line: 3, message: 'Unknown function "NotAThing"' },
    { severity: 'warning', section: 'Data', line: 9, message: 'A real explanation' },
  ])
})

test('debug result: no warnings means no issues', () => {
  assert.deepEqual(debugIssues({}), [])
})

test('unknown watches are matched case-insensitively', () => {
  const watches = [{ name: 'nBad' }, { name: 'vOk' }]
  const vars = [{ name: 'NBAD', section: 'Data' }, { name: 'VOK', section: 'Prolog' }]
  assert.deepEqual(unknownWatches(watches, vars), [])
})

test('unknown watches lists only the names the process does not have', () => {
  const unknown = unknownWatches([{ name: 'nMissing' }], [{ name: 'nBad' }])
  assert.deepEqual(unknown, [{ name: 'nMissing' }])
})
