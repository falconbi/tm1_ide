# 07 — Change sets, assertions and deploy

Read-only review. No code changes, no server restart, no TM1 calls.

Scope: `core/change_log.js`, `core/change-set-model.js`, `core/model-store.js`,
`core/governance-mirror.js`, `core/assertions.js`, `core/test-results.js`, all `core/git-*.js`,
the `/api/sessions`, `/api/assertions`, `/api/deploy` and `/api/git` routes, and
`ChangeLogPanel`, `SessionReportTab`, `AssertionsManager`, `DeployCenter`, `DeployPanel`,
`DeployWizard`, `DeployHistory`, `GitDrift` and `GitSetup`.

## The five rules — claim check

| Rule | Verdict | Where the evidence is |
|---|---|---|
| 1. A release ships exactly its change set's objects; a plan with anything else refuses | **Partly true.** The release builder and `execute()` check the plan against the release's changed files, but unparsable plan operations are ignored, the base comes from local state, and the change-set manifest does not cover attributes or several delete types | Findings 1.2, 2.1–2.4 |
| 2. Nothing reaches a target without an approval bound to the exact commit | **True inside `execute()`**, but approvals/change sets are still local-marker/local-file based, so a fresh IDE does not see them; `source` is client-supplied and can be unrelated to the approved change set | Findings 1.1, 2.4 |
| 3. Every deploy runs control checks and records the result | **Not guaranteed.** `execute()` skips both reconcile and control checks when `source` is omitted, and reconcile failures are not folded into `controlOk` | Findings 2.4, 2.5, 3.1 |
| 4. Drift is measured against what the target last received, not TM1's `DeployedCommit` | **No on a fresh/migrated IDE.** `lastDeployed()` reads only the local JSON file, and the first pull never records an anchor | Findings 1.1, 1.3, 4.1 |
| 5. Drift pauses deploys; no automated Revert or Promote | **True.** The Revert/Promote routes and components are gone, and drift is checked in both `prepare()` and `execute()` | Checked; no finding |

The rest of the findings explain the gaps and the surrounding UI/tests.

---

## 1. Governance storage and the deploy anchor

### 1.1 A fresh IDE cannot see the model-owned change sets, approvals or deploy state

**What:** The model-owned governance layer is only used when a **local** `config/model-migration.json`
marker says the area was migrated. On a fresh install that marker does not exist, so approvals fall
back to the local file, deploy state is read only from the local file, and the session UI reads
only SQLite. The docs say a fresh install sees the same records because the model is the truth.

**Where:** `core/model-store.js:27-34` (`MARKER_FILE`, `isMigrated`);
`core/git-approvals.js:20-38` (`readFor` only reads the model when the marker is set);
`core/git-state.js:46-49` (`lastDeployed` reads only `config/git-deploy-state.json`);
`core/change-set-model.js:50-64` (`listSessions` is model-only and gated by the marker);
`server.js:425-443` (`/api/sessions` calls `cl.getSessions`, the local SQLite list, and computes
`deployed` from a local baseline).

**Why it matters to a forker:** This is the core promise of "Part 2 — model-owned governance".
A second IDE, a new machine, or a restored backend sees no model change sets, no approvals and
no deploy anchor. Approvals cannot be reused, drift falls back to the unreliable TM1
`DeployedCommit`, and releases cannot find their base. The model documents are present but the
code does not look for them.

**Suggested fix:** Make the server's data the discovery mechanism. Read the model documents when
they exist, independent of a local marker; keep the local marker only as an explicit opt-out or
legacy fallback. Add a model-backed session list (`change-set-model.listSessions`) to
`/api/sessions`, a model-backed `lastDeployed()` that reads `Deployments/state.json` and falls
back to the local file, and model-backed approvals on every IDE. Add a test with no local marker
and a model document present.

**Effort:** Medium.

### 1.2 `change-set-model.listSessions` exists but no route uses it

**What:** Closed change sets are written to
`Applications/Governance/ChangeSets/<id>.json`, but the only session list route uses the local
SQLite `change_log` table. The model reader is dead code.

**Where:** `core/change-set-model.js:50-64`; `server.js:425-445`.

**Why it matters to a forker:** It makes the model-store code look implemented while the visible
product still behaves as a local-only change log. Deploy history and the change-set rail disagree
about which records exist.

