# TM1 Git integration — lab evaluation

Evaluation of using TM1's built-in Git integration (IMPROVEMENTS 10.1) as the deploy pipeline's transport and
the standard model-repo format. Lab pair: **TM1_Test_DEV → TM1_Test_PROD**, shared repo
`falconbi/tm1_git_test` (private, empty at start). Environment: TM1 v11.8.02800.9, direct-v11 adapter.

Format: plain English — what we tried, what TM1 answered, what it means for the IDE.

## Check #1 — Can both servers init against the repo, and where do credentials live? ✅

**What we tried:** `GitInit` on TM1_Test_DEV (`Deployment: DEV`) and TM1_Test_PROD (`Deployment: PROD`), same repo URL,
a GitHub fine-grained token (contents read/write on that one repo) supplied as the password.

**What TM1 answered:** both returned `Remote.Connected: true`; branches list empty (repo was empty); no certificate
step was needed — GitHub's TLS certificate was already trusted by the TM1 box, so we did **not** touch `tm1s.cfg`.

**Credentials:** TM1 does **not** store the token. After `GitInit`, `GitStatus` with no credentials reports
`Remote.Connected: false`. The token (and username) must be passed on **every** `GitStatus` / `GitPush` / `GitPull`
call. `GitInit` only remembers the URL + `Deployment` (the `}git` connection state). So the IDE keeps the token —
in `.env` (gitignored, same place as `TM1_GIT_TOKEN`) — and injects it into every Git call it makes.

**Reversible:** `GitUninit` exists on this server and tears the connection down.

**What it means for the IDE:** the token is the IDE's secret, supplied per call — it never lives on the TM1 server.
Good for security (nothing to rotate on the TM1 box), and it means the IDE is the natural credential holder, so the
per-server Git config in the IDE is just "repo URL + deployment" with the token coming from `.env` / server config.

## Check #2 — Base push, repo layout, plain-text rules/TI ✅

**What we tried:** pushed the whole TM1_Test_DEV model to the repo as the base (new branch `dev`), then cloned the
repo and inspected it.

**What TM1 answered:** 139 source files in the first commit (`9d83b61 base push`): **8 cubes** (4 with `.rules`),
**27 views** (incl. Default), **22 dimensions** (one hierarchy each), **30 subsets**, **13 processes** (each a `.json`
definition plus a `.ti`). Top-level layout `cubes/`, `dimensions/`, `processes/`. **Rules and TI are plain text** —
`.rules` and `.ti` files contain the actual readable code. No cube data, no element attribute values, no control
(`}`) objects — all expected.

**What it means for the IDE:** the repo is readable, diffable and branchable with standard git — a rules change shows
up as a clean diff in a `.rules` file. This is the "standard format" win: PAW, TM1py and community tools can all read
this repo.

> **Notable finding — GitPlans are ephemeral.** A plan created by `GitPush`/`GitPull` expires after a few seconds;
> trying to execute it later returns 404. The IDE must create and execute a plan **near-atomically** (capture the plan
> id from the create response and execute it immediately), and must treat the plan as a *preview you can act on at
> once*, not a persisted object you can come back to.
>
> **Design consequence (ephemeral plans + approval):** approval happens on the IDE's diff (what the change set says
> will change). At deploy, create the pull plan, verify it matches what was approved, then execute immediately or
> refuse. The plan itself is not something you can approve later and come back to.

## Check #3 — Pull plan on PROD after a small DEV change (blocked by a round-trip quirk)

**What we tried:** added a marker comment to a process on DEV (`# git-eval marker 2026-10-04` on `WFP Load Actuals`),
pushed it to `dev`, then asked PROD for a pull plan.

**What TM1 answered:**
- The push worked and **git history is surgical** — the marker commit changed exactly one file / one line
  (`processes/WFP Load Actuals.ti`), even though the push plan's `SourceFiles` lists the whole model. The plan's file
  list is not a change preview; the git diff is.
- The PROD pull plan **failed** with:
  `Failed to preprocess the source of "Cubes('WFP Workforce Input')" — View "Position Input" — "ViewTitle" expecting type "Object" but was "Null"`.

