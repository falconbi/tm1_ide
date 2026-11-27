'use strict'

const { z } = require('zod')

// ══════════════════════════════════════════════════════════════════════════════
// DEPLOY — read-only views of the release workflow (Part N.2)
// Building a release, approving it and deploying it stay with a person in the
// IDE. These tools only read: the pre-deploy check, a built release, and Review.
// ══════════════════════════════════════════════════════════════════════════════

function parseJson(text, fallback = null) {
    try { return text ? JSON.parse(text) : fallback } catch { return fallback }
}

function register(server, { ok, assertTargetAllowed, cl, SERVER }) {
    server.tool(
        'pre_deploy_check',
        'Run the read-only pre-deploy check for a target: idle check, the target writes its own objects into Git, the IDE writes its attributes, and the differences are sorted into keeps, carry-backs and stops. Writes nothing to the target or DEV. Use it before Build Release.',
        {
            target: z.string().optional().describe('Target server name (defaults to this server)'),
            source: z.string().optional().describe('DEV server name, for the DEV-side idle check'),
        },
        async ({ target = SERVER, source } = {}) => {
            assertTargetAllowed(target)
            const gitSecrets = require('../../../core/git-secrets')
            const gitIdentity = require('../../../core/git-identity')
            const { preDeployCheck } = require('../../../core/pre-deploy')
            const r = await preDeployCheck(target, {
                source: source ?? null,
                token: gitSecrets.getToken(), gitUser: gitIdentity.user(),
            })
            return ok({
                target, source: source ?? null, ok: r.ok, at: r.at,
                stops: (r.stops ?? []).map(s => `${s.kind} ${s.object}: ${s.reason}`),
                carryBack: (r.carryBack ?? []).map(s => `${s.object}: ${s.reason}`),
                kept: (r.kept ?? []).map(s => `${s.kind} ${s.object}: ${s.reason}`),
                sync: (r.sync ?? []).map(s => `${s.kind} ${s.object}`),
                attrs: r.attrs,
                error: r.error ?? null,
            })
        }
    )

    server.tool(
        'show_release',
        'Show a change set\'s built release: which target, the release commit, the objects it carries and the notes Build Release recorded (what came from the target, index changes, attribute writes). Read-only.',
        {
            session_id: z.string().optional().describe('Change set id (defaults to the newest closed set on this server)'),
        },
        async ({ session_id } = {}) => {
            const sessions = cl.getSessions(SERVER, 200)
            const s = session_id ? cl.getSession(session_id) : sessions.find(x => x.closed_at && !x.wont_deploy_at)
            if (!s) return ok(session_id ? `No change set ${session_id}.` : `No closed change set on "${SERVER}".`)
            const releases = cl.getSessionReleases(s.id)
            return ok({
                change_set: { id: s.id, name: s.name, server: s.server, kind: s.kind ?? null, closed_at: s.closed_at ?? null },
                releases: releases.map(r => ({ target: r.target, release_commit: r.release_commit, built_at: r.built_at, by: r.by })),
                release: s.release_commit ? {
                    target: s.release_target,
                    commit: s.release_commit,
                    added_by_user: parseJson(s.release_added_by_user, []),
                    added_as_dependency: parseJson(s.release_added_as_dependency, []),
                    excluded_by_user: parseJson(s.release_excluded_by_user, []),
                    target_notes: parseJson(s.release_target_notes, []),
                    attributes: parseJson(s.release_attrs, null),
                } : null,
            })
        }
    )

    server.tool(
        'show_review',
        'Show the Review of a built release: the change set, the release commit for its target, what came from the target, index changes, attributes, type changes, and any recorded approval. Read-only. Building, approving and deploying stay with a person in the IDE.',
        {
            session_id: z.string().optional().describe('Change set id (defaults to the newest closed set on this server)'),
            target: z.string().optional().describe('Target to show the approval for (defaults to the release target)'),
        },
        async ({ session_id, target } = {}) => {
            const s = session_id ? cl.getSession(session_id) : cl.getSessions(SERVER, 200).find(x => x.closed_at && !x.wont_deploy_at)
            if (!s) return ok(session_id ? `No change set ${session_id}.` : `No closed change set on "${SERVER}".`)
            const relTarget = target ?? s.release_target ?? null
            let approval = null
            if (relTarget && s.release_commit) {
                try { approval = await require('../../../core/git-approvals').find(relTarget, s.release_commit) } catch { approval = null }
            }
            const deploys = cl.getSessionDeploys(s.id)
            return ok({
                change_set: { id: s.id, name: s.name, server: s.server, kind: s.kind ?? null },
                release: s.release_commit ? { target: relTarget, commit: s.release_commit } : null,
                from_target: parseJson(s.release_target_notes, []),
                attributes: parseJson(s.release_attrs, null),
                deploys: deploys.map(d => ({ target: d.target, status: d.status, at: d.deployed_at, reason: d.status_reason })),
                approval: approval ? { approver: approval.approver, approved_at: approval.approved_at, note: approval.notes ?? null } : null,
                note: 'Build Release, approve and Deploy are done by a person in the IDE.',
            })
        }
    )
}

module.exports = { register }
