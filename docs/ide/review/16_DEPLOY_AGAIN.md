# 16 — Deploy a change set to TEST and PROD, keep DEV close to PROD

Build brief for OpenCode. Date: 25 Nov 2026. Area: the deploy pipeline.
Every decision here was agreed with James, step by step, on 24–25 Nov 2026. This is the only
version: anything not written here is not agreed — ask James before doing it.

Rules for this brief: plain English in every message, screen and report; nothing is pushed to
GitHub; never restart the server; keep the lab tidy (throwaway objects deleted, throwaway change
sets retired). Say which tool does each thing (TM1, Git, the IDE) in comments and reports.

This brief reverses brief 15's decision A1 (merge on DEV). Brief 14's rules on loaded dimensions
are replaced by Parts F, G and J here.

---

## Names (use these in code comments, screens and reports)

| Name | What it is | Where it is |
|---|---|---|
| **PROD Live** | PROD's objects as they are right now | Git branch `live-PROD` (written by TM1 on PROD when asked) |
| **PROD Last Deployed** | What PROD was given at its last successful deploy | Git branch `release-PROD` at the recorded commit, plus the IDE's deploy note |
| **DEV After Close** | All of DEV's objects when a change set closed | Git branch `dev`, the change set's `commit_ref` |
| **PROD Live attributes** / **PROD Last Deployed attributes** / **DEV After Close attributes** | The same three, for attribute definitions and values | Git branches `attrs-PROD`, `attrs-DEV` (written by the IDE) |

For TEST: TEST Live, TEST Last Deployed (`live-TEST`, `release-TEST`, `attrs-TEST`).
Step names: **Build Release** (not "build"), **Deploy to PROD / Deploy to TEST** (not "send").

**What is in TM1 Git and what is not:** TM1 writes dimensions (one file per hierarchy: elements,
types, parents, weights), cubes, rules, processes, chores, public subsets and public views. It does
**not** write attribute definitions, attribute values, data, chore on/off, private views or
subsets. A TM1 pull (the deploy) does **not** apply subsets and views; the IDE writes them after the
pull through TM1's REST API.

## The rule

**The change set is what gets tested. Each server gets its own release, built from that server's
latest copy plus the change set's recorded changes. Nothing a server did itself is undone — "if
it's in PROD, it's correct". DEV is never changed by a deploy; DEV is kept close to PROD by a
separate sync.**

Worked example (use it in tests and messages): Monday TEST is re-cloned from PROD; Employee has
1,000 people. Change set "Contractor rollup" adds a rollup and moves 12 employees; it is deployed to
TEST. Tuesday–Thursday PROD's load adds 40 employees and promotes Sarah (Grade 3 → 4). Thursday
the same change set is deployed to PROD: PROD ends with 1,040 employees, the rollup, the 12 moves,
and Sarah still Grade 4. DEV is untouched.

## Why (today's code)

- A change set can be deployed once: `markSessionDeployed` writes one field, `deployed_target`
  (`core/change-log.js:128`); the Ready list hides it (`client/src/lib/deploy/change-sets.js:25`);
  reopening is refused (`routes/changesets.js:57`); `ownerOf` treats it as done everywhere.
  `release_commit` / `release_target` are one slot each.
- The refresh writes PROD's changes into DEV inside the **open** change set (`core/refresh-dev.js`
  `applyRefresh`, refuses a closed set at line 437), so after TEST, PROD's changes can never reach it.
- The release takes whole files from DEV After Close (`core/git-release.js` `buildRelease`, line
  370). That carries a colleague's unfinished work inside a shared object, and lacks anything PROD
  loaded.
- A TI run on DEV is recorded only as "process ran" (`core/process-run.js:34`): values and elements
  it changes are never deployed, or show as "left on DEV". Running a process on DEV needs no change
  set (`tools/tm1mcp/tools/develop.js:108`).
- Attribute values are copied from DEV live at deploy; when only "attribute changed" is known, every
  value of the dimension is copied (`wholesale`, `core/git-reconcile.js`), overwriting PROD's own
  values (Sarah).
