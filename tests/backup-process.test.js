'use strict'

// }IDE.Backup — the house backup process. Two things are checked here:
//   1. the versioned definition says what the README says (SaveDataAll first, the
//      archive beside the data folder and never inside it, a verified result, no Bedrock);
//   2. the client installs it on demand and treats a failed run as a failure — a backup
//      that did not happen must never read as one that did.

const { test } = require('node:test')
const assert = require('node:assert/strict')

const BACKUP = require('../ti-processes/backup/process.json')
const { TM1Client } = require('../core/tm1-client')

test('the definition is a hidden }IDE process with its own parameters', () => {
    assert.equal(BACKUP.name, '}IDE.Backup')
    const params = Object.fromEntries((BACKUP.parameters ?? []).map(p => [p.Name, p]))
    assert.deepEqual(Object.keys(params).sort(), ['pFormat', 'pKeep', 'pTargetDir'])
    assert.equal(params.pTargetDir.Value, '..\\backup')
    assert.equal(params.pFormat.Value, 'zip')
    assert.equal(params.pKeep.Value, 5)
    assert.equal(params.pKeep.Type, 'Numeric')
})

test('it saves data before it archives anything', () => {
    const prolog = BACKUP.prolog
    const save = prolog.indexOf('SaveDataAll;')
    const run = prolog.indexOf('ExecuteCommand(')
    assert.ok(save > -1, 'SaveDataAll present')
    assert.ok(run > -1, 'the script is executed')
    assert.ok(save < run, 'SaveDataAll runs first')
})

test('the archive goes beside the data folder, and its existence is the proof', () => {
    const prolog = BACKUP.prolog
    assert.match(prolog, /cBackup = '\.\.\\backup'/)      // default is the sibling folder
    assert.match(prolog, /TM1Backup_/)                     // numbered archives
    assert.match(prolog, /FILEEXISTS\(cRoot \| NumberToString\(n\)/)  // the archive is checked
    assert.match(prolog, /ProcessError;/)                 // no archive → this process fails
    assert.match(prolog, /tar\.exe -a -c -f/)              // Windows' own archiver
})

test('no generated script: ASCIIOUTPUT is buffered until the process ends', () => {
    // The first live version wrote a .ps1 with ASCIIOUTPUT and ran it in the same process.
    // TM1 only flushes that file when the process ends, so PowerShell found nothing and every
    // run failed. The process must not go back to writing a file it then runs.
    // A mention in a comment is fine; a CALL is not.
    assert.doesNotMatch(BACKUP.prolog, /ASCIIOUTPUT\s*\(/)
})

test('no Bedrock dependency', () => {
    // The description may say "No Bedrock"; nothing may CALL one.
    assert.doesNotMatch(BACKUP.prolog, /bedrock/i)
})

test('the client installs the process on demand and runs it with its parameters', async () => {
    const calls = []
    const c = Object.create(TM1Client.prototype)
    c.server = 'T'
    c.getProcess = async () => null
    c.createOrReplaceProcess = async (p) => { calls.push(['create', p.name]) }
    c.executeProcess = async (name, params) => { calls.push(['run', name, params]); return { ProcessExecuteStatusCode: 'CompletedSuccessfully' } }
    const r = await c.backupData({ keep: 3 })
    assert.deepEqual(calls, [['create', '}IDE.Backup'], ['run', '}IDE.Backup', ['pKeep', 3]]])
    assert.equal(r.ok, true)
})

test('an existing process is not re-created', async () => {
    const calls = []
    const c = Object.create(TM1Client.prototype)
    c.server = 'T'
    c.getProcess = async () => ({ Name: '}IDE.Backup' })
    c.createOrReplaceProcess = async () => { calls.push('create') }
    c.executeProcess = async () => ({ ProcessExecuteStatusCode: 'CompletedSuccessfully' })
    await c.backupData()
    assert.deepEqual(calls, [])
})

test('a failed run is an error, with the error log named', async () => {
    const c = Object.create(TM1Client.prototype)
    c.server = 'T'
    c.getProcess = async () => ({ Name: '}IDE.Backup' })
    c.createOrReplaceProcess = async () => {}
    c.executeProcess = async () => ({ ProcessExecuteStatusCode: 'CompletedWithErrors', ErrorLogFile: { Filename: 'TM1ProcessError_x.log' } })
    await assert.rejects(() => c.backupData(), /failed on T .*CompletedWithErrors.*TM1ProcessError_x\.log/)
})