**Suggested fix:** Use `listSessions` when the model has change-set documents, merge or prefer it
over local rows, and have `SessionReportTab`/`ChangeLogPanel` consume that list. Add a route test
or a direct module test for a model-only session.

**Effort:** Medium.

### 1.3 First pull applies the repo but never records the deployed anchor

**What:** `firstPull()` executes `GitPull` and returns; it does not call `git-state.recordDeploy`
or write `Deployments/state.json`. `buildRelease()` and `driftCheck()` then look for a recorded
base and find none.

**Where:** `core/git-setup.js:48-57`; `core/git-release.js:104-110`;
`core/git-drift.js:23-31`; `core/git-deploy.js:64-69, 228, 251-252`.

**Why it matters to a forker:** The documented lifecycle says the first pull establishes the
baseline. In the code, the first release after a first pull fails with "no recorded deployed
commit", and drift falls back to TM1's `DeployedCommit` (the value Rule 4 says not to trust).
The user has to discover the separate "seed baseline" action.

**Suggested fix:** After a successful first pull, record the pulled commit (the plan/pull target)
as the target's `lastDeployedCommit` in the model, and surface the record in the result. Use the
same anchor in build, prepare, execute and drift. Add a test that first-pull then build-release
works without a manual seed.

**Effort:** Small.

### 1.4 Re-closing a resumed change set can overwrite its "immutable" model record

**What:** `resumeSession` clears `closed_at` locally, `closeAndPersist` writes the closed document
again with the same key, and `writeDoc` overwrites existing content. Nothing prevents a second
close or a resume of a model-recorded session.

**Where:** `server.js:409-414` (`/api/sessions/resume`), `core/change-set-model.js:43-47`,
`core/change_log.js:62-68` (`resumeSession`), `core/model-store.js:95-108` (`writeDoc`).

**Why it matters to a forker:** "Immutable record" is a documented promise; the code makes it a
mutable snapshot for anyone who calls resume and close again. The local record and model record
can disagree after a fresh install/resume.

**Suggested fix:** Refuse to resume a session already persisted as closed, or create a new
revision/record instead of overwriting. At minimum, make close idempotent and return the existing
record if the stored `closed_at` differs.

**Effort:** Small to medium.

---

## 2. Rule 1: release scope and reconcile

### 2.1 Attribute-value writes are not logged, so the manifest cannot scope or copy them

**What:** The element-attribute write route and the bulk attribute importer write values through
`writeElementAttribute` but never call `cl.writeLog`. `getSessionManifest` therefore has no
element/attribute pairs for those changes, and the reconcile has nothing to copy.

**Where:** `server.js:1278-1283` (`POST /api/element/attribute`),
`server.js:568-579` (`/api/dimension/bulk-attr-import`),
`core/change_log.js:135-155` (`getSessionManifest`).

**Why it matters to a forker:** Attribute values are one of the three gaps the deploy pipeline
exists to close. In this code a normal attribute-grid edit is invisible to the change set; the
approval's manifest contains no pair, reconcile copies nothing, and the deploy can be called
clean while PROD keeps the old value. This directly contradicts the "attribute values gap is
handled by reconcile" claim.

**Suggested fix:** Log attribute values at write time with the dimension, element and attribute
(explicitly, not by parsing `detail`), and use that shape in `getSessionManifest`. Include the
bulk import path. Add a test where an attribute edit produces a manifest pair and reconcile
applies it.

**Effort:** Small.

### 2.2 The manifest misses subset/view/chore deletes and reads attribute fields backwards

**What:** `getSessionManifest` only records deletes for `PROCESS`, `DIMENSION` and `CUBE`.
`SUBSET_DELETED` and `VIEW_DELETED` (both logged by the app) are ignored, so the reconcile can
never delete them. For attributes it assumes `object_name` is the dimension and `detail` is
`element.attribute`, while the server logs `objectName = attribute` and `detail = dimension`.
Splitting a dimension/element name on `.` is also unsafe for names containing dots.

**Where:** `core/change_log.js:135-155`;
`server.js:1230, 1242` (attribute logs); `core/git-reconcile.js:17-40` (process-only deletes).

