'use strict'

// ── Deploy reports ──────────────────────────────────────────────────────────
// What each deployment ACTUALLY did, written once when the deploy ends.
//
// Why this exists: the deploy state (core/git-state) records only "which commit
// the target last received" — it needs that one fact for the drift check and
// nothing else. Everything a person wants afterwards (what shipped, who
// approved, which checks ran, what drifted, what reconcile touched) lived only
// in the HTTP response of the deploy request and was discarded. So after the
// completion card closed, "what did this deploy change?" was unanswerable.
//
// One file per deploy, keyed by (target, commit). The commit already appears on
// the change set (release_commit), the approval (commit) and the deploy state
// (lastDeployedCommit), so every one of those resolves to a report with no new
// identifiers anywhere.
//
// Storage follows the other governance records: the local file is the fallback,
// and on a target whose deploy state is model-owned the record is also written
// into the model (Applications/Governance/Deployments/record-*.json) — loudly,
// because a record that silently failed to write is worse than no record.

const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'data', 'deploy-records.json')
const PREFIX = 'record-'
const KEEP_PER_TARGET = 100

function loadLocal() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}
function saveLocal(d) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(d, null, 2))
}

// Approvals use the same rule: an exact id, or a prefix of at least 7 characters
// (Git's default abbreviation length — anything shorter is too ambiguous).
function sameCommit(a, b) {
    if (!a || !b) return false
    if (a === b) return true
    const short = a.length <= b.length ? a : b
    const long = a.length <= b.length ? b : a
    return short.length >= 7 && long.startsWith(short)
}

function stamp(iso) {
    return String(iso).replace(/[:.]/g, '-')
}

function docName(rec) {
    return `${PREFIX}${rec.target}-${String(rec.commit ?? 'none').slice(0, 8)}-${stamp(rec.at)}.json`
}

// ── Building the record ─────────────────────────────────────────────────────

// The one thing a reader needs to know first: how far did it get, and is the
// target right? Deliberately the same vocabulary as the outcome cards.
function classify(out) {
    // A restore is not a deploy, and says so rather than borrowing 'ok'.
    if (out.outcome) return out.outcome
    if (out.refused || out.executed === false) {
        if (/^Pull failed/i.test(String(out.error ?? ''))) return 'pull-failed'
        return 'refused'
    }
    if (out.recorded === false) return 'unrecorded'
    if ((out.subsetsViews?.errors?.length ?? 0) > 0) return 'subsets-views'
    if ((out.incomplete?.length ?? 0) > 0 || out.incompleteCheckError) return 'incomplete'
    if (out.controlOk === false) return 'checks-failed'
    return 'ok'
}

// Pure: everything comes from the deploy result, so it can be tested without a
// TM1 server or a model.
function buildRecord(out, { startedAt } = {}) {
    const at = new Date().toISOString()
    const verification = out.verification && !out.verification.error
        ? {
            total: out.verification.total,
            passed: out.verification.passed,
            failed: out.verification.failed,
            failures: out.verification.failures ?? [],
        }
        : (out.verification?.error ? { error: out.verification.error } : null)

    const reconcile = out.reconcile
        ? {
            error: out.reconcile.error ?? null,
            deletes: out.reconcile.deletes
                ? { done: out.reconcile.deletes.done ?? null, error: out.reconcile.deletes.error ?? null, flagged: out.reconcile.deletes.flagged ?? [] }
                : null,
            attributeValues: out.reconcile.attributeValues
                ? { error: out.reconcile.attributeValues.error ?? null, errors: out.reconcile.attributeValues.errors ?? [], flagged: out.reconcile.attributeValues.flagged ?? [] }
                : null,
        }
        : null

    return {
        at,
        target: out.target ?? null,
        source: out.source ?? null,
        branch: out.branch ?? null,
        base: out.baseCommit ?? null,
        release: out.releaseCommit ?? null,
        commit: out.targetCommit ?? null,
        changeSet: out.changeSetName ? { id: out.changeSetId ?? null, name: out.changeSetName } : null,
        approval: out.approvedBy ? { by: out.approvedBy, at: out.approvedAt ?? null, note: out.approvalNote ?? null } : null,
        outcome: classify(out),
        executed: !!out.executed,
        refused: !!out.refused,
        error: out.error ?? null,
        objects: (out.shippedObjects ?? []).map(o => ({ type: o.type ?? null, name: o.name ?? null, parent: o.parent ?? null })),
        drift: {
            before: out.drift ?? null,
            blocking: out.driftEntries ?? [],
            reported: out.driftNonBlocking ?? [],
        },
        checks: verification,
        controlOk: out.controlOk ?? null,
        subsetsViews: {
            errors: (out.subsetsViews?.errors ?? []).map(e => ({ type: e.type, name: e.name, error: e.error })),
            applied: out.subsetsViews?.applied ?? null,
        },
        incomplete: out.incomplete ?? [],
        incompleteCheckError: out.incompleteCheckError ?? null,
        reconcile,
        // What the deploy removed from the target's dimensions, when it could be
        // measured before the pull (see compareTargetWithRepo).
        elementLoss: out.elementLoss ?? [],
        loss: out.loss ?? null,
        restoreCommit: out.restoreCommit ?? null,
        startedAt: startedAt ?? null,
        finishedAt: at,
        durationMs: startedAt ? Math.max(0, Date.parse(at) - Date.parse(startedAt)) : null,
    }
}