- Every server's drift check writes into one branch, `prod-live` (`core/git-drift.js:59`).
- With no backup process, Deploy to PROD accepts a typed time (`core/git-deploy.js` ~545); PROD has
  never had a backup. Return to last release takes no backup (`core/git-rollback.js`).
- The MCP deploy tools use the old REST pipeline (`tools/tm1deploy/src/`).

---

## The process, end to end

**The cycle** (Part L): DEV → TEST (UAT) → DEV → PROD → re-clone TEST from PROD. A cycle may hold
several change sets, end to end. Going straight DEV → PROD is allowed.

**Each deploy, to TEST or PROD, in this order:**

1. Pre-deploy check (Part D)
2. Tests and close — once per change set, on DEV (Part F)
3. Build Release (Part G)
4. Review and approve (Part H)
5. Deploy to PROD / TEST: idle check, Save Data, backup, TM1 pull, subsets/views/attribute values,
   verify, record (Part I)

Separate, any time: **Sync DEV from PROD** (Part E).

---

## Part A — Deploy records per server

1. New table `session_deploys (session_id, target, release_commit, base_commit, attrs_commit,
   backup_tag, deployed_at, by, status, status_reason)`; `status` = `complete` | `incomplete` |
   `reverted` | `superseded`. Written by Deploy to PROD/TEST. Keep writing `deployed_target` (last
   target) so nothing old breaks; stop reading it for decisions — find every read
   (`grep -rn "deployed_target\|\.deployed\b" core routes client/src tools`) and make each one per
   target.
2. Releases per target: a Build Release for PROD must not overwrite the TEST record
   (`session_releases (session_id, target, release_commit, built_at, by, ...)`).
3. Lists per target: "Ready for PROD" = closed, not retired, kind not sync/carry-back-to-PROD, no
   `complete` deploy to PROD. Show where a change set has been: "Deployed to TEST 24 Nov — waiting
   for PROD". Rename "Ready to ship" → "Ready to deploy" (Part N).
4. Reopen stays refused once a change set has reached any server.
5. `ownerOf`, the ordering check and catch-up's "covered" logic become per target.
6. `/api/deploy/git/release` (`routes/deploy.js:379`) refuses a Build Release for a target that
   already has a `complete` deploy of this change set.

## Part B — Branches

1. `prod-live` → `live-<target>` everywhere (`grep -rn "prod-live" core routes client/src tools
   docs`). Leave the old branch in the repo, unused.
2. `attrs-<server>` (new, written by the IDE only, never pulled by TM1, never in a release): one
   file per model dimension — and per alternate hierarchy that has its own attributes (Part J.8) —
   holding attribute definitions (name, type) and every element's values, in a stable order
   (attributes, then elements, sorted) so Git's compare shows real changes only.
3. Writes to `attrs-<server>`: at setup (initialisation commit), at every pre-deploy check and
   Build Release (Live attributes), after every Deploy to PROD/TEST (Last Deployed attributes,
   **read back from the server**, not what the IDE meant to write), at every close on DEV (DEV After
   Close attributes). Read attribute cubes in bulk, not element by element.
4. Attribute values are then held on the Git server. James accepted this (sensitive attributes are
   rare); say so in the docs.

## Part C — Setup

1. TEST/PROD: link to Git (label TEST/PROD), then **TM1 on the server writes its own objects into
   Git** and that commit is recorded as PROD Last Deployed; the IDE writes the server's attributes
   into `attrs-<server>` (initialisation commit). Nothing is put onto the server. This replaces the
   first pull (`core/git-setup.js` firstPull, `GitSetup.jsx` step 5 for PROD/TEST) — James: "that is
   backward".