**Root cause:** the view's version title referenced a **phantom member** — `Working` was deleted from the
`WFP Version` dimension (the actual elements are Actual, Budget, Forecast, Downside, Non-Calculating, Variance, …),
but the view kept the reference. TM1 tolerates stale references at runtime, but its Git export cannot resolve a
`Selected` for a deleted member, so it exported `Selected: null` — and since a pull plan is all-or-nothing, **one
stale view blocked the whole deployment**. (TM1 **does** export `Selected` correctly for the other 26 views, which all
have a live member.)

**IDE/MCP angle (our code can create this):** `saveNativeView`'s `buildTitle` sets `Selected@odata.bind` only when a
`member` is provided — a title saved without a member (e.g. a default / all-members page in the IDE's ViewEditor) is
stored with `Selected: null` and breaks the Git round-trip. Auto-placed dimensions are fine (they resolve the
hierarchy's default member). The MCP `create_view` requires `member` on explicit titles.

**`tm1project` Ignore only supports top-level objects** (`Cubes('X')`, `Dimensions('X')`, `Processes('X')`, …) —
it cannot exclude a single view (`Cubes('…').Views('…')` and `Views('…')` both fail to parse). The only repo-level
way to exclude the view is to ignore the whole cube, which is too heavy.

**IDE's answer — see `docs/IMPROVEMENTS.md` 10.2 (Git readiness check):** a blocker in the deploy risk check before
every push, on demand, and in a read-only cross-server scan. It checks (1) view titles with no selected member,
(2) views and subsets referencing members that no longer exist, (3) names TM1 Git can't round-trip (e.g. a comma in
a subset name), (4) anything in `tm1project` Ignore, reported. Prevention: the IDE always saves a resolved `Selected`
title member, and warns when saving a view or subset that references a missing member.

**Resolution on DEV (this evaluation):** re-saved "Position Input" with the version title resolved to the existing
member **Budget** (see below). This is what the readiness check will automate.

> **Finding — a pull plan on a populated target is a full overwrite, not "only changes".** PROD has the same model as
> DEV (8 cubes, 22 dims, plus 2 extra processes) but has **never pulled** (`DeployedCommit` is null), so TM1 plans to
> overwrite every object it manages: the plan was **42 Update + 1 Create, 0 Delete**. There is **no baseline /
> "adopt current state" option** in TM1 Git — `GitPull` only has Branch / ExecutionMode / Force, and always loads the
> branch into the server. A target that already has the model still gets a full overwrite on its first pull. The
> pull plan only shows "only the change" once the target has a deployed-commit baseline (i.e. has pulled at least
> once). Design consequence: the IDE should warn before the first pull onto a populated target, and treat it as a
> full overwrite — not a change-set diff.
>
> On this pair the overwrite is effectively idempotent (0 element differences across all 22 dimensions; no deletes
> planned; PROD's two extra processes are not removed), so the risk here is low — but the behaviour itself is real
> and must be handled in the IDE.
>
> **Finding — zero Delete operations despite the two servers differing.** PROD has two processes the repo doesn't,
> yet the plan listed **no deletes**. That hints **deletes may never propagate through TM1 Git** — check #6 will
> prove this deliberately.

## Conclusion — hybrid, with the IDE keeping real responsibility

| Check | Result |
|---|---|
| 1 GitInit + credentials | ✅ |
| 2 Repo layout / plain-text / history | ✅ |
| 3 Pull plan shows only the change | ✅ (after a baseline exists) |
| 4 Object / change-set scoping | ⚠️ branch-scoped, object-granular; "branch per change set" untested |
| 5 Attribute values travel | ❌ no |
| 6 Deletes propagate | ❌ no |
| 7 Drift detected | ❌ no |

TM1 Git is **strong at what it does**: standard IBM-format files, clean per-change git history, plain-text rules/TI, an object-granular plan that shows only the change once a target has a baseline. But it is **not a complete deployment mechanism** — three of the seven checks failed: attribute values don't travel, deletes don't propagate, and the pull plan does not detect drift (it's a commit diff, not a live-state comparison).

**Recommendation — hybrid:** TM1 Git moves **object structure and history** (cubes, dimensions, processes, rules, views, subsets) and is the model-repo standard; the **IDE keeps** the pieces TM1 Git doesn't do:
- **attribute values** — via `tm1project` PrePush/PostPull tasks or the IDE's own value-writer on deploy
- **deletes** — a reconcile step (repo vs target) or the IDE's delete path
- **drift** — the IDE's own drift check (TM1 Git does not provide it)
- **readiness check** (IMPROVEMENTS 10.2) — blocker before every push
- **governance** — change sets, risk check, approval, assertions, Deploy Center, history UI

Operational constraints recorded: GitPlans are ephemeral (create+execute atomically); first pull on a populated target is a full overwrite (no baseline action exists); `tm1project` Ignore only supports top-level objects; a view with a member-less title breaks the pull (the readiness check catches it).

This is a **good outcome for the IDE's value**: TM1 Git makes the transport and history standard and IBM-owned, while the gaps it leaves (values, deletes, drift, readiness) are exactly where the IDE's governance and tooling remain essential.

## Check details (running log)

| # | Check | Result |
|---|-------|--------|
| 2 | Push DEV, then inspect the repo — layout readable/diffable, rules & TI in plain text? | ✅ 139 files; `cubes/ dimensions/ processes/`; rules & TI plain text; git-diffable |
| 3 | Pull plan on PROD after a small DEV change — shows only the change? | ✅ **After a baseline exists.** The pull plan on a never-pulled target is a full overwrite (see finding above). After PROD pulled the base once (`DeployedCommit` set), a follow-up DEV change (`marker2` on `WFP Seed FX Rates`) produced a plan of **42 Skip + 1 Update** — only the changed process. TM1 emits `Skip` for objects unchanged **between the deployed commit and the target branch** — the plan is a commit diff, **not a live-state comparison** (see check #7) |
| 4 | Change one process only — deploy limited to a change set's objects, or always whole model? | ⚠️ **Observed:** the pull is branch-scoped and applies **all changes on the branch since the target's deployed commit** (unchanged objects → `Skip`, changed → `Update`). You cannot select individual objects in `GitPull` — it takes a branch. The plan is object-granular (e.g. `Update Processes('X')`), not element-granular. **Inferred, NOT tested:** "use a branch per change set to limit a deploy" is an idea, not something this evaluation proved |
| 5 | Element attribute values — do they travel with the dimension? | ❌ **Values do NOT travel.** Changed `WFP Version → Budget → Description` ("Approved plan being built" → test string) on DEV and pushed. The push produced an **empty commit** (0 files) — the value never entered the repo — and PROD's pull plan had nothing about it. TM1 Git carries attribute *definitions* (structure) but the *values* are cube data (`}ElementAttributes_<dim>`), which isn't pushed. Restored: DEV back to the original (verified); **PROD was never affected** (verified read-only — it always had the original value). **Gap:** attribute values (aliases, captions, config) won't deploy via TM1 Git — the community workaround is a `tm1project` PrePush/PostPull task exporting/importing values to flat files |
| 6 | Delete an object on DEV — does the pull remove it on PROD? | ❌ **Deletes do NOT propagate.** Created throwaway process `ZZ Git Eval` on DEV → pushed → pulled to PROD (it existed on both). Deleted it on DEV → pushed (repo commit removed the files) → PROD's pull plan was **43 × Skip with zero Delete operations** — it never mentions the removed process, and PROD still has it. **Major finding:** TM1 Git pushes the *new state* of the repo but does **not** delete objects from the target on pull. The IDE cannot rely on TM1 Git to remove objects — deletes must be handled separately (reconcile step / IDE delete path) or documented as a hard limitation. Cleanup of the throwaway on PROD is manual |
| 7 | Change PROD behind git's back — does the pull plan catch it (drift)? | ❌ **Drift is NOT detected.** Added a comment directly to `WFP Copy Version` on PROD (out-of-band) and asked for a pull plan: it was **43 × Skip** — the changed process was not flagged. **The pull plan is a git-commit diff (deployed commit → target branch), not a live-state comparison.** It tells you what the repo would apply, not what's drifted on the target. The plan's earlier assumption that "the pull plan replaces our drift check" is **wrong** — the IDE's own drift check stays necessary. Restored PROD (marker removed, verified) |
| 8 | **Drift through Git** — PROD pushes its live state to its own branch (`prod-live`); `git diff` against the commit PROD last received shows out-of-band changes? | ✅ **works, but the diff is broader than expected.** PROD pushed its live state to `prod-live`; `git diff <deployed commit>..prod-live` showed the injected drift comment **and** PROD's two repo-absent processes. So drift is visible via git, but the diff surfaces **everything** on PROD different from the last received commit — including legitimately PROD-only objects (persistent until reconciled). See section below |

_Log: 2026-10-04 — DEV + PROD `GitInit`'ed (no Force). Token per-call confirmed (GitStatus no-creds = Connected false).
Next: base push on DEV, then inspect the repo._

## Check #8 — Drift through Git (proposed 5 Oct 2026, to test)

**Idea:** check #7 showed TM1's pull plan can't detect drift (it compares commits, not PROD's live state). Instead, use
TM1 Git itself: before a deploy, **PROD pushes its own current state to a dedicated branch** (e.g. `prod-live`), and
`git diff <commit PROD last received>..prod-live` lists exactly what was changed on PROD behind git's back — per object,
readable, with a history of every drift check. If it works, the IDE's separate **baseline snapshots can retire**.

**Test:** make a comment-only change to one process directly on TM1_Test_PROD → GitInit/push PROD to `prod-live` (push
plan first) → git diff against PROD's deployed commit → expect exactly that one process. Restore afterwards.

**Also find out:** (1) PROD needs write access to the repo — can it be limited to `prod-live` only (branch protection /
token scope), so PROD can never touch `dev`/release branches? (2) does each check add a commit, or can TM1 overwrite the
branch (noise)? (3) attribute values still won't appear (data) — value drift stays an IDE check.

**Result (tested 5 Oct):** injected a comment into `WFP Copy Version` directly on PROD → pushed PROD's live state to a
new branch `prod-live` (parent = PROD's deployed commit `d6c94a7c`) → `git diff d6c94a7c..prod-live` showed:
- `WFP Copy Version.ti` — the injected drift comment (exactly what was changed out-of-band) ✅
- `WFP Seed Prior Forecast` and `WFP Snapshot Version` — PROD's two processes that were never in the repo, surfacing
  as additions (they exist on PROD's live state but not in the last received commit).

So **drift is detectable through Git**, but the diff shows **everything on PROD different from the last received
commit**, not just out-of-band edits — objects on PROD that were never in the repo appear on every check until
reconciled. That's useful (full drift visibility) but means "expect exactly that one process" only holds when PROD's
live state == the deployed commit apart from the drift. Restored the process afterwards (verified).

**Answers to the "also find out" items:** (1) **write-scope is GitHub-side, not TM1-side** — TM1's `GitPush` takes any
branch; limiting PROD to `prod-live` only is done with GitHub **branch protection**. Caveat for real sites: branch
protection applies per **account** — if PROD pushes with the same account as the developers (here `falconbi`), an
admin/dev account may not be stopped. The clean setup is a **separate machine-user account for PROD** with its own
token that can only write `prod-live`, never the developers' account. (2) **each push adds a commit** (dev and
`prod-live` both accumulated commits); whether `Force` on `GitPush` can overwrite/reset a branch instead is untested.
(3) attribute values still won't appear (data) — value drift stays an IDE check.

> **Finding — `tm1project Files` does NOT carry Application-managed documents (tested 5 Oct).** Added
> `Files: ["Applications/Governance/Tests/assertions.json"]` to `tm1project` and pushed: the doc did **not** land in
> the repo (push plan = 140 files, model + tm1project only). A wildcard (`Applications/Governance/Tests/*.json`) also
> failed. `tm1project Files` covers loose files in the data folder (the community's `git_source_files/`), **not**
> Application-managed documents. So the assertions doc — and by extension change-set documents, deploy records, lenses
> in `Applications/Governance/` — **do not travel through TM1 Git**. To give tests git history, the IDE must **mirror
> the Applications documents into the repo** (commit them as files), or accept that tests are model-owned on the
> server but not versioned in git.