// ── Writing ─────────────────────────────────────────────────────────────────
// The AREA must have no fixed document name: model-store's docNameFor() resolves
// an area with a `doc` (deployState → state.json) to that one file whatever name
// it is given. Writing a per-deploy document through it rewrote the deploy state
// itself — which is exactly what happened on the first live restore. 'lock' is
// the Deployments folder with no fixed name, so each record keeps its own file.
const AREA = 'lock'

async function modelOwned(target, { ideToken } = {}) {
    try { return await require('./model-store').isMigrated(target, 'deployState', { ideToken }) } catch { return false }
}

async function record(out, { ideToken, startedAt } = {}) {
    const rec = buildRecord(out, { startedAt })

    // Local first — the fallback every read can use, and what a non-migrated
    // target relies on entirely.
    const d = loadLocal()
    const arr = Array.isArray(d[rec.target]) ? d[rec.target] : []
    arr.push(rec)
    d[rec.target] = arr.slice(-KEEP_PER_TARGET)
    saveLocal(d)

    // On a model-owned target the model is the truth; a failure here is loud.
    if (await modelOwned(rec.target, { ideToken })) {
        const store = require('./model-store')
        await store.writeDoc(rec.target, AREA, docName(rec), rec, { ideToken })
    }
    return rec
}

// ── Reading ─────────────────────────────────────────────────────────────────

async function fromModel(target, { ideToken } = {}) {
    const store = require('./model-store')
    const names = (await store.listDocs(target, AREA, { ideToken })).filter(n => n.startsWith(PREFIX))
    const out = []
    for (const n of names) {
        const rec = await store.readOptional(target, AREA, n, { ideToken })
        if (rec && rec.at) out.push(rec)
    }
    return out
}

// Every record for a target, newest first. Model records win on a duplicate
// (same target+commit+at) — the model is the truth where it owns the area.
async function list(target, { ideToken } = {}) {
    if (!target) return []
    let model = []
    if (await modelOwned(target, { ideToken })) {
        model = await fromModel(target, { ideToken }).catch(() => [])
    }
    const local = (loadLocal()[target] ?? [])
    const seen = new Set(model.map(r => `${r.commit}::${r.at}`))
    return [...model, ...local.filter(r => !seen.has(`${r.commit}::${r.at}`))]
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

// The report for one deployment. Newest wins when a commit was deployed twice
// (a retry) — both stay in list().
async function get(target, commit, { ideToken } = {}) {
    const all = await list(target, { ideToken })
    return all.find(r => sameCommit(r.commit, commit)) ?? null
}

module.exports = { record, list, get, buildRecord, classify, sameCommit, FILE, PREFIX, AREA }