2. DEV: link (label DEV); TM1 on DEV writes its objects into `dev`; the IDE writes `attrs-DEV`.
3. Servers already in use: a one-off "start" step that writes the attributes initialisation commit.
4. Test that Build Release works when PROD Last Deployed (PROD's own write) and DEV After Close come
   from separate writes.
5. After setup or a clone, show the server's Git label; refuse if DEV is linked as anything other
   than DEV (PROD's `}git.ctx` copied across).

## Part D — Pre-deploy check (writes nothing to PROD or DEV)

Runs first in every deploy; Continue only once it has run.

1. Idle check on the target (and DEV). Anything running → stop.
2. TM1 on the target writes its objects into Git (`live-<target>`); the IDE writes its attributes
   into `attrs-<target>`.
3. Git's compare tool compares Last Deployed with Live (objects and attributes) in a temporary copy
   of the repo on the IDE machine; the IDE sorts each difference and shows it:
   - **Elements, parents, hierarchies, attribute definitions and values, subsets, views** changed
     on the target: "kept in the release" (Part G) and "DEV is behind — run the sync" (Part E).
   - **Rule or process** changed on the target: the deploy stops; offer the carry-back (Part D.4).
   - **Cube structure** changed on the target: the deploy stops; no automatic copy — the developer
     makes the change on DEV in a new change set and deploys it first.
   - **Chore** schedule changed on the target: kept in the release (Part G.9); the sync copies it
     to DEV (Part E.6).
4. **Carry-back change set** (rule or process changed on PROD). Three copies of e.g. the Salary
   rule: PROD Last Deployed = old; PROD Live = hand-edited; deploying a copy back to PROD would be
   circular.
   1. The screen offers "Bring PROD's version onto DEV".
   2. The IDE copies the text from PROD Live onto DEV through TM1's REST API in a new change set of
      kind `carry-back`. If a developer has the same rule/process in an open or undeployed change
      set → stop, name them.
   3. The IDE closes it (Part F). It is marked **already on PROD** — never deployed to PROD.
   4. Build Release for PROD: where DEV After Close has the same text as PROD Live (and differs
      only from PROD Last Deployed), take PROD Live's version; nothing changes on PROD.
   5. To TEST it is deployed normally.
5. DEV deleted something a PROD process uses (an attribute, a dimension, a cube) and it was not
   caught at close (Part F.4): stop; fix in a new change set and deploy it first.

## Part E — Sync DEV from PROD (separate from deploys)

Keeps DEV close to PROD on long projects. The release (Part G) still protects PROD from anything
loaded since the last sync.

1. **Start:** admin button "Sync DEV from PROD", any time **DEV has no open change set** (close or retire
   first — a sync writes into DEV and would move the ground under in-flight work); e.g. weekly when there
   are no deploys. The pre-deploy check offers it when DEV is behind. Not automatic. Idle check on PROD
   and DEV.
2. **Find PROD's own changes:** as Part D.2–3. The IDE drops anything DEV already has (read through
   TM1's REST API).
3. **Clashes:** anything PROD changed that a developer also changed on DEV is shown with both values
   and the developer's change set. Default **take PROD's**. The admin may untick any item to skip
   it this time (it shows again next sync). If PROD's value replaces a developer's change, tell that
   developer (item, change set).
4. **Write to DEV:** open a change set of kind `sync`; write the ticked items through TM1's REST API
   in this order: elements, parents, hierarchies, attribute definitions, attribute values, subsets,
   views; record each write. A failed write stops the sync and lists what was and wasn't written.
   Reuse `core/refresh-dev.js` / `refresh-dimension.js` / `refresh-covers.js` /
   `refresh-hierarchy.js` for the writes; `applyRefresh` is no longer called from the deploy flow.
5. **Close:** TM1 on DEV writes its objects into `dev`; the IDE writes `attrs-DEV`. Closed and
   marked **never deployed** (it owns nothing). DEV's tests run; failures are reported, not blocking.
6. **Chores:** the sync copies PROD's new chores and schedule changes onto DEV and **the IDE
   switches every one off** as it copies it, listed in the report. After a clone (outside the IDE)
   the admin switches DEV's chores off by hand — no change set needed (on/off is never deployed);
   when the IDE next connects to DEV it warns about any chore still on.

## Part F — Recording every change on DEV, and the close

**What a change set changed comes from its own records, never from comparing two Git saves.** Git
only holds saves of the whole server; it can't tell which change set made a change, or whether one
is still open. Any close (a colleague's, a sync) while change set A is open writes A's unfinished
work into `dev`, so a compare of saves hides A's changes.

1. **Every TI run on DEV needs an open change set** — IDE route (`routes/processes.js`) and MCP tool
   (`tools/tm1mcp/tools/develop.js:108`). DEV = the server whose Git label is DEV (`GitStatus`
   `Deployment`, `routes/deploy.js:538`); not linked → say its type is unknown, don't apply the
   rule. TEST and PROD: no change set needed.
2. **Before and after every TI run on DEV**, the IDE reads what the process writes
   (`core/process-scan.js`: dimensions it inserts into, deletes from or re-parents in; attributes
   it writes; subsets, views, processes, cubes it creates or changes; a name built at run time →
   every model dimension the process names, said in the run entry): elements, edges, types,
   attribute values. Every difference is recorded in the run's change set in the same form as an
   IDE edit, **with the before and the after value** (elements: before/after parent, weight, type;
   attributes: before/after value). A short per-dimension lock makes a second run on the same
   dimension wait while a capture runs. Cube data is not deployed (the run entry says so).
3. **IDE edits** are recorded as today, now also with before and after values.
4. **Close (tests and close, once per change set):**
   1. The IDE runs DEV's tests; a failing "block" test stops the close.
   2. Attribute values: the IDE shows every value changed on DEV since the last close
      (`attrs-DEV` vs DEV now): changed by this change set → ticked; changed by another change set →
      shown, can't be taken; changed with no record → shown unticked, the developer chooses. The
      same "nobody owns it" list for other objects changed with no record. Nothing is added by
      itself.
   3. **Attribute type change** (text ↔ number): hard stop. The developer undoes it; for a new
      type, create a new attribute and move the values.
   4. **DEV deleted an attribute, dimension or cube** that a process writes or reads: scan DEV's
      processes (same as PROD's); if found, stop — fix the process in the same change set.
   5. The IDE marks the change set closed; TM1 on DEV writes its objects into `dev` (DEV After
      Close); the IDE records the commit on the change set and writes `attrs-DEV`.
5. **Discard** an open change set: closes and retires it in one step; say plainly the edits stay on
   DEV.

## Part G — Build Release

Runs under the target lock. Writes only to the temporary copy and then Git (`release-<target>`).
Nothing is written to PROD or DEV.

1. TM1 on the target writes its objects into Git (`live-<target>`, fresh); the IDE writes its
   attributes into `attrs-<target>`.
2. The IDE takes a temporary copy of the repo; the release starts from Last Deployed.
3. **Dimensions and alternate hierarchies** (elements, parents, weights, types):
   - Changed by this change set: take **Live's** hierarchy file and apply this change set's
     **recorded** changes to it. A change applies only if Live still has the recorded **before**
     value (or already has the after value). Otherwise — the element was removed on the target,
     the target moved it elsewhere, another change set changed it first — Build Release stops and
     names it. A colleague's unfinished changes are not in the records, so they are never applied.
   - Not changed by this change set, but changed by the target: Live's file, unchanged.
   - New dimension or hierarchy (not on the target): DEV After Close's file.
   - Deleted by this change set (recorded): removed from the release.
   - Elements the target removed: stay removed ("if it's in PROD, it's correct"), reported at
     Review. If this change set's records use one, stop and name it.
   - Element type change taken from the target: TM1 clears values on a leaf that becomes a
     consolidation — Review needs the approver's yes.
   - Write the file in TM1 Git's own JSON shape: Live's element order, new elements appended in the
     records' order. Reformat nothing else.
4. **Check the IDE's own files** (because the IDE wrote them): Git's compare tool compares each
   written file with Live's. Every difference must match a recorded change; every element and
   parent in Live must remain unless the records removed it. Parse the file back and check counts.
   Then run the loss check (`compareTargetWithRepo`, `core/git-readiness.js:303`) against the built
   commit: expected loss = only the change set's recorded removals. Any mismatch stops Build Release
   with the dimension and element named.
5. **Every index must find its files** (decided 26 Nov, after the lab check). TM1 Git links files
   by index: a dimension file lists its hierarchy files (`Hierarchies@Code.links`), a hierarchy file
   lists its subset files (`Subsets@Code.links`), a cube file lists its view files
   (`Views@Code.links`). If a release names a file it doesn't carry, TM1 refuses the whole pull
   ("Cannot open the file specified by link" — proved on the lab). So, for every file in the release:
   - every file its index names must be in the release; if it isn't, **carry it from Live** (the
     target already has it; a pull never changes subsets or views, so nothing changes on the
     target). A hierarchy file carried this way follows the dimension rules above.
   - an object this change set deleted (recorded) has its link removed instead.
   - a linked file the target doesn't have either (a DEV-only subset/view in DEV After Close's
     file) is carried from DEV After Close only if it belongs to this change set; otherwise its link
     is removed and Review lists it.
   - then run the existing link check (`linkClosure`, `core/git-release.js`) over the whole release
     as a final safety; anything still missing stops Build Release and names it.
   - **Cube files from DEV After Close** (cube changed by this change set) keep DEV's view index,
     minus entries the release doesn't carry (Verify first check 8, 26 Nov: TM1 Git's pull from
     `release-<target>` does not remove a view or subset the target has but the index omits — so the
     target's own views, e.g. one a user saved on PROD, stay safe without being carried).
   - Why entries get removed: TM1 Git's write on DEV takes **all** of DEV (a developer's scratch view
     "Tom Test" is in DEV After Close's cube index), but the release carries only this change set's
     objects. An index entry for anything this change set doesn't own (another developer's work, or
     no one's) is removed from the release's index and listed at Review.
   - **Files carried only to keep an index valid** (e.g. the target's subsets named by a hierarchy
     file from Live) are never written onto the target by the IDE's after-pull REST step. That step
     writes only this change set's subsets and views.
   - Objects where a target-side change lives inside a file the release replaces — and so must come
     from Live plus the records: hierarchy files (elements, parents, weights, types), the dimension
     file (its hierarchy list), chore files (schedule). Views, subsets, attributes and data are not
     at risk (separate files the pull doesn't change, or not in Git).
6. **Subsets, views, rules, processes, cubes** changed by this change set (one piece each —
   your part can't be picked out): the whole object from DEV After Close. If another change set —
   open, or closed and not deployed — also changed the same object, stop and name both, **either
   way round** (today's `sharedObjectOrdering`, `core/git-release.js:201`, only catches an older
   one). Carry-back rule: Part D.4.
7. **Attribute definitions and values:** only this change set's recorded changes. For each recorded
   value: target's Live value = Last Deployed value (only DEV changed) → write DEV's after value;
   Live ≠ Last Deployed and ≠ after value (the target changed it too) → stop, name element,
   attribute and the three values. Values the change set did not record are never written (Sarah).
   Elements DEV doesn't have (the 40) are never written. Remove `wholesale` from
   `core/git-reconcile.js`. **Aliases:** check every alias value written is unique against Live;
   a clash stops Build Release and names both elements.
8. **Chores** (decided 25 Nov): a chore is two parts — schedule (start time, frequency, mode) and
   steps (processes and parameters). Take Live's chore file and apply this change set's recorded
   changes. Both changed the schedule → stop. A chore no change set recorded (e.g. PROD-only
   operational chores) is never touched — no flag needed. The on/off is not in Git and not part of
   a deploy: Deploy to PROD keeps PROD's on/off (as today).
9. Git makes the release commit; the IDE pushes it to `release-<target>` (`--force-with-lease` as
   today) and records it per target (Part A.2). Record per dimension what came from the target
   ("Employee: 40 elements PROD added itself") for Review and the report.

## Part H — Review and approve

1. Review shows: this change set's changes; what came from the target (per dimension); target
   removals kept; type changes needing a yes; any stops.
2. Approval is tied to the release commit, as today. **No four-eyes rule** (James: "anyone can
   approve"); the approver's name is recorded on the release and in the report.

## Part I — Deploy to PROD / TEST

1. Idle check (nothing running on PROD or DEV). Document: deploy in a window when nothing runs.
2. **Changed since Build Release?** TM1 on the target writes its objects into Git; the IDE writes
   its attributes. If anything differs from what Build Release used (an element, a value) → stop;
   run Build Release again and approve again. The existing drift + loss gate
   (`partitionCarriedDrift`, `core/git-deploy.js:58`) stays.
3. **Save Data, then backup.** Refuse unless a backup process is set for the target; remove the typed
   time (`kind: 'stated'`). The IDE provides the backup process (in `ti-processes/`, installed like
   the IDE's other processes, p/v/n/s/c naming): Save Data, zip the data folder into the backup
   folder; the IDE passes the file name (`pBackupFile = PROD_2026-11-27_1000.zip`). The process
   reports back through TM1: file name, size, number of files. The IDE checks the zip exists, holds
   as many files as the data folder, and isn't far smaller than the last backup; any failure stops.
   Must work on Windows TM1 (the lab's PROD). Restore tests are the admin's job, done regularly
   (documented, not an IDE feature).
4. **Restore point:** the IDE adds a Git tag with the backup's name (`backup-PROD_2026-11-27_1000`)
   on the current Last Deployed commit and on the matching `attrs-<target>` commit; the report names
   both.
5. **TM1 pulls** `release-<target>`. A failed pull is undone by TM1 completely; stop and report.
6. After the pull, the IDE writes subsets and views (as today) and the attribute values from Part
   G.7, through TM1's REST API.
7. Record: Last Deployed moves to the release at the pull. The IDE reads the target's attributes
   back and writes them as Last Deployed attributes. Verify every shipped object (as today).
8. **Incomplete:** if any step after the pull fails (a subset, a view, an attribute value, verify),
   the deploy is `incomplete`; the report lists what failed for an admin to correct on the target
   (the next pre-deploy check sees those corrections as the target's own changes). The change set
   shows "Deployed to PROD: incomplete" until an admin fixes it or marks it complete with a reason.
9. Rename "Ship" (Part N).

## Part J — Recovery: restore from backup

A bad release is recovered by restoring PROD from the backup taken just before the deploy.
**Remove "Return to last release"** (`core/git-rollback.js`, `routes/deploy.js:269/281`): it only
puts objects back (data lost in the deploy stays lost) and takes no backup.

1. The admin restores PROD's data folder from the backup (outside the IDE).
2. Admin action "PROD restored from backup", choosing the backup by name. The IDE moves
   `release-PROD`, the deploy note and `attrs-PROD` back to that backup's tag, marks the bad deploy
   `reverted`, and its change set goes back to "waiting for PROD". Nothing is deleted from Git.
3. Check: TM1 on PROD writes its objects into Git; the IDE writes its attributes; Git's compare tool
   compares them with the tag. They should match; if not (wrong backup), warn and name differences.
4. The same for TEST (normally re-cloned instead).
5. Alternate-hierarchy attributes (Part B.2): investigate on the lab where v11 and v12 keep them —
   James: both can hold separate attributes per alternate hierarchy. The code reads only the
   dimension's attributes today.

## Part K — DEV restore or re-clone (emergencies only)

Re-cloning DEV is not a way of keeping DEV in step (that is the sync). It is for a broken DEV,
accepting that undeployed work is redone.

1. Close or retire every open change set first. The restore/clone happens outside the IDE, so: a
   "Prepare DEV for restore" button that refuses while a change set is open; and on connect, if DEV
   no longer matches its last write into `dev` while a change set is open, warn and name it.
2. Keep DEV's own `}git.ctx` (Part C.5 checks the label).
3. Closed, undeployed change sets stay deployable (their objects are in Git), but DEV no longer has
   their changes — say so on screen.

## Part L — The cycle and TEST

1. DEV → TEST (deploy and test); DEV → PROD (same change sets, in order); PROD → TEST (re-clone TEST
   from PROD, keeping TEST's own `}git.ctx`).
2. A cycle may hold several change sets, end to end. No new cycle starts until the re-clone; the
   IDE refuses a Deploy to TEST of a change set outside the open cycle.
3. **Re-clone TEST** (any admin): admin action "TEST was re-cloned from PROD" — TM1 on TEST writes
   its objects into Git as TEST Last Deployed; the IDE writes `attrs-TEST`; every TEST deploy not
   yet on PROD is marked `superseded` and those change sets show "waiting for TEST" again.
4. **A change set fails on TEST:** retire it (allowed when it never reached PROD), re-clone TEST,
   deploy the rest of the cycle to TEST again and test without it. Rework is a new change set.
5. Straight DEV → PROD: allowed; no TEST steps.

## Part M — Start again with a new repo

Today nothing clears the deploy note (`data/git-deploy-state.json`, and
`Applications/Governance/Deployments/state.json` once migrated) and setup refuses while it exists
(`core/git-setup.js:24` `alreadyDeployed`).

1. Admin "Start again" for a server: refuses while any closed, undeployed change set exists (deploy
   or retire first); clears the note in both places; leaves the old repo as an archive; then setup
   (Part C).
2. Find out whether TM1's own `DeployedCommit` is cleared by a re-link to a new URL; report it.

## Part N — MCP and small fixes

1. **Retire** the old-pipeline MCP tools: `check_deploy_risk`, `check_target_drift`,
   `seed_baseline`, `list_baselines`, `set_baseline_head` (`tools/tm1mcp/tools/deploy.js`),
   `diff_change_set`, `package_change_set` (`tools/tm1mcp/tools/changeset.js`).
2. **New read-only MCP tools:** pre-deploy check, show a release, show Review. Build Release,
   approve and Deploy stay with a person in the IDE. `close_change_set` must run the same close as
   the IDE (Part F.4). Update `docs/ide/MCP_SERVER.md` and the tool count in CLAUDE.md.
3. Rename "Ship": "Ready to ship" → "Ready to deploy", "Ship" → "Deploy" (buttons, labels, the
   store's `openShip` and friends).
4. Fix the wrong comment in `core/refresh-hierarchy.js` ("removing one from an alternate hierarchy
   removes it from the dimension") — lab 24 Nov, v11: it removes it from that hierarchy only.
6. **Retire catch-up** (James, 25 Nov): it sends every difference DEV vs a server as whole files,
   ignoring change sets, which breaks the records rule. The sync (Part E), re-cloning TEST (Part L)
   and restore from backup (Part J) replace it. Remove `core/git-catchup.js`, the catch-up route,
   `DeployWizard.jsx` (kept only for "Catch up a server"), and the `catch-up` change set kind;
   keep old catch-up change sets readable as history (`covered_by` still shown).
5. Retire the Protection list (deploy settings `attributeValues`, Deploy → Protection screen): the
   attributes branch finds PROD's own changes by itself.

## Part Q — After the deploy: feeders, checks, sign-off (added 26 Nov — build AFTER Parts A–N)

1. **Reprocess feeders on PROD** for every cube whose rules the release changed. There is no REST
   call for it on v11, so the IDE runs a TI process on PROD that calls `CubeProcessFeeders` per
   cube (provided in `ti-processes/`, p/v/n/s/c naming). It runs after the pull and before verify;
   its time per cube goes in the report. A failure makes the deploy `incomplete`.
2. **Run DEV's tests on PROD, read-only,** straight after the deploy, and put the results in the
   report. A failure doesn't undo anything; it marks the deploy "needs checking" and names the test.
3. **Manual sign-off.** The developer tests by hand on PROD and confirms in the IDE ("tested on PROD"
   with name and time). The deploy report gives a short plain summary the developer can send to
   users asking them to check. The deploy shows "awaiting sign-off" until confirmed.
4. **Security is out of scope** (James, 26 Nov): element security, cube security and groups are
   done by an admin by hand on PROD. The deploy never writes security, and the pre-deploy check
   doesn't treat a security change on PROD as something to bring back.

---

## Verify first (lab: TM1_Test_DEV / TM1_Test_PROD; write results in the DONE file before building)

1. TM1 on PROD writes into `live-TM1_Test_PROD`: confirm what a hierarchy file holds (elements,
   types, parents, weights, the subset list) and that attribute definitions are **not** in Git.
2. Hand-edit a copy of a hierarchy file (add one element and one parent), commit it on a throwaway
   branch, and check TM1's GitPull **plan** accepts it (plan only — never execute on PROD). Delete
   the branch. **If TM1 refuses a file the IDE wrote, stop and tell James** (agreed rule).
3. A hierarchy file whose subset list names a subset not in the release: does the pull plan fail?
   Report, and ask James how to handle it.
4. Build Release from PROD's own write as Last Deployed behaves like today's.
5. Where alternate-hierarchy attributes are kept, on v11 (and v12 if a lab server is available).
6. The backup process on the Windows PROD: zip command, file count, size.
7. Time to read the attributes of the lab's largest dimension in bulk.
8. **Does a TM1 pull remove views missing from a cube's view index?** (added 26 Nov) On a throwaway
   cube on PROD-like test objects (never on real PROD model objects): save a public view on the
   target, then pull a cube file whose `Views@Code.links` doesn't list it, and see whether the view
   survives. Plan first; execute only on a throwaway cube created for the test, deleted afterwards.
   Report, then ask James before building Part G.5's cube rule. Do the same for a hierarchy file
   whose subset index omits a subset the target has.

## Tests (node --test, fakes; no live TM1)

- The worked example end to end: TEST, then PROD with 1,040; Sarah stays Grade 4; DEV untouched;
  the change set shows both deploys.
- Second change set on Employee a week later: built from Live, PROD's 40 kept, nothing "removed".
- Two developers on Employee: only the recorded changes applied; same subset/view/rule/process
  either way round → stop.
- A TI run on DEV that changes 3 values and adds 2 elements: all recorded with before/after,
  carried, deployed. A run with no open change set on DEV → refused.
- Target removed an element → stays removed, reported; the change set uses it → stop.
- Recorded change whose before value no longer matches Live → stop.
- Written-file check catches a missing element (inject a bug).
- Attribute changed on both sides → stop; changed only on PROD → untouched; alias clash → stop.
- Target changes after Build Release → Deploy stops; rebuild needs a new approval.
- Deploy fails after the pull → `incomplete`, list of failures, Last Deployed attributes read back.
- Restore from backup → pointers back to the tag, change set "waiting for PROD", mismatch warned.
- Carry-back: copied onto DEV, never deployed to PROD, deployed to TEST; PROD's version taken at
  Build Release.
- Sync: PROD's changes written to DEV in a sync change set; clash default PROD's; untick skips.
- Close: type change → stop; deleted attribute a process writes → stop; values okayed per owner.
- Cycle: Deploy to TEST outside the open cycle refused; re-clone TEST supersedes TEST deploys.
- Ready list per target; reopen refused after any deploy; Build Release refused for a target that
  already has the change set.
- Start again refused with an undeployed closed change set; clears both notes when allowed.
- Backup missing or too small → Deploy refused; typed time no longer accepted.
- All existing deploy tests still pass (301 on 24 Nov).

## Lab run (after tests pass, with James watching)

The worked example for real on the lab: setup (PROD writes its own copy), change set on DEV (with a
TI run), Deploy to TEST, add elements and change an attribute on PROD by TI, Deploy to PROD with a
real backup, check elements, data and attributes survived. Then a sync, and a restore from the
backup.

## Later (not in this brief — do not build)

- **Scheduled sync** (James, 26 Nov): run "Sync DEV from PROD" on a schedule the admin sets per
  project — weekly, monthly, or off (ad hoc only) — in a quiet window, with the same idle check and
  clash rules as the button. Frequency is case by case.

## Questions for James (stop and ask; don't choose)

1. ~~Chores~~ — decided 25 Nov, see Part G.9 and Part E.6.
2. ~~Catch-up~~ — decided 25 Nov: retire it (Part N.6).

No open questions remain. Anything not written in this brief: ask James.

## Done

Write `16_DEPLOY_AGAIN_DONE.md`: verify results, what changed per part with file:line, test count,
anything not done and why, and every place `deployed_target` is still read.
