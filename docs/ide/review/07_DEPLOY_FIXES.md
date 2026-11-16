# 07 — Change sets, assertions, deploy: fix brief (round 1)

Build brief for OpenCode. Source: `07_DEPLOY_VERDICT.md` round 1, items 1–10, agreed by James
16 Nov 2026. Round 2 (fresh IDE reads governance from the model) is **not** in this brief. Read
`07_DEPLOY_FINDINGS.md` for line numbers.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), `cd client && npm run build` when `client/src`
  changed (commit `static/`), `cd client && npx eslint src` (129 or fewer).
- **Do not push. Do not restart any server. Do not run a deploy, push, pull, drift check or
  assertion against any TM1 server.** Every test in this brief uses the stubbed client and
  adapter the `safety-*` tests already use (`tests/_mcp-harness.js` and the fakes in the
  `git-*` tests). If a step cannot be proven without a live server, say so in the DONE file;
  James runs live checks himself.
- Questions go in `docs/ide/review/07_DEPLOY_FIXES_QUESTIONS.md`, never into guesses.
- `docs/ide/BUG_FIXES.md` line for steps 2, 3, 4, 5, 7, 8 and 9.
- Every behaviour change in this brief also changes `docs/deploy/DEPLOY_LIFECYCLE.md`: update the
  relevant rule's text in the same commit so the doc never describes a behaviour the code lacks.

## Step 1 — Doc first: "Known gaps" in the deploy lifecycle

Add a dated section **"Known gaps (16 Nov 2026) — being fixed in review area 07"** near the top
of `docs/deploy/DEPLOY_LIFECYCLE.md`, one line per item below (steps 2–10) plus round 2
(fresh IDE cannot yet read model-owned governance). As each later step lands, move its line to
a "Fixed" list in the same section with the commit hash. Also add one sentence under "Proven end
to end": "Proven on the happy path from one IDE and one user; the gaps below were found by
code review, not by a failed deploy."

## Step 2 — Rule 3: `source` required, derived from the approval (bug)

`core/git-deploy.js` `execute()` (~118, ~289-318) and `server.js` `/api/deploy/git/execute`:
- The approval record already links a change set (`approvalSession`). Resolve the change set's
  `server` as the authoritative `source`. If the caller passes `source` and it differs, refuse
  with `{ executed: false, refused: true, error: 'source does not match the approved change set' }`.
  If the approval has no linked change set (release mode), `source` is required in the body;
  missing → 400.
- Reconcile and control checks always run. Remove the `if (source)` guards.
- 2.3: `controlOk` becomes false when reconcile returns an error, when any delete is "not
  auto-applied", or when attribute sync reports an error. Those reasons appear in
  `out.controlReasons[]`.
- Tests (stubbed): execute without source in release mode → 400; execute with mismatched source
  → refused; reconcile error → `controlOk: false`; skipped delete → `controlOk: false`.
- Update Rule 3 text in `DEPLOY_LIFECYCLE.md`.

## Step 3 — Rule 1: attribute values in the change set (bug)

- `core/change_log.js`: new action `ATTRIBUTE_VALUE_SET` with `object_type: 'attribute-value'`,
  `object_name: '<dim>:<element>:<attribute>'`, `detail: { dimension, hierarchy, element,
  attribute, before, after }`. Add it to `ACTION_META` in `ChangeLogPanel.jsx` ("Attribute value
  set"). `getSessionManifest` returns `attrElements` from these entries (plus the existing
  sources). 2.2: the manifest also includes subset, view and chore deletes, and reads the
  attribute fields the right way round (see findings 2.2 for the swapped fields).
- Writers: `POST /api/element/attribute` (`server.js:1278`), `/api/dimension/bulk-attr-import`
  (`568-579`), and the MCP tool `set_attribute_values` (`tools/tm1mcp/tools/`; it should use
  `logChange` from `shared.js`). Each reads the current value first so `before` is recorded.
- `core/git-reconcile.js` `syncAttributeValues` (~70-104): a blank/empty `after` **clears** the
  value on the target (2.6) instead of being skipped.
- Tests: manifest from a session with two attribute-value entries lists both; reconcile with a
  blank value issues a clear; bulk import logs one entry per changed pair; MCP tool logs.
