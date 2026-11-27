'use strict'

// ── Deploy backup and restore point (Part I.3 / I.4) ────────────────────────
// Every deploy overwrites the model, so a backup is not optional. The IDE
// provides the process (`}IDE.Backup`), installs it like the other }IDE
// processes, and passes the exact archive name it records — no typed-in backup
// time any more.
//
// The archive is named after the target and the minute the deploy started:
//   PROD_2026-11-27_1000.zip
//
// The same name becomes the restore point: a Git tag on the commit the target
// held before this deploy, and a second tag on the matching attributes commit
// (a Git tag points at one commit, so the attributes need their own name).
//
// The Windows-side measurement (file count and size) is verified in the lab run
// (James, 26 Nov): the process itself fails when no archive exists, and the
// count/size check is added once the lab reports what `tar.exe` produces.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { git, authUrl, sanitize } = require('./git-repo')

const DEFAULT_BACKUP_PROCESS = '}IDE.Backup'

const pad = (n) => String(n).padStart(2, '0')

// PROD_2026-11-27_1000.zip — one file name per deploy minute.
function backupFileName(server, now = new Date()) {
    const label = String(server ?? 'TM1').replace(/[^A-Za-z0-9_-]+/g, '_')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
    return `${label}_${stamp}.zip`
}

// The tag name for the release commit, and the separate one for the attributes
// commit (Git tags are per commit).
function restoreTags(backupName) {
    return { release: `backup-${backupName}`, attrs: `backup-attrs-${backupName}` }
}

// Create (or move) both tags and push them. Best-effort in the caller: a tag that
// cannot be pushed is reported, never silently dropped, and never fails a deploy
// that already pulled.
async function tagRestorePoint(repoUrl, { backupName, releaseCommit, attrsCommit = null, token = null, gitUser = null } = {}) {
    if (!repoUrl || !backupName) return { ok: false, error: 'repo and backup name required' }
    const tags = restoreTags(backupName)
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1tag-'))
    const made = []
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token ?? ''))
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*')
        const put = (tag, commit) => {
            if (!commit) return
            // Replace a tag from a deploy in the same minute rather than failing.
            try { git(work, 'tag', '-d', tag) } catch { /* absent */ }
            git(work, 'tag', tag, commit)
            made.push(tag)
        }
        put(tags.release, releaseCommit)
        put(tags.attrs, attrsCommit)
        if (made.length) git(work, 'push', '-q', 'origin', ...made.map(t => `refs/tags/${t}`))
        return { ok: true, tags: made, release: tags.release, attrs: tags.attrs }
    } catch (e) {
        return { ok: false, error: sanitize(e.message, token), tags: made }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

// Read the tags back, so the report names what exists rather than what we meant.
function listRestoreTags(repoUrl, backupName, { token = null, gitUser = null } = {}) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1tag-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token ?? ''))
        git(work, 'fetch', '-q', 'origin', '+refs/tags/*:refs/tags/*')
        const all = git(work, 'tag', '--list', `backup*-${backupName}`).split('\n').filter(Boolean)
        return all
    } catch { return [] }
    finally { fs.rmSync(work, { recursive: true, force: true }) }
}

module.exports = { DEFAULT_BACKUP_PROCESS, backupFileName, restoreTags, tagRestorePoint, listRestoreTags }