**Why it matters to a forker:** The scoped reconcile sends the wrong dimension names and misses
real deletes, so a released delete can silently remain on PROD and the attribute sync can touch
nothing or the wrong dimension. The "manifest is taken from the approval's change set" promise
still holds, but the manifest itself is wrong.

**Suggested fix:** Define one manifest record shape and write it at log time. Include all
deletable types or explicitly block a release with unsupported deletes. Do not split
`element.attribute` out of free text; log the fields separately. Extend `tests/rule-lens`/deploy
tests with subset/view deletes and an attribute edit.

**Effort:** Medium.

### 2.3 Reconcile errors and skipped deletes do not make the deploy unsafe

**What:** `execute()` stores `reconcile` results but `controlOk` is only reduced for subset/view
apply errors, incomplete verification, or failed control assertions. A reconcile error, a delete
flagged "not auto-applied", or an attribute-sync error can coexist with `controlOk: true`. The
execute route then marks the session deployed when `executed && controlOk`.

**Where:** `core/git-deploy.js:285-325`; `server.js:2883`;
`core/git-reconcile.js:17-40, 43-114`.

**Why it matters to a forker:** The target can be missing the change set's delete or value and
still be recorded as deployed because its invariants pass. The UI shows an amber detail, but the
gate and the session history treat it as a success. This is a Rule 1/3 trust failure.

**Suggested fix:** Treat any reconcile `error`, non-empty `flagged`, or non-empty attribute
`errors` as a failed/incomplete deploy for `controlOk` (or add a separate `reconcileOk` that the
route requires before marking deployed). Keep flagged items in the result, not only in prose.

**Effort:** Small.

### 2.4 The deploy source is client-supplied and not tied to the approval's change set

**What:** `execute()` only reconciles and runs control checks `if (source)`. The route requires
`target` but not `source`; a direct caller can omit it and skip both steps. When supplied, `source`
is not checked against the change set that the approval points at. The push and release routes
also accept a session id without proving it belongs to that source/target.

**Where:** `core/git-deploy.js:289-318`;
`server.js:2875-2885` (execute), `2890-2905` (push), `2912-2923` (release),
`2930-2961` (approve).

**Why it matters to a forker:** The server-side "every deploy runs the checks" claim is not
enforced. A request can deploy with no control checks or reconcile, or run assertions from a
different server with different tests/data. The `source` value in an approval is also stored but
never validated on execute.

**Suggested fix:** Derive the source from the approval's linked change set server-side, or require
`source` and compare it with `linkedSession.server`. Refuse missing source for a release deploy.
Validate push/release session ownership and `session.server === source` before writing
`commit_ref`/`release_commit`.

**Effort:** Small to medium.

### 2.5 The release plan check ignores operations it cannot parse

**What:** `parsePlanOp` returns `null` for Skip (correct) but also for any unrecognized operation
or type. `execute()` filters those out, so an operation that is not one of the known
cube/dimension/process/chore/subset/view types is not treated as "anything else".

**Where:** `core/git-deploy.js:59-73, 225-245`.

**Why it matters to a forker:** The strict "if the plan shows anything else, the deploy refuses"
rule is only as strong as the parser. A new TM1 Git operation or a casing/parent format this
parser does not know ships without being compared to the release.

**Suggested fix:** Treat unparsed non-Skip operations as unexpected (fail closed), or make the
parser return a typed `'unknown'` with the raw string for the refusal message. Add a test with an
unrecognized operation.

**Effort:** Small.

### 2.6 Clearing an attribute value is skipped by the sync

**What:** `syncAttributeValues` only pushes a value when `attrs[p.attribute] != null` (and not an
object). A cleared/blank attribute is therefore left at its old value on the target.

**Where:** `core/git-reconcile.js:70-80, 96-104`.

**Why it matters to a forker:** "Copy attribute values" should include removing or blanking a
value; the current behavior silently preserves stale PROD data for exactly the kind of edit a
change set is meant to carry.

**Suggested fix:** Distinguish "attribute missing on source" from "attribute exists and is empty",
and write the empty/cleared value when the source has it. Cover numeric and string types.

**Effort:** Small.

---

## 3. Readiness and first-pull safety

### 3.1 The readiness check is not a gate before a Git push