- Update Rule 1 text.

## Step 4 — Rule 1: unknown plan operations refuse (bug)

`core/git-deploy.js` `parsePlanOp` (~59-73) returns `{ unknown: true, raw: op }` for any
operation or type it cannot classify (Skip stays `null`). `execute()` (~225-245) refuses when
any unknown op is present, listing the raw ops in the error. Test with a made-up op type.

## Step 5 — Rule 4: first pull records the anchor (bug)

`core/git-setup.js` `firstPull` (~48-57): after a successful `GitPull`, call
`git-state.recordDeploy(target, <pulled commit id>, <summary>, { ideToken })`. Take the commit
from the pull plan / result (whatever `execute()` uses at ~251-258). Test: a stubbed first pull
leaves `lastDeployed(target)` set. Update Rule 4 text.

## Step 6 — Readiness gates the push

`server.js` `/api/deploy/git/push` (~2890-2906): run the readiness `scan()` for the source first.
Any **blocker** finding refuses the push with the findings in the body; warnings are returned
alongside a successful push. `tools/tm1deploy/src/risk.js:458-475`: readiness blockers are
`ERROR`, not `WARNING`, when the transport is Git (stop hard-coding `gitTransport = false`;
read it from the deploy mode). `GitSetup.jsx` (~43-67, 163-168, 197): Link and Commit are
disabled while the last readiness result has blockers, with the reason shown. 3.3: the
readiness member parser uses the `]]`-aware pattern (same one Rule Lens now uses). Test: a
stubbed blocker refuses the push.

## Step 7 — Drift check takes the deploy lock (bug)

`core/git-drift.js` (~34-67): wrap the `prod-live` push + diff in the existing `git-lock` for
the target; a concurrent call waits or returns "busy", never races. Test with two concurrent
calls against the stub.

## Step 8 — Change-set ownership (bug)

`server.js` `/api/sessions/close`, `/resume`, `/:id/description` (~376-414, ~458-461): refuse
with 403 unless `req.user` equals the session's `user` (case-insensitive) or the caller is an
admin (use whatever admin check the user-management routes already use; if there is none, owner
only and say so in the DONE file). All three call `gateReadOnly` first. The UI
(`ChangeLogPanel.jsx`) hides Close / Resume / the pencil for sessions the current user does not
own. Tests: close as another user → 403; as owner → ok.

## Step 9 — Assertions (bugs)

`core/assertions.js`: `runOne` records to `}TestResults` like `run` does (8.1). `server.js`
assertion POST / PATCH / DELETE (~2822-2844): `gateWrite`, not `gateReadOnly` (8.3); validate
numeric fields and drop any client-supplied `user` / `changeSet` / `createdBy` in favour of
`req.user` and the active change set (8.2). `}TestResults` read failures surface as errors, not
empty history, in `AssertionsManager.jsx` (8.4). Tests for `runOne` recording and for the
field validation.

## Step 10 — One deploy surface

- Delete `client/src/components/DeployPanel.jsx` and `ImportPackagePanel.jsx`; remove the
  `wizard`/`import` views from `DeployCenter.jsx`; "New Deploy" opens `DeployWizard`. Remove
  the `Release` package mode from `ChangeLogPanel.jsx:328` (it opens the wizard in release mode
  instead). Grep for every importer and route the removed panels used; delete routes that are
  now unreachable (re-run the dead-route grep from area 02) and list them in the commit message.
- `DeployHistory.jsx`: primary list is the model's deploy records (approvals + `recordDeploy`
  entries — expose one route `GET /api/deploy/git/history?target=` that merges them server-side
  from `git-state` and `git-approvals`); the old `config/archives` list stays as a collapsed
  "Earlier REST pipeline" section.
- `DeployWizard.jsx`: reset the built release when the target changes (6.3).
- `docs/ide/FEATURES.md` and `README.md`: the deploy description names one flow.

## When finished

`docs/ide/review/07_DEPLOY_FIXES_DONE.md`: one line per step, commit hash, tests before and
after, lint, which behaviour changes James should verify live (list the exact actions: first
pull on a scratch target, a release with an attribute edit, a push with a readiness blocker),
anything not done and why.
