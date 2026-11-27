'use strict'

// ── Warnings when the IDE connects to a server ───────────────────────────────
// Two things a person should hear about at once, not discover mid-deploy:
//
//   K.2  DEV no longer matches its last write into `dev` while a change set is
//        open. A restore/re-clone happened outside the IDE, so an open set's
//        work may be gone.
//   E.6  a chore is still on. After a clone (outside the IDE) chores arrive
//        switched on; the deploy never carries on/off, so they must be off.
//
// Reads only. The label comes from TM1 Git, like everything else that asks
// "which server is this?".

const cl = require('./change-log')

async function connectCheck(server, {
    token, gitUser, ideToken,
    client = null,
    label = undefined,
    deps = {},
} = {}) {
    const warnings = []
    const make = client ?? (() => {
        const { makeClient } = require('./adapter-registry')
        return makeClient(server, ideToken)
    })
    const c = typeof make === 'function' ? make() : make

    let effectiveLabel = label
    if (effectiveLabel === undefined) {
        try {
            const st = await c.post('GitStatus', { Username: gitUser, Password: token })
            effectiveLabel = String(st?.Deployment ?? '').toUpperCase() || null
        } catch { effectiveLabel = null }
    }

    if (effectiveLabel !== 'DEV') return { server, label: effectiveLabel, warnings }

    // E.6 — chores left on.
    try {
        const getChores = deps.getChoresWithTasks ?? (async () => {
            const { TM1Client } = require('./tm1-client')
            return new TM1Client(server, c).getChoresWithTasks()
        })
        const on = (await getChores()).filter(ch => ch.active)
        if (on.length) {
            warnings.push({
                code: 'chores-on',
                message: `${on.length} chore${on.length === 1 ? ' is' : 's are'} switched on in ${server}: ${on.map(ch => ch.name).join(', ')}. After a clone they arrive on; switch ${on.length === 1 ? 'it' : 'them'} off unless you mean ${on.length === 1 ? 'it' : 'them'} to run.`,
                chores: on.map(ch => ch.name),
            })
        }
    } catch (e) {
        warnings.push({ code: 'chores-unreadable', message: `Could not read ${server}'s chores: ${e.message}` })
    }

    // K.2 — an open set, and DEV no longer matches its last write into `dev`.
    try {
        const open = cl.getSessions(server, 1000).filter(s => !s.closed_at)
        if (open.length) {
            const lastWrite = cl.getSessions(server, 1000)
                .filter(s => s.closed_at && s.commit_ref)
                .sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)))[0] ?? null
            const st = await c.post('GitStatus', { Username: gitUser, Password: token })
            const local = st?.LocalCommit?.ID ?? st?.DeployedCommit?.ID ?? null
            const { sameCommit } = require('./git-approvals')
            if (lastWrite?.commit_ref && local && !sameCommit(lastWrite.commit_ref, local)) {
                warnings.push({
                    code: 'dev-recloned',
                    message: `${server} no longer matches its last write into dev (${String(lastWrite.commit_ref).slice(0, 8)}) while "${open.map(s => s.name).join(', ')}" is open. If DEV was restored or re-cloned outside the IDE, that work is gone — check before deploying.`,
                    openChangeSets: open.map(s => ({ id: s.id, name: s.name })),
                })
            }
        }
    } catch (e) {
        warnings.push({ code: 'dev-write-unreadable', message: `Could not check whether ${server} still matches its last write into dev: ${e.message}` })
    }

    return { server, label: effectiveLabel, warnings }
}

module.exports = { connectCheck }