**What:** Readiness findings are warnings, not blockers: the risk analyzer hard-codes
`gitTransport = false` and then emits readiness findings as `WARNING`. The actual Git push route
does not run `scan()` at all. In `GitSetup`, `Check readiness` is a separate button; `Link` and
`Commit this server` are not disabled by a failed readiness result.

**Where:** `tools/tm1deploy/src/risk.js:458-475`; `server.js:2890-2906` (push route);
`client/src/components/GitSetup.jsx:43-67, 163-168, 197`.

**Why it matters to a forker:** The docs call readiness a blocker before any push. A user can
follow the setup screen, see "blockers found", and still link/push. TM1 Git may then reject the
pull or, worse, silently skip a view/title and make the target incomplete. The warning text even
says "would block ... once wired" — that is not the documented current behavior.

**Suggested fix:** Run readiness in the Git push/release path server-side (or at the start of
release), return 409 on blockers, and disable the setup push/init actions until it passes. Set
`gitTransport = true` for the Git path, or remove the readiness claim from the lifecycle until it
is enforced.

**Effort:** Medium.

### 3.2 `firstPullAnalysis` is exported but never called, and its element-loss path is wrong

**What:** The first-pull safety function has no caller. `GitSetup` shows the normal
`/api/deploy/git/prepare` plan, not `firstPullAnalysis`. Its element-loss reader looks for
`dimensions/<dim>/<dim>.hierarchies/<dim>.json`, while the repo export path used everywhere else
is `dimensions/<dim>.hierarchies/<dim>.json`; the `catch { continue }` then hides the missing file.

**Where:** `core/git-readiness.js:161-217` (especially `:199-204`);
`client/src/components/GitSetup.jsx:59-61, 190`; `core/git-release.js:40-55` for the actual
export path.

**Why it matters to a forker:** The docs' "first-pull safety analysis confirms" is not true. A
populated target can be overwritten without the element-loss warning the lifecycle promises, and
the one function that would produce it is dead and would read the wrong directory anyway.

**Suggested fix:** Call `firstPullAnalysis` from the first-pull plan route (with a repo clone) and
show its warnings before the typed confirmation. Fix the path to
`path.join(repoDir, 'dimensions', `${dim}.hierarchies`, `${dim}.json`)` and add a fixture test.

**Effort:** Small to medium.

### 3.3 Readiness scan's member parser does not understand `]]` names

**What:** `memberRefs` uses `\[([^\]\[]+)\]` segments, so a dimension/element name containing `]]`
is cut at the first bracket and stale references can be missed.

**Where:** `core/git-readiness.js:21-30`.

**Why it matters to a forker:** The check is supposed to find the stale members that break a Git
pull; names with brackets are exactly the kind of real TM1 name the rest of the codebase handles
with a `]]`-aware parser.

**Suggested fix:** Use the same `]]`-aware bracket pattern as `shared/pivot/cellset.js` and
`core/rule_lens.js`, or reuse a shared parser. Add a readiness test with a bracketed member.

**Effort:** Small.

---

## 4. Rule 4: drift and deploy state

### 4.1 Drift reads the local state file, not the model, and the first pull does not seed it

**What:** `git-state.lastDeployed` is local-only; the model document is written only when the
local migration marker is set, and even then reads stay local. Combined with the missing first-pull
record (1.3), a fresh IDE or a target whose local file was lost falls back to TM1's
`DeployedCommit` — the value Rule 4 says is unreliable.

**Where:** `core/git-state.js:9-13, 28-49`; `core/git-drift.js:23-31`;
`core/git-deploy.js:64-69`; `core/git-release.js:104-110`.

**Why it matters to a forker:** Drift can be computed against a stale or unrelated commit, so a
clean target shows false drift (deploys pause) or a drifted target shows clean (deploys proceed).
The reported "IDE-recorded base" is not actually authoritative across IDEs.

**Suggested fix:** Implement a model-first `lastDeployed` (read `Deployments/state.json`, fall
back to local only if the model has no record), record it on first pull, and use it in drift,
build, prepare and execute. Add a test that starts with an empty local file and a model record.

**Effort:** Small to medium.

### 4.2 A drift check itself pushes `prod-live` without a deploy lock

**What:** Every drift check creates and executes a `GitPush` to `prod-live`. Two users can run it
at once, and it mutates the repo branch even though it is presented as a read-only health check.

