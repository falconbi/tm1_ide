'use strict'

// Part J — recovery is a restore from the backup taken before the deploy.
// "Return to last release" is gone. The restore moves the release line, the
// deploy note and the attributes branch back to the backup tag, marks the bad
// deploy reverted, and warns (naming files) when the target does not match it.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const { restoreFromBackup, moveBranch, resolveTag } = require('../core/restore-backup')

const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

function repoWithBackup() {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-bare-'))
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-wk-'))
    execFileSync('git', ['init', '-q', '--bare', bare])
    g(work, 'init', '-q')
    g(work, 'remote', 'add', 'origin', bare)
    const commit = (text, msg) => {
        fs.writeFileSync(path.join(work, 'state.json'), text)
        g(work, 'add', '-A')
        g(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg)
        return g(work, 'rev-parse', 'HEAD').trim()
    }
    const base = commit('{"good":true}', 'before deploy')
    g(work, 'tag', 'backup-PROD_2026-11-27_1000.zip', base)
    g(work, 'tag', 'backup-attrs-PROD_2026-11-27_1000.zip', base)
    const bad = commit('{"good":false}', 'the bad deploy')
    g(work, 'push', '-q', 'origin', 'HEAD:refs/heads/release-PROD', 'HEAD:refs/heads/attrs-PROD', 'HEAD:refs/heads/dev')
    g(work, 'push', '-q', 'origin', '--tags')
    return { bare, work, base, bad }
}

const client = (repoUrl) => ({ post: async () => ({ URL: repoUrl }) })

test('the restore moves the pointers to the tag and marks the bad deploy reverted', async () => {
    const r = repoWithBackup()
    const marked = []
    try {
        const out = await restoreFromBackup('PROD', {
            backupName: 'PROD_2026-11-27_1000.zip', client: client(r.bare),
            deps: {
                pushServerState: async () => ({}),
                diffCommits: () => [],
                recordDeploy: async () => ({ ok: true }),
                latestDeployTo: async () => ({ session_id: 'S1', target: 'PROD', status: 'complete' }),
                setDeployStatus: async (id, target, status, reason) => { marked.push([id, target, status, reason]) },
            },
        })
        assert.equal(out.ok, true, out.error)
        assert.equal(out.restoredTo, r.base)
        assert.deepEqual(marked, [['S1', 'PROD', 'reverted', 'restored from backup PROD_2026-11-27_1000.zip']])
        assert.equal(resolveTag(r.bare, 'backup-PROD_2026-11-27_1000.zip'), r.base)
        // release branch now points at the backup commit, not the bad deploy.
        const verify = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-v-'))
        try {
            g(verify, 'init', '-q'); g(verify, 'remote', 'add', 'origin', r.bare)
            g(verify, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
            assert.equal(g(verify, 'rev-parse', 'origin/release-PROD').trim(), r.base)
        } finally { fs.rmSync(verify, { recursive: true, force: true }) }
    } finally {
        fs.rmSync(r.work, { recursive: true, force: true }); fs.rmSync(r.bare, { recursive: true, force: true })
    }
})

test('a target that does not match the tag is warned about, with the files named', async () => {
    const r = repoWithBackup()
    try {
        const out = await restoreFromBackup('PROD', {
            backupName: 'PROD_2026-11-27_1000.zip', client: client(r.bare),
            deps: {
                pushServerState: async () => ({}),
                diffCommits: () => ['M\tcubes/Salary.rules'],
                recordDeploy: async () => ({ ok: true }),
                latestDeployTo: async () => null,
                setDeployStatus: async () => {},
            },
        })
        assert.equal(out.ok, true)
        assert.ok(out.differences.length >= 1, 'the differing file is reported')
        assert.match(out.warnings[0], /cubes\/Salary\.rules/)
    } finally {
        fs.rmSync(r.work, { recursive: true, force: true }); fs.rmSync(r.bare, { recursive: true, force: true })
    }
})

test('a backup with no tag is refused before anything moves', async () => {
    const r = repoWithBackup()
    try {
        const out = await restoreFromBackup('PROD', { backupName: 'NOT_A_BACKUP.zip', client: client(r.bare), deps: {} })
        assert.equal(out.ok, false)
        assert.match(out.error, /No restore tag/)
        assert.equal(resolveTag(r.bare, 'backup-PROD_2026-11-27_1000.zip'), r.base, 'the good tag is untouched')
    } finally {
        fs.rmSync(r.work, { recursive: true, force: true }); fs.rmSync(r.bare, { recursive: true, force: true })
    }
})

test('a backup name is required', async () => {
    const out = await restoreFromBackup('PROD', { backupName: '  ', client: client('/tmp/x'), deps: {} })
    assert.equal(out.ok, false)
    assert.match(out.error, /Choose the backup by name/)
})
