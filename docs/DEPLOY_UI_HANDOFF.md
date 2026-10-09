# Handoff — Deploy UI / loop work (6 Oct 2026)

Update for Claude on what was built here (deploy flow, drift, assertions, records). Everything below is committed
on the `lenses` branch. Nothing here touches the model-owned migration or `IMPROVEMENTS.md`.

## The headline

The single-developer loop is now **built, proven, and driven from one guided screen**. The old Git-deploy panel
(icon-only prepare/deploy) is replaced by a **step-by-step wizard**; the header's governance icons collapsed into
one **Deploy menu**.

## The wizard — `client/src/components/DeployWizard.jsx`

Eight steps, plain language, no icons:

```
1 Build → 2 Test → 3 Close → 4 Commit → 5 Review → 6 Approve → 7 Deploy → 8 Verify
```

- **Test** is its own step — runs the model's assertions, grouped **Behaviour / Control**, and shows *"N assertions
  added in this change set"* + an **Add tests** link.
- **Close** is its own step and the **gate** — blocked by any `block`-severity failure. Warns if the change set added
  no assertions.
- **Commit** = push DEV to the repo (`POST /api/deploy/git/push`, create+execute atomically). Branch field removed —
  it is fixed by the server's TM1 deployment.
- **Review** shows the object list **and** the actual content diff (`POST /api/deploy/git/review` →
  `core/git-review.js`), per object, `+`/`-` coloured.
- **Approve** records who/when/the exact commit/target/note to `config/deploy-approvals.json`; bound to the commit.
  Deploy is disabled until approved.
- **Verify** runs the drift check; Revert / Promote for recovery.
- A **Recovery box** is always at the bottom.

## Drift

- Wording fixed to plain language: **"Drift — PROD now vs DEV at the last deploy."**
- **Real bug fixed:** `driftCheck` created the `prod-live` push plan but **never executed it** — plans expire in
  seconds, so `prod-live` stayed stale and the diff false-positived. It now creates **and executes** atomically.
- **Order fix:** `git-deploy.execute()` now **reconciles (values + deletes) before** the control checks — matching
  the loop (pull → apply values/deletes → assertions).

## New / changed server routes

- `POST /api/deploy/git/push` — commit a server's state to the repo.
- `POST /api/deploy/git/approve`, `GET /api/deploy/git/approval` — the recorded approval.
- `POST /api/deploy/git/review` — the content diff for Review.
- `POST /api/sessions/close` now takes `{ id, tests }` and records the close decision.
- `core/git-deploy.execute()` verification now returns per-assertion `results`.

## Change-set records — `core/change_log.js`

- New session columns (auto-migrated): `closed_by`, `close_tests`, `commit_ref`, `deployed_target`, `deployed_at`.
- `closeSession(id, { user, tests })`, `setSessionCommit(id, commit)`, `markSessionDeployed(id, target)`.
- **Per-person change sets**: `getActiveSession(server, user)` — one open set per person per server; each save lands
  in the saver's own set. `close_change_set` (MCP) warns on `getCrossSessionTouches` overlap.
- Change Sets panel shows the lifecycle line and has **Test / Close** quick actions.

## Assertions

- **Ground rules** in `docs/ASSERTIONS.md`; the AI authors via MCP, a human overrides/deletes.
- Each assertion now records `why`, `author`, `changeSet`, and an **expected-change history** (who/when/from→to/why).
- MCP `add_assertion` takes `kind`, `severity`, `why` and stamps author + change set.
- **Wording:** a **behaviour** mismatch reads **"changed"** (the number moved — data or logic); a **control** mismatch
  reads **"failed"** (the model is broken). Applied in Model Health, the Tests screen, and the wizard.

## Docs

- `docs/DEPLOY_LIFECYCLE.md` — proven-loop record + the two bug fixes + the first-time GitHub setup gap.
- `docs/MULTI_DEVELOPER.md` — per-person change sets marked built (review points #3/#4).
- `docs/ASSERTIONS.md` — the ground rules.

## Caveats / not done

- **Backend restart** needed after these server/core changes.
- The **first-time GitHub setup** flow (link a server to a repo) is designed but **not built** — see
  `DEPLOY_LIFECYCLE.md`.
- The **change-log correlation** ("did the data move or a rule?") is designed, not built.
- `docs/IMPROVEMENTS.md` was **not touched** (yours).