**Where:** `core/git-drift.js:34-67`.

**Why it matters to a forker:** The push can race with a deploy or another check, and the
"read-only" framing in the UI hides that it writes to the repo. It also makes drift checks
expensive and potentially disruptive on a busy target.

**Suggested fix:** Document it as a write operation, take the target's deploy lock for the
snapshot/push, or use a compare-and-swap-free read path if PAW/TM1 exposes one. At minimum
serialize checks per target.

**Effort:** Small.

---

## 5. Rule 5: Revert/Promote retired

**Checked and found nothing:** there are no `/api/git/drift/revert` or `/api/git/drift/promote`
routes, no Revert/Promote controls in `GitDrift`/`DeployWizard`, and `git-drift` has no revert or
promote function. `prepare()` and `execute()` both refuse when drift is not clean. The rule is
enforced.

---

## 6. Client surfaces: two deploy paths and the wrong history

### 6.1 DeployCenter's "New Deploy" is the retired package flow, not the documented Git wizard

**What:** The top-bar "Deploy step by step" opens `DeployWizard`. The prominent DeployCenter
overlay's "New Deploy" renders `DeployPanel`, whose final action is a retired-note screen. The
Change Log's `Release` button also opens `DeployCenter` in release/package mode. A user has to
know which of two "Deploy" entry points is real.

**Where:** `client/src/App.jsx:340-345, 446, 450`; `client/src/components/DeployCenter.jsx:160`;
`client/src/components/DeployPanel.jsx:921-926, 1023`;
`client/src/components/ChangeLogPanel.jsx:328`; `client/src/components/DeployWizard.jsx:1-8`.

**Why it matters to a forker:** Two deploy surfaces with different semantics is the clearest
"one obvious way" violation in the area. The package UI can still build a union-of-changes package,
while the docs/lifecycle say a deploy ships only one change set.

**Suggested fix:** Make the Change Log/Deploy Center open `DeployWizard` directly; move the
package/import/baseline tools under an "Advanced/Legacy" label or remove them from the normal
path. If package building stays, label it as a standalone package tool and make clear it is not
the approved deploy.

**Effort:** Medium.

### 6.2 DeployHistory shows local package archives, not the model deploy history

**What:** The "History" view calls `/api/deploy/archives`, which lists JSON files under
`config/archives` written by the classic package pipeline. It does not read
`Deployments/state.json`, approvals, or the release/deploy records created by `execute()`.

**Where:** `client/src/components/DeployHistory.jsx:281-311`;
`server.js:3264-3302`; docs "Deploy history → Applications/Governance/Deployments/state.json".

**Why it matters to a forker:** After a Git deploy the History rail can show nothing, while a
stale package archive from an older path is shown as "deploy history". The model-owned history
promised by Part 2 is not visible.

**Suggested fix:** Read model deploy state/approvals (and release commits) for the History view;
keep package archives in a separate "Packages" view or mark them legacy. Add a route for the
model history.

**Effort:** Medium.

### 6.3 The DeployWizard keeps a built release when the target changes

**What:** Changing `target` in step 4 clears neither `release` nor `prep`/`approval`; step 6 can
still display the old release object while naming the new target. The server's approval check will
probably refuse, but the UI presents a stale release as if it were for the new target.

**Where:** `client/src/components/DeployWizard.jsx:375-395` (`setTarget` and `doBuildRelease`),
`:430-490` (`release`/`prep` display).

**Why it matters to a forker:** It invites approving the wrong commit for a target and then
debugging a confusing refusal. A release is target-specific; the UI should reset it when the
target changes.

**Suggested fix:** `onChange` of target should clear `release`, `prep`, `approval`, and any
approval note, and force a rebuild against the new target.

**Effort:** Small.

### 6.4 The classic DeployPanel still invites "Approve & Deploy" although that action is retired

**What:** The primary button in `DeployPanel` is labelled "Approve & Deploy to …"; clicking it
only shows a retired note. The package flow can still build/package/import, but the main call to
action is a dead end.

**Where:** `client/src/components/DeployPanel.jsx:603-627, 921-926`.

**Why it matters to a forker:** The UI promises a deploy that will never happen, and the user has
to discover the separate top-bar wizard. It is the same duplication as 6.1 but a concrete dead
action.

