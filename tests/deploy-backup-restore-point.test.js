'use strict'

// Part I.3 / I.4 — the backup name a deploy records, and the restore-point tags
// that let "PROD restored from backup" move the pointers back.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const { backupFileName, restoreTags, tagRestorePoint, DEFAULT_BACKUP_PROCESS } = require('../core/deploy-backup')

const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

test('the archive name is target + minute', () => {
    const name = backupFileName('PROD', new Date(2026, 10, 27, 10, 0, 45))
    assert.equal(name, 'PROD_2026-11-27_1000.zip')
    assert.equal(backupFileName('TM1_Test_PROD', new Date(2026, 0, 3, 9, 5, 0)), 'TM1_Test_PROD_2026-01-03_0905.zip')
})

test('the default backup process is the IDE one', () => {
    assert.equal(DEFAULT_BACKUP_PROCESS, '}IDE.Backup')
})

test('release and attributes tags get distinct names', () => {
    assert.deepEqual(restoreTags('PROD_2026-11-27_1000.zip'), {
        release: 'backup-PROD_2026-11-27_1000.zip',
        attrs: 'backup-attrs-PROD_2026-11-27_1000.zip',
    })
})

test('both tags are created on their commits and pushed', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-bare-'))
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-wk-'))
    try {
        execFileSync('git', ['init', '-q', '--bare', bare])
        g(work, 'init', '-q')
        g(work, 'remote', 'add', 'origin', bare)
        fs.writeFileSync(path.join(work, 'a'), 'one')
        g(work, 'add', '-A')
        g(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'one')
        const c1 = g(work, 'rev-parse', 'HEAD').trim()
        fs.writeFileSync(path.join(work, 'a'), 'two')
        g(work, 'add', '-A')
        g(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'two')
        const c2 = g(work, 'rev-parse', 'HEAD').trim()
        g(work, 'push', '-q', 'origin', 'HEAD:refs/heads/dev')

        const r = await tagRestorePoint(bare, { backupName: 'PROD_2026-11-27_1000.zip', releaseCommit: c1, attrsCommit: c2 })
        assert.equal(r.ok, true, r.error)
        assert.deepEqual(r.tags.sort(), ['backup-PROD_2026-11-27_1000.zip', 'backup-attrs-PROD_2026-11-27_1000.zip'].sort())

        const verify = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-v-'))
        try {
            g(verify, 'init', '-q')
            g(verify, 'remote', 'add', 'origin', bare)
            g(verify, 'fetch', '-q', 'origin', '+refs/tags/*:refs/tags/*')
            assert.equal(g(verify, 'rev-parse', 'backup-PROD_2026-11-27_1000.zip^{commit}').trim(), c1)
            assert.equal(g(verify, 'rev-parse', 'backup-attrs-PROD_2026-11-27_1000.zip^{commit}').trim(), c2)
        } finally { fs.rmSync(verify, { recursive: true, force: true }) }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
        fs.rmSync(bare, { recursive: true, force: true })
    }
})