**Suggested fix:** Remove the button from the package screen, or relabel it "Package only" and
link directly to the Git wizard. Do not use "Deploy" in the label unless it actually deploys.

**Effort:** Small.

---

## 7. Sessions: ownership, gates and model state

### 7.1 Any user can close, resume or edit another user's change set

**What:** `/api/sessions/close`, `/api/sessions/resume` and
`/api/sessions/:id/description` accept an arbitrary id. None checks the session owner (or an
admin role), and close/resume/description are not gated on read-only posture. Close re-runs the
assertions for the session's server and writes the model record as the caller.

**Where:** `server.js:376-414` (close/resume), `server.js:458-461` (description);
`core/change_log.js:62-68, 86-100`.

**Why it matters to a forker:** On a shared DEV one developer can close or reopen another's work,
silently change its description, and generate a model record attributed to the caller. This is
both a collaboration and an audit-integrity problem.

**Suggested fix:** Require the session owner (or an admin) for close/resume/description; one
person's open change set should be private until closed. Gate resume/description on read-only like
start, and keep the model record immutable after close.

**Effort:** Small.

### 7.2 Session `deployed` is inferred from a local baseline, not the deploy record

**What:** `/api/sessions` marks a session deployed by comparing its `max_entry_id` with a local
baseline file. It never reads the model deploy state or the session's `deployed_target`/release
fields.

**Where:** `server.js:425-443`; `core/change_log.js:158-167`.

**Why it matters to a forker:** The badge can be wrong after a fresh install or a model-only
deploy, and it disagrees with the actual deploy record. This is the same model/local split as 1.1
but visible in the Change Log.

**Suggested fix:** Mark deployed from the model deploy record (target + commit/release), and from
the session's own `deployed_target`/`deployed_at`; use the baseline only as a fallback.

**Effort:** Small.

---

## 8. Assertions and run history

### 8.1 Running one assertion does not record it in `}TestResults`

**What:** `assertions.run` records a run, but `runOne` returns a result without calling
`recordRun`. The Assertions screen's per-row Run/Play button therefore does not produce history.

**Where:** `core/assertions.js:302-306` (`run` records), `:365-378` (`runOne` does not);
`client/src/components/AssertionsManager.jsx:76-86`.

**Why it matters to a forker:** The docs say run history goes to `}TestResults`; a forker will
assume every run is recorded. Trends and newly-vs-always-failing analysis silently miss all
single-assertion checks.

**Suggested fix:** Wrap `runOne` in the same `recordRun` call (with a one-result shape and a
stable run id per UI run), or make the button call `run` with a filter.

**Effort:** Small.

### 8.2 Assertion edits accept invalid numbers and client-supplied identity/change-set fields

**What:** `add`/`update` convert `expected` and `tolerance` with `Number(...)` and do not reject
`NaN`/empty values. The POST route takes `author` from the body when present, and both add routes
accept a client-supplied `changeSet` without checking that it is the caller's active set.

**Where:** `core/assertions.js:150-165, 314-324`; `server.js:2822-2827`;
`client/src/components/AssertionsManager.jsx:44-52`.

**Why it matters to a forker:** A typo can create an assertion that can never pass (NaN
comparison), and the audit/change-set link can be spoofed. This undermines the tests that gate
close/deploy.

**Suggested fix:** Validate finite numbers and positive tolerance server-side; derive `author`
and `changeSet` from `req.user`/the active change set rather than trusting the payload. Return 400
on invalid input.

**Effort:** Small.

### 8.3 Assertion writes use `gateReadOnly`, not the normal model-write gate

**What:** Assertions live in the TM1 model, but POST/PATCH/DELETE use `gateReadOnly` only. There is
no `gateWrite`/session attribution even though these routes modify a model document.

**Where:** `server.js:2822-2844`; house rule `CLAUDE.md:125-126`.

**Why it matters to a forker:** The routes do not follow the "write to TM1 uses gateWrite" rule,
so assertion edits are a second, weaker write path. On a server that requires a change set, tests
can change without being attributed or deployed.

**Suggested fix:** Decide whether assertions are exempt model metadata; if not, use `gateWrite`
and log the document edit. If they are exempt, document the exception and keep `gateReadOnly`.

**Effort:** Small.

### 8.4 `}TestResults` read failures look like empty history

**What:** `recentRuns` catches every error and returns `[]`; ModelHealth renders the history
without an error distinction.

**Where:** `core/test-results.js:53-71`; `client/src/components/ModelHealth.jsx:60`.

**Why it matters to a forker:** A missing/unreadable `}TestResults` cube looks like "no runs yet",
which can hide that history recording has been failing. The docs' "missing model data must fail
loudly" principle applies here too.

**Suggested fix:** Return an `{ error }` or throw a distinct error for read failure; let the UI
show "history unavailable" rather than a clean empty list.

**Effort:** Small.

---

## 9. Governance mirror

### 9.1 The governance mirror is not wired to any route or deploy step

**What:** `core/governance-mirror.js` implements `mirrorToRepo`/`applyFromRepo`, but nothing
requires or calls it. `server.js` has only a section comment. The docs say the mirror was decided
and is to be done "with the deploy work"; the deploy work does not call it.

**Where:** `core/governance-mirror.js` (whole file); `server.js:3075` (comment only);
`server.js:2867-2924` (deploy/release routes do not call it).

**Why it matters to a forker:** Governance documents (tests, change sets, deploy records) do not
travel through the repo, so the history/review layer promised by the docs is absent. The module
looks implemented, but no user path can reach it.

**Suggested fix:** Call `mirrorToRepo` on push/release and `applyFromRepo` during deploy with the
documented per-target allow list, or remove the module and the claim until it is scheduled. Add a
route/CLI test if it stays.

**Effort:** Medium.

### 9.2 The mirror's error handling is not loud

**What:** `readGovernance` catches every unreadable file and skips it; `applyFromRepo` catches
every `createFileDocument` failure as if the document already existed; `allow` is a raw prefix
match, so `Tests` also matches `TestsOld`. A failed create can look like a successful apply.

**Where:** `core/governance-mirror.js:25-38, 80-105`.

**Why it matters to a forker:** The repository is supposed to be the history/review layer; a
silent skip means a governance record is missing from the mirror with no indication. The module is
currently uncalled, but it is the pattern a forker will wire up.

**Suggested fix:** Only swallow the documented "already exists" codes (share the helper from
`assertions`/`model-store`), collect real failures, use an exact directory boundary for `allow`,
and report skipped docs.

**Effort:** Small.

---

## 10. Tests and the claims they do not cover

The area has valuable tests (`git-release`, `git-deploy-release`, `safety-approval-link`,
`safety-firstpull`, `safety-deploy-commit`), and they prove several claims: exact-commit approval,
plan-vs-release refusal for recognized objects, lock release on refusal, first-pull read-only
refusal.

They do **not** cover the issues above:

- no test where `execute()` is called without `source` (control/reconcile are skipped);
- no test where an attribute edit appears in the manifest/reconcile;
- no test with a model document and no local migration marker/local deploy file;
- no test that first-pull records the anchor and the next release builds;
- no test for unknown plan operations, subset/view deletes, or reconcile `flagged` affecting
  `controlOk`;
- no test for readiness blocking a Git push, or for `firstPullAnalysis` being called;
- no test for session ownership/close/resume;
- no test that `runOne` records `}TestResults`;
- no test for the governance mirror (and it is unreachable).

Add focused module tests rather than browser tests; most of these are pure server/core paths.

---

## Checked and found nothing (worth calling out)

- **Rule 5** (no Revert/Promote): confirmed no routes or UI controls; drift checks remain and
  pause deploys.
- **Approval exact-commit gate**: `execute()` creates the plan and compares
  `plan.Commit.ID` to the approved commit; there is no `requireApproval` escape hatch. Existing
  tests cover full/short IDs and moved commits.
- **Deploy lock**: acquired before drift/pull, released in `finally` on refusal and success; the
  stale-lock clear route refuses a live lock. Existing tests cover lock release.
- **First-pull read-only guard**: `core/git-setup.js` refuses init and first-pull on a read-only
  server, and tests cover both.
- **Plan/approval binding for recognized operations**: recognized non-Skip operations not in the
  release are refused; the gap is the unrecognized ones (2.5), not the recognized path.
- No live TM1 server or REST call was used in this review.
