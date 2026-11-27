# 16 — Deploy a change set to TEST and PROD: done log

Status: **Verify first done; Parts A–N built through the 26 Nov next-build request — see the second build log at the end (Parts F, G, E, H, N).** James's answers are at the end of the verify log.
The build log below records what was built (A, B, C, D-check, I.3/I.4/I.8, J, L.3, M, K.1, N.3/N.4),
the test count, what was not built and why, and the questions that remain. No lab run was performed.

Date: 25 Nov 2026 (check 8: 26 Nov 2026). Lab: `TM1_Test_DEV` / `TM1_Test_PROD`, version
11.8.02800.9, Git repo `https://github.com/falconbi/tm1_git_test.git`.

Tools used: TM1 REST (through the IDE's `TM1Client`), TM1 Git (`GitStatus` / `GitPush` / `GitPull`
plans), the `git` CLI on this machine for reading a clone and, for check 8, editing and pushing a
throwaway branch. No IDE code was changed, nothing was pushed to the IDE repository, and the server
was not restarted.

Lab tidiness:

- `live-TM1_Test_PROD` was created by **TM1 on PROD** and is kept (it is the new live branch from
  Part B.1).
- The two throwaway branches made for checks 2 and 3 (`verify16-hier`, `verify16-subset`) were
  deleted from the remote.
- The throwaway dimension used for check 5 (`ZZ Verify16 AttrDim`) was deleted from DEV.
- Check 8's throwaway objects (three dimensions, one cube, two views, two subsets) were deleted
  from PROD, and its throwaway branch `verify16-check8` was deleted from the remote. PROD's Git
  pointer (`DeployedCommit`) was put back to `33f32f0e`, its value before the check.
- No real PROD model object was written. Check 6 was not run (see below). Check 8 executed one
  pull, but only on the throwaway objects it created, deleted afterwards.

---

## Verify first — results

### 1. What TM1 on PROD writes into `live-TM1_Test_PROD`

**Tool: TM1 Git (PROD) writes; Git CLI reads.**

TM1 on PROD pushed its live state to branch `live-TM1_Test_PROD` at commit `4efbbdac`
(message `verify 16: PROD live state`). The repo is 142 dimension files plus the cube, process,
chore, view and subset files.

A hierarchy file holds exactly what the brief says:

`dimensions/WFP Employee.hierarchies/WFP Employee.json`
- `Elements`: 490 entries, each `{ "Name": …, "Type": "Numeric" | "Consolidated" | "String" }`
- `Edges`: 489 entries, each `{ "ParentName": …, "ComponentName": …, "Weight": … }`
- `Subsets@Code.links`: 3 links (`Default.json`, `WFP RECALC All Employees.json`,
  `WFP RECALC People.json`)

Its dimension file is only the identity and links:

`dimensions/WFP Employee.json`
- `Name`, `Hierarchies@Code.links`, `DefaultHierarchy`

Across the branch there are 36 hierarchy files: 9 carry `Edges`, 27 are all leaves and carry none.
Where there are parents, the edge weight is in the file.

**Attribute definitions are not in Git.** There are zero `}ElementAttributes_*` files (and no
control objects) in the branch. The only text match for "attribute" in `dimensions/` is two element
names on `SYS Setting` (`Version Type Attribute`, `Version Status Attribute`) — names, not
definitions or values.

### 2. Hand-edited hierarchy file: TM1's pull plan accepts it

**Tool: Git CLI writes a throwaway branch; TM1 on PROD creates a pull plan (not executed).**

Starting from `live-TM1_Test_PROD`, I added one element (`ZZ Verify16 Element`, Numeric) and one
parent edge (`Group` → `ZZ Verify16 Element`, weight 1) to
`dimensions/WFP Entity.hierarchies/WFP Entity.json`, committed it as `ef05c08` on branch
`verify16-hier`, and pushed that branch.

TM1 on PROD then created a `GitPull` plan for `verify16-hier` (plan only — `tm1.Execute` was never
called). The plan was accepted and listed exactly one real operation:

```
Replace Dimensions('WFP Entity')
Skip Dimensions('…') / Skip Processes('…') / Skip Chores('…') / Skip Cubes('…')   (everything else)
```

So TM1 accepts a JSON hierarchy file the IDE wrote (same tab-indented JSON shape as TM1's own
writer), and the plan is scoped to the one changed dimension. The throwaway branch was then deleted.

### 3. A hierarchy file naming a subset that is not in the release

**Tool: Git CLI writes a throwaway branch; TM1 on PROD creates a pull plan (not executed).**

On branch `verify16-subset` (commit `26c41aa`), `WFP Entity`'s `Subsets@Code.links` gained
`WFP Entity.subsets/ZZ Verify16 Missing.json`, which does not exist in the branch. TM1's `GitPull`
plan creation **failed immediately**:

```
Failed to preprocess the source of "Dimensions('WFP Entity')".
Reason: Failed to read Hierarchy "WFP Entity" for reason
"Cannot open the file specified by link "WFP Entity.subsets/ZZ Verify16 Missing.json"
("…/WFP Entity.subsets/ZZ Verify16 Missing.json")."
```

The branch was then deleted. **This is the Part G.5 question:** the release builder must guarantee
that every subset link in a carried hierarchy file is also in the release tree (or remove the link
first). **James: how should the IDE handle a Live hierarchy file whose link list names a subset
the release does not carry?** Options are (a) refuse Build Release and name the subset, or (b) carry
the missing subset from Live as a dependency. The lab says the pull itself refuses; the IDE has to
choose before the pull.

### 4. Build Release with PROD's own write as Last Deployed

**Tool: Git CLI in a local mirror; IDE `buildRelease()` in a sandbox data directory.**

Current recorded PROD Last Deployed is the release commit `7fad9d08`. PROD's own write is
`4efbbdac`. In a sandbox (copy of `change_log.db` plus a `git-deploy-state.json` pointing at each
base, and a local bare mirror — no branch was pushed to GitHub by this check), I ran the real
`buildRelease()` for the closed change set `zz-data-cleanup` against both bases.

Both runs returned the same result:

```
ok: true, noChange: true
reason: "nothing to deploy: this change set owns nothing that changed
         (3 objects are changed on DEV but not in this release)"
leftOnDev: view WFP RECALC Assignment Pay Src
           view WFP CLEAR Cost Src
           subset WFP RECALC Version
```

The three differences are the target's own view/subset changes (TM1 Git never pulls those); they
were correctly left on DEV, not shipped. So a base written by TM1 on the target behaves exactly
like today's release-commit base — the code only cares that the commit resolves and diffs.

### 5. Where alternate-hierarchy attributes live on v11

**Tool: TM1 REST reads (PROD/DEV) plus a throwaway dimension on DEV (deleted afterwards).**

- The lab has **no v12 server**. The Admin Server lists `24retail`, `TM1_Test_DEV`,
  `TM1_Test_PROD`; all are 11.8.02800.9. The v12 half of this check cannot be done here.
- On v11 there is **one attribute cube per model dimension**, not one per hierarchy. `WFP Position`
  has three hierarchies (`WFP Position`, `By Location`, `Leaves`) but only one
  `}ElementAttributes_WFP Position` cube, with one hierarchy in its attribute dimension and 17
  attribute definitions on PROD.
- Reading attributes through an alternate hierarchy returns the **same definitions and the same
  values** as through the default hierarchy for a shared element name.
- Throwaway test on DEV (`ZZ Verify16 AttrDim`): a leaf `E1` in both the default and `Alt`
  hierarchies had one value. Writing `base note` through the default hierarchy made `Alt` read
  `base note`; writing `alt note` through `Alt` changed the default hierarchy's read to
  `alt note`. The value is per element name, shared by every hierarchy.
- An element that exists **only** in an alternate hierarchy (`E3`) can hold its own attribute value
  in the same cube, readable and writable through that hierarchy's element path; the default
  hierarchy does not contain `E3` and returns `'E3' can not be found`.

**Consequence for Part B.2 / J.5:** on v11 there is no separate attribute definition set per
alternate hierarchy. Attributes are stored once per dimension, keyed by element name. The
per-hierarchy behaviour James described is real only in the sense that elements unique to an
alternate hierarchy carry values that a read of the default hierarchy's element list will never see.
Part B.2's "per alternate hierarchy that has its own attributes" can be simplified on v11 to "the
dimension's attribute cube, including elements that live only in an alternate hierarchy". v12 still
needs a check when a v12 lab exists.

**Observed attribute drift on the lab:** PROD has 17 attributes on `WFP Position`; DEV has 21. DEV
additionally has `Source`, `HRIS Position ID`, `Matched TBH`, `Matched From`. Git does not carry
attribute definitions at all (check 1), so the `attrs-<server>` work is the only thing that can
move these.

### 6. Backup process on the Windows PROD

**Not executed.** Running the probe means executing a process on PROD (the only way to list the
data folder or test a zip command), and PROD is the read-only lab target. The verify rules say the
pre-deploy check writes nothing to PROD; I stopped rather than run a TI process there without
James's go-ahead.

What the TM1 REST reads establish:

- PROD is Windows: data directory `c:\tm1admin\tm1_test_servers\tm1_test_prod\data`, log directory
  `c:\tm1admin\tm1_test_servers\tm1_test_prod\logs`.
- No backup process is configured for PROD: `data/deploy-settings.json` has
  `"TM1_Test_PROD": { "backupProcess": null }`.
- The only backup already on the server is Bedrock's `}bedrock.server.dir.backup`. It does **not**
  zip: it saves data, then uses `XCOPY` (default) or `ROBOCOPY` (`pRobocopy=1`) to copy the folder,
  with an exclude list; the folder is `TM1Backup_<timestamp>`. On Windows it builds a `.bat` and
  runs it with `ExecuteCommand`.
- Bedrock also has `}bedrock.server.executecommand`, which supports `pPowerShell=1`, and
  `}bedrock.server.dir.listcontents`, which writes `List_All_Data_Directory_Files.txt` and other
  lists into the data directory.

**James: may I run a read-only probe on PROD** (for example `}bedrock.server.executecommand` with
PowerShell `Get-ChildItem` to count files and sum sizes, plus `Get-Command Compress-Archive` /
`tar.exe`), or do you want this measured in the Lab run with you watching? The probe would create a
command-output file under the server's error-log directory, not change model data.

### 7. Time to read the lab's largest dimension's attributes in bulk

**Tool: TM1 REST, one MDX cellset per hierarchy (not element by element).**

`WFP Position` is the largest dimension: 3,036 elements in `By Location`, 537 in the default
hierarchy, 6,598 element entries across its three hierarchies.

| Server | Attributes | Hierarchy | Rows | Cells | Time |
|---|---|---|---|---|---|
| PROD | 17 | `WFP Position` (default) | 537 | 9,129 | **179 ms** |
| PROD | 17 | `By Location` (largest) | 3,036 | 51,612 | **1,010 ms** |
| DEV | 21 | `WFP Position` (default) | 537 | 11,277 | **277 ms** |
| DEV | 21 | `By Location` (largest) | 3,036 | 63,756 | **1,530 ms** |

Read via one `ExecuteMDX` per hierarchy selecting all attribute columns over `TM1SUBSETALL`, then
the axes and cells. Bulk reading the whole attribute cube is fast enough for every pre-deploy
check and Build Release; there is no need to read element by element.

### 8. Does a TM1 pull remove views (or subsets) missing from an index?

**Tool: TM1 Git on PROD writes (`GitPush`) and pulls (`GitPull` plan + execute); Git CLI edits a
throwaway branch; TM1 REST reads the objects back.**

Only throwaway objects were used on the lab's PROD (`TM1_Test_PROD`):

- a dimension `ZZ Verify16 ViewDim` (V1–V3), a `ZZ Verify16 Measure` (Value), and a cube
  `ZZ Verify16 ViewCube` on them;
- two public views on that cube: `ZZ Verify16 KeepView` and `ZZ Verify16 ListedView`;
- a dimension `ZZ Verify16 SubsetDim` (S1–S3) with two public static subsets:
  `ZZ Verify16 SubsetKeep` and `ZZ Verify16 SubsetListed`.

TM1 on PROD pushed its live state to a throwaway branch `verify16-check8` (commit `2f25c0e7`).
In a local clone I changed only the two index lists and pushed commit `71e1f3e8`:

- the cube file dropped `…/ZZ Verify16 KeepView.json` from `Views@Code.links` (its `.json` and
  `.mdx` files stayed in the branch, unlinked); `ListedView` stayed linked;
- the hierarchy file dropped `…/ZZ Verify16 SubsetKeep.json` from `Subsets@Code.links` (its file
  stayed in the branch, unlinked); `SubsetListed` stayed linked.

TM1 on PROD then made a `GitPull` plan for that branch. It was cleanly scoped: two non-Skip
operations, `Update Cubes('ZZ Verify16 ViewCube')` and `Update Dimensions('ZZ Verify16 SubsetDim')`;
every other object was `Skip`. I executed that plan.

Result, read back through TM1 REST:

| Object | In the index? | After the pull |
|---|---|---|
| `ZZ Verify16 KeepView` (view) | no | **still present** |
| `ZZ Verify16 ListedView` (view) | yes | still present |
| `ZZ Verify16 SubsetKeep` (subset) | no | **still present** |
| `ZZ Verify16 SubsetListed` (subset) | yes | still present |

So on v11.8.02800.9 a TM1 pull **does not remove** a view or subset that the target has but the
pulled cube/hierarchy file's index does not list. The target's extra views and subsets survive the
pull; only the files the index names are applied.

**Consequence for Part G.5:** the condition in the brief ("if a pull removes views missing from
the index, keep the target's view links in the cube file and carry their files from Live") is not
what this server does. A cube file from DEV After Close can keep DEV's view index, and PROD's own
views survive untouched — carrying the target's view links/files from Live is not needed for them
to survive. The same is true of a hierarchy file's subset index. The link-closure rule still
stands for a *referenced* file that is missing: TM1 refuses the whole pull (check 3).

---

## Questions for James (stopping here)

1. **Check 3** — a carried hierarchy whose `Subsets@Code.links` names a subset not in the release
   makes TM1's pull plan fail. Refuse Build Release and name it, or carry the missing subset from
   Live? (Part G.5 left this to the lab.)
2. **Check 6** — may I run a read-only PowerShell probe on PROD to measure the data folder and
   confirm `Compress-Archive` / `tar.exe`, or is that done in the Lab run?
3. **Check 8** — the pull did **not** remove the unlisted view or subset; the target's extras
   survive. Does Part G.5's cube rule then keep DEV After Close's view index as-is (PROD's own
   views survive), rather than keeping the target's view links and carrying their files from Live?
   Same question for the hierarchy/subset index.

## Not done yet (on purpose)

Parts A–N, the tests, and the Lab run have not been started. This file will gain the per-part
change list, the test count, the "not done and why" list, and every place `deployed_target` is still
read once the build begins.

---

## James's answers (26 Nov)

1. **Check 3:** carry the target's subset file from Live into the release for every link in a
   carried hierarchy file (brief Part G.5 updated). A subset the change set deleted has its link
   removed instead.
   **Widened 26 Nov:** the same rule for every index — dimension → hierarchies, hierarchy → subsets,
   cube → views. Carry any missing linked file from Live, then run `linkClosure` as a final check.
   New Verify first check 8: does a pull remove views (or subsets) missing from an index? Run it
   before building Part G.5's cube rule.
2. **Check 6:** no probe on PROD now. Measure the backup (file count, size, zip tool) in the lab run,
   with James watching.

---

# Build log — Parts A to N (26 Nov 2026)

Status: **partial**. Parts A, B (branch + attributes), C, D (read-only check), I (I.3/I.4/I.8),
J, L.3, M and the small fixes in N are built and tested. Parts E, F, G, H, K (beyond the prepare
guard), and N.1/N.2/N.5/N.6 are **not built** — reasons and the questions they raise are below.
No lab run was performed, nothing was committed, nothing was pushed to GitHub, and the server was
not restarted. `cd client && npm run build` was run, so `static/` is current.

Test result after the build: **927 tests, 926 pass, 0 fail, 1 skipped** (`npm test`, 17 s). The
baseline before this work was 894 tests (893 pass, 1 skipped), so the net is +33 tests.

## Part A — deploy records per server: done

- New tables `session_deploys` and `session_releases`, one row per `(session, target)` (so TEST and
  PROD are separate, and a PROD build cannot overwrite TEST's release): `core/change-log.js:45`,
  `core/change-log.js:63`.
- `recordSessionDeploy` / `getSessionDeploy(s)` / `getDeploysForSessions` / `deployTargets` /
  `hasAnyDeploy` / `hasCompleteDeploy` / `setSessionDeployStatus` / `latestDeployTo` /
  `getDeploysForTarget`: `core/change-log.js:166`–`254`.
- `recordSessionRelease` / `getSessionRelease(s)`: `core/change-log.js:256`–`276`. `setSessionRelease`
  writes both the compat columns and the per-target release row: `core/change-log.js:140`.
- `markSessionDeployed` keeps its old signature and now also writes a deploy row with status,
  reason, release/base/attrs/backup refs: `core/change-log.js:287`.
- Owner and ordering are per target. `ownerOf` skips a set only when it has reached *this* target
  (`deployedTo`): `core/git-release.js:289`, `core/git-release.js:301`; ordering rows use it at
  `core/git-release.js:838`.
- Reopening is refused once a set reached **any** server (`hasAnyDeploy`): `routes/changesets.js:59`.
- `/api/sessions` returns each set's per-target `deploys` and `deployed_targets`: `routes/changesets.js:140`.
- `/api/deploy/git/release` refuses a build for a target that already has a `complete` deploy:
  `routes/deploy.js:398`.
- Client per-target list + helpers (`deployedTo`, `readyForTarget`, `whereDeployed`):
  `client/src/lib/deploy/change-sets.js:46`–`78`; the Release screen has a target selector and shows
  "Deployed to TEST … — waiting for PROD": `client/src/components/DeployRelease.jsx:24`, `:97`.
- Tests: `tests/deploy-records-per-target.test.js` (7).

## Part B — branches and the attributes branch: B.1 and B.2 done (v11 shape)

- Drift writes `live-<server>` instead of `prod-live`: `core/git-drift.js:60`, push/diff/read at
  `:62`–`:119`. Active comments in `core/git-state.js` and `core/git-deploy.js` were updated; the
  old `prod-live` branch is left unused in any repo.
- `attrs-<server>` is written by the IDE only, one file per model dimension, stable order:
  `core/git-attrs.js` (`attrsBranch`/`attrsPath`/`serialiseAttributes`), bulk MDX read per hierarchy
  and merge by element name: `core/git-attrs.js:83`–`145`, branch writer `:160`–`208`, reader/tag
  helpers `:212`–`231`.
- Writes wired at setup (`core/git-setup.js:106`, `:170`) and at the pre-deploy check
  (`core/pre-deploy.js:150`).
- Attribute values are held on Git, accepted by James; stated in the module header
  `core/git-attrs.js:10`–`17`. The README/docs for end users are not yet updated (see Not done).
- Performance note: `collectAttrsFiles` reads one elements list plus one bulk MDX per hierarchy per
  dimension. Check 7 measured 179 ms – 1.5 s for the lab's largest dimension; a model with 142
  dimensions will take minutes, not seconds. It is bulk, never element-by-element, but it is the
  first thing to optimise after the lab run.
- Tests: `tests/git-attrs.test.js` (4).

## Part C — setup: done (core + routes); UI uses the old flow

- `setupServer` links (if needed), asks **TM1 on the server** to write its own objects (DEV → `dev`,
  TEST/PROD → `live-<server>`), records a target's own write as Last Deployed, and writes the
  attributes initialisation commit: `core/git-setup.js:122`–`178`. Nothing is pulled onto the
  server. A label mismatch (e.g. DEV linked as PROD) is refused: `core/git-setup.js:143`.
- One-off start for an existing server (`startAttrs`): `core/git-setup.js:181`.
- Routes: `POST /api/git/setup/start` (`routes/deploy.js:624`) and `GET /api/git/setup/label`
  (`routes/deploy.js:679`). The old first-pull route still exists for compatibility.
- `GitSetup.jsx` still offered first-pull at this point; its PROD/TEST step was switched to
  `/api/git/setup/start` in Fix 9 below.
- Tests: `tests/git-setup-start.test.js` (4).

## Part D — pre-deploy check: read-only core done (carry-back and D.5 built in Fix 7)

- `classifyDrift` sorts target changes into stop / keep / carry-back / sync, exactly Part D.3's
  categories: `core/pre-deploy.js:60`–`101`. Rule/process stops and offers carry-back; cube
  structure stops; elements/hierarchies/subsets/views/chores are kept and named for the sync.
- `preDeployCheck` runs idle checks on target and DEV, lets the target write `live-<target>`, writes
  `attrs-<target>`, and classifies: `core/pre-deploy.js:108`–`175`.
- Route `POST /api/deploy/pre-check`: `routes/deploy.js:113`.
- Tests: `tests/pre-deploy-check.test.js` (7).
- Not done at this point: creating the `carry-back` change set and copying PROD's rule/process text
  onto DEV (D.4.1–D.4.4), the DEV-deleted-object scan (D.5), and the Review/Continue UI. All were
  built in Fix 7 and Fix 9 below.

## Part I — Deploy: I.3/I.4/I.8 done (I.3 measurement deferred to the lab)

- A backup is required, not stated. The typed time is gone; the default is the IDE's own
  `}IDE.Backup`, installed on demand and passed the exact file name: `core/deploy-backup.js:25`,
  `:30`; wired at `core/git-deploy.js:548`–`574`. The route still accepts `backupAt` but it is no
  longer used.
- `}IDE.Backup` gained `pBackupFile` and archives under that name: `ti-processes/backup/process.json`
  (parameter + `cArchive`); `backupData({ fileName })` passes it: `core/tm1-client.js` (backupData).
- Restore-point tags on the pre-deploy commit and the attributes commit:
  `core/deploy-backup.js:38`–`83`, wired at `core/git-deploy.js:594`.
- `incomplete` status when anything after the pull fails; `complete` only when clean:
  `routes/deploy.js:145`.
- The Windows file-count/size measurement is **not** implemented; the process currently fails only
  when its archive is missing. That is the part James deferred to the Lab run.
- Tests: `tests/deploy-backup-restore-point.test.js` (4), plus the updated
  `tests/backup-process.test.js` and `tests/deploy-git-release.test.js`.

## Part J — restore from backup: done (J.5 deferred)

- `core/git-rollback.js` and its routes/tests are removed. `restoreFromBackup` resolves the backup
  tag, compares the target's own write with it (warns and names files on a mismatch), moves
  `release-<target>`, the deploy note and `attrs-<target>` back, and marks the bad deploy
  `reverted`: `core/restore-backup.js:74`–`170`. Route `POST /api/deploy/git/restore-from-backup`
  (`routes/deploy.js:299`). The Drift screen now offers this instead of "Return to last release":
  `client/src/components/GitDrift.jsx`.
- J.5 (alternate-hierarchy attributes on v12) is deferred; see Questions.
- Tests: `tests/restore-from-backup.test.js` (4).

## Part L — TEST cycle: L.3 done (membership and L.4 built in Fix 6)

- `recloneTest` makes TEST's own write its Last Deployed, writes `attrs-TEST`, and supersedes every
  TEST deploy that never reached another target: `core/deploy-admin.js:45`–`83`. Route
  `POST /api/deploy/reclone-test` (`routes/deploy.js:652`).
- Tests: `tests/deploy-admin.test.js` (4), which also covers M and K.1.
- Not done at this point: the "open cycle" itself (L.1/L.2 — what makes a change set a member of
  the open cycle), and allowing a TEST-failed set to be retired after it reached TEST but not PROD
  (L.4). Both were built in Fix 6 below.

## Part M — start again: done (M.2 needs the lab)

- `startAgain` refuses while a closed, undeployed set exists, then clears the deploy note locally and
  in the model: `core/deploy-admin.js:25`; `clearDeployState`: `core/git-state.js:53`. Route
  `POST /api/deploy/start-again` (`routes/deploy.js:639`). The old repository is left as the archive.
- M.2 (whether TM1's `DeployedCommit` is cleared by a re-link) is a lab question; see Questions.

## Part K — DEV restore: K.1 prepare guard done (K.2 warning built in Fix 9)

- `prepareDevRestore` refuses while any change set is open: `core/deploy-admin.js:85`; route
  `POST /api/deploy/prepare-dev-restore` (`routes/deploy.js:667`).
- Not done at this point: the on-connect warning when DEV no longer matches its last write while a
  set is open, and the on-screen wording for closed-but-undeployed sets (K.2/K.3). The K.2 warning
  was built in Fix 9 below; E.6's on-connect chore warning is also in Fix 9.

## Part N — small fixes: N.3 and N.4 done

- N.3 renamed the visible language: "Ready to ship" → "Ready to deploy" (`DeployTab.jsx:17`,
  `DeployRelease.jsx:30`), "Send it" → "Deploy it" (`DeployFlow.jsx`), "shipped" → "deployed" in
  the change-set row and report, and added `openDeploy`/`closeDeploy` aliases next to the old store
  fields (`client/src/store/index.js:518`).
- N.4 fixed the wrong comment in `core/refresh-hierarchy.js:15` to the lab's v11 fact (removing an
  element from an alternate hierarchy removes it from that hierarchy only).
- Not done: N.1 (retiring the old REST-pipeline MCP tools), N.2 (new read-only MCP tools), N.5
  (retiring the Protection attribute list), N.6 (retiring catch-up). Reasons under Not done.

## Not done, and why

- **Part E — Sync DEV from PROD.** The existing Refresh is not the sync and refuses a closed set;
  building the `sync` change set (default take PROD's, untick, chores switched off, closed and never
  deployed) is a rewrite of the refresh entry point. I did not start it rather than leave a
  half-wired second path beside Refresh.
- **Part F — recording every TI run's before/after.** This needs every element/edge/attribute write
  in `routes/dimensions.js` to carry before/after state (today many log only a detail string;
  `routes/dimensions.js:285`–`351`), a before/after capture around `runProcess`, and the close
  screen's attribute-value ownership list. It is the largest remaining data-model change and was not
  attempted.
- **Part G — Build Release from Live + recorded changes.** The existing `core/git-release.js`
  still takes whole files from DEV After Close and applies no recorded before/after values. G.3–G.8
  (Live + records, per element; index closure from Live; attribute rules; chore split) are the heart
  of the brief and are **not** implemented. A partial version would have shipped the wrong thing, so
  I stopped rather than pretend.
- **Part H — Review.** The existing Review is unchanged; it does not yet show "what came from the
  target", target removals, or type-change approvals from the new release shape (it still shows the
  old element-loss/type list). No four-eyes rule already, so no change was needed there.
- **N.1/N.2 — MCP.** Retiring the seven tools and adding `pre_deploy_check` / `show_release` /
  `show_review` also changes `guard.js` classification, the generated tool table, the docs counts
  and the MCP tests. That is mechanical but I did not want to change the MCP surface without the
  release/Review objects it would show.
- **N.5/N.6 — Protection list and catch-up.** Both are replacements-backed. N.5's `attributeValues`
  still scopes Refresh; removing it before Part E exists would make Refresh copy every attribute
  wholesale (the Sarah bug). N.6's catch-up is still the only whole-model path left while Part G is
  not built. They should be removed together with E and G.

## Every place `deployed_target` is still read (Part A.1 audit)

Decisions now use the per-target table; these reads are display/compatibility only:

- `core/git-release.js:291` — `deployedTo` fallback when no target is supplied (tests and callers
  that ask "deployed anywhere").
- `core/git-release.js:436` — the compat field on the other-session rows (the decision also carries
  `deployed_targets`).
- `core/change-log.js:192`, `:194`, `:239`, `:289` — writes/clears of the compat column.
- `core/change-log.js:534` — selected alongside `deployed_targets` for ordering.
- `routes/changesets.js:59`, `:61`, `:87`, `:89` — a fallback when no deploy row exists (old sets
  recorded before this change); `:145` — the legacy `deployed` boolean.
- `client/src/lib/deploy/change-sets.js:25` — the old `readyToRelease` (still used by
  `useChangeSetSummary`); `:54` — `deployedTo` fallback for sets with no `deploys` array.
- `client/src/components/ChangeLogPanel.jsx:161`, `:242` — the row's "deployed to" text and the
  report link.
- `client/src/components/DeployWizard.jsx:152`, `:163` — the old wizard, kept for catch-up; it will
  go with N.6.

## Questions for James (stopping short of these)

1. **Part B.2 / J.5 — attributes per alternate hierarchy.** Verify check 5 found on the lab's v11
   that attributes are stored once per dimension, keyed by element name, and elements unique to an
   alternate hierarchy carry their values in the same attribute cube; there is no separate attribute
   set per hierarchy. I built `attrs-<server>` as **one file per dimension**, merging every
   hierarchy's elements. Is that the intended shape, or must v12 get per-hierarchy files? A v12 lab
   is still needed.
2. **Part L.1/L.2 — what is an "open cycle"?** The brief says a Deploy to TEST is refused for a
   change set "outside the open cycle", but does not say how membership is recorded (a time window
   from a cycle-start action, an explicit list, or the closure of the previous re-clone). I did not
   invent one; L.3 and the re-clone itself are built.
3. **Part I.3 — backup measurement.** The process now fails when its archive is missing and records
   the exact file name; the "as many files as the data folder / not far smaller than the last
   backup" check needs the Windows measurement from the Lab run. Confirm that is what should be
   added there.
4. **Part M.2 — TM1's `DeployedCommit` on re-link.** Needs the lab: does a re-link to a new URL
   clear it? Report only, as the brief says.
5. **Part I.3 on v12.** Every deploy now runs `}IDE.Backup` by default, and it uses `ExecuteCommand`
   with Windows `tar.exe`. The old Protection screen warned that v12 disallows `ExecuteCommand`, so
   on a v12 target this would stop every deploy. The brief removes the typed-time fallback and has
   no v12 backup answer; confirm how a v12 target should back up (a different process, or a v12-safe
   archive method) before that server is used.

## Next build — James, 26 Nov

Build Parts F, G, E and H, in that order, then N.5 and N.6 and N.1/N.2 that depend on them.
Build question 1: yes — `attrs-<server>` is one file per dimension on v11, every hierarchy's
elements merged; v12 waits for a v12 lab. Build questions 2–5 are answered later; don't block on
them.

---

# Build log — Parts F, G, E, H and the N fixes (26 Nov 2026)

Status: **built as asked, no lab run.** Parts F, G, E and H are in place, then
N.5, N.6, N.1 and N.2. Nothing was committed, nothing was pushed to GitHub, and the
server was not restarted. `cd client && npm run build` was run, so `static/` is current.

Test result after the build: **923 tests, 922 pass, 0 fail, 1 skipped** (`npm test`,
~15 s). The previous log's 927 included the retired catch-up suite and the old
deploy-check MCP suite (both removed with N.6/N.1); 16 new tests were added for
F, G, E and the close checks, so the net against 927 is −4 by design.

## Part F — recording every change on DEV, and the close

- **Structured records** (`core/recorded-changes.js:50` `elementOps`,
  `:127` `recordedChanges`). Elements, renames, links, unlinks, weights, types,
  attribute definitions and attribute values are replayed from the log's
  `before_state` / `after_state`; older detail-only rows are parsed for the shapes
  the routes have always written. A row that cannot be made structured marks the
  dimension `whole` (never a guess).
- **Routes now write before/after** for element add (`routes/dimensions.js:285`),
  delete (`:299`), rename (`:315`), place (`:337`), weight (`:352`) and edge
  removal (`:358`); bulk import records a whole-dimension row (`:44`). Attribute
  values already carried before/after (`core/server_helpers.js:61`).
- **TI runs on DEV** (`core/process-capture.js:108` `beginCapture`, `:144`
  `recordDimensionDiff`): before/after snapshots of every dimension the process
  names in a dimension/attribute write; elements added/removed/typed, parents
  added/removed/weighted and attribute values are logged with both values. A
  per-dimension lock (`:39`) makes a second run wait for the first capture. The
  run entry lists the captured dimensions and says cube data is not deployed
  (`routes/processes.js:182`, `tools/tm1mcp/tools/develop.js:141`).
- **DEV needs an open change set** (`core/process-capture.js:233`
  `requiresChangeSet`), enforced in the IDE route (`routes/processes.js:162`) and
  the MCP tool (`tools/tm1mcp/tools/develop.js:121`). TEST/PROD and an unlinked
  server are not treated as DEV.
- **Close checks** (`core/close-check.js:152` `preCloseCheck`): attribute type
  changes text ↔ number are a hard stop (`:59`); values changed since the last
  close are listed with their owner, and an unowned value can be ticked into the
  change set (`:191`); a deleted dimension/cube/attribute a DEV process writes or
  reads stops the close (`:113`). The close route runs it and then finalizes
  (`routes/changesets.js:40`, `:68`; read-only preview route `:111`). The MCP
  `close_change_set` runs the same check and finalize (`tools/tm1mcp/tools/changeset.js:51`).
- **DEV After Close** (`core/close-check.js:225` `finalizeDevClose`): TM1 on DEV
  writes `dev`, the commit is recorded on the change set, and the IDE writes
  `attrs-DEV`. The Deploy flow no longer pushes a second time
  (`client/src/components/DeployFlow.jsx:203`).

## Part G — Build Release from Live plus the records (the heart)

- **Live is the starting point** (`core/git-release.js:489` reads
  `live-<target>`; `:492` loads the records; `:508` refreshes the target's
  attributes). With no live branch (targets set up before Part B, and the older
  fixtures) the whole-file path is kept unchanged.
- **Dimensions and hierarchies** (`core/release-live.js:59`
  `applyDimensionChanges`): take Live's file and apply the recorded add / delete /
  rename / place / unplace / weight / type changes. A change applies only when Live
  still has the recorded before value or already has the after value; otherwise
  Build Release stops and names it. Target-added elements stay, target-removed
  elements stay removed, new elements are appended in record order, and type
  changes are listed for Review. `core/git-release.js:873` writes the file from
  Live, `:940` runs the written-file check (`core/release-live.js:370`).
- **The written-file check** (`core/release-live.js:370`
  `checkWrittenHierarchy`) re-checks every Live element and parent against the
  file and every difference against the records; a mismatch stops the build.
- **The index rule** (`core/git-release.js:1029`): a file an index names that the
  release does not carry comes from Live first; a DEV-only file is carried only
  when this change set owns it, otherwise its link is removed and named
  (`:1051`, `removeLinkedFile` `:386`). Recorded subset/view deletes remove their
  link (`:987`), cube files from DEV keep DEV's view index minus entries the
  release does not carry (`:1080`), and `linkClosure` remains the final check.
- **Subsets / views / rules / processes / cubes** are still the whole object from
  DEV After Close; a rule, process or cube structural change on the target now
  stops the build before it can be undone (`core/git-release.js:743`). A second
  change set on the same object stops a live build either way round (`:1123`).
- **Attributes** (`core/release-live.js:272` `planAttributeChanges`): only the
  records; Live = Last Deployed ⇒ write the after value; both sides changed ⇒ stop
  with all three values named; unrecorded values are never written (Sarah); alias
  clashes stop naming both elements. The plan is stored on the release
  (`routes/deploy.js:392`) and applied after the pull (`core/apply-attrs.js:12`,
  wired at `core/git-deploy.js:688`). The old manifest-driven wholesale copy is
  skipped whenever a plan exists (`core/git-deploy.js:752`).
- **Chores** (`core/release-live.js:224` `applyChoreChanges`): Live's chore file
  plus recorded schedule fields; both sides moving a field stops; the on/off flag
  is never touched.
- **Target changed after Build Release** (`core/git-deploy.js:414` object tree,
  `:446` attribute values): Deploy refuses and asks for a new build + approval.
  Last Deployed attributes are read back from the target after the pull and
  written to `attrs-<target>` (`core/git-deploy.js:699`).
- **Recorded per dimension** as Review/report notes ("Employee: 1 element PROD
  added itself") (`core/git-release.js:1259`).

## Part E — Sync DEV from PROD

- `core/sync-dev.js:27` `syncSelection` is the pure default-take-PROD's selection
  (deletes, moves, type changes, covers, hierarchies, chores), with an `untick`
  list that skips an item this time.
- `core/sync-dev.js:129` `syncDevFromProd`: idle checks, plan, opens a `sync`
  change set, applies through the existing refresh modules, copies attribute
  values PROD changed since its last deploy (`:65`), creates PROD-only chores and
  switches every copied chore off (`:105`), writes DEV into `dev` + `attrs-DEV`,
  closes the set and records it as never deployed (`:196`). A failed write stops
  the sync and leaves the change set open for the admin.
- Routes: `POST /api/deploy/sync` and read-only `GET /api/deploy/sync/plan`
  (`routes/deploy.js:664`, `:683`). UI: `client/src/components/DeploySync.jsx`,
  opened from the Deploy tab (`client/src/components/DeployTab.jsx:81`).
- A `sync` set owns nothing (`core/git-release.js:316`) and is not in the ready
  lists (`client/src/lib/deploy/change-sets.js:29`).

## Part H — Review and approve

- Build Release returns `targetNotes`, `targetRemovals`, `indexNotes`,
  `typeChanges` and `attributePlan` (`core/git-release.js:1259`), stored on the
  release and shown in Review (`client/src/components/DeployFlow.jsx:741`,
  `:753`). The existing element-loss and type-change gates are unchanged; there is
  still no four-eyes rule and the approver's name is recorded as before.

## N.5, N.6, N.1, N.2

- **N.5** — the Protection attribute list is retired: `attributeValues` is no
  longer part of the deploy settings (`core/deploy-settings.js:19`), Refresh no
  longer copies values from it (`core/refresh-dev.js:143`), and the Protection
  screen/nav entry is removed (`client/src/components/DeployProtection.jsx`
  deleted; `client/src/components/DeployTab.jsx`).
- **N.6** — catch-up retired: `core/git-catchup.js`, its two routes, the
  `DeployWizard`, its store fields and its dedicated tests are removed. Old
  catch-up sets stay readable as history (`kind` and `covered_by` are untouched).
  Note: the internal `catchUp` branch in `buildRelease` is left in place so an old
  catch-up release can still be inspected; no new catch-up can be started.
- **N.1** — the seven old REST-pipeline tools are removed from
  `tools/tm1mcp/tools/deploy.js` and `changeset.js`, and from the guard lists
  (`tools/tm1mcp/guard.js:34`). Their two test files are removed; the write-tool
  smoke test was updated.
- **N.2** — three read-only tools replace them: `pre_deploy_check`,
  `show_release`, `show_review` (`tools/tm1mcp/tools/deploy.js:18`, `:45`, `:66`).
  `close_change_set` now runs the IDE's close checks and finalize. The generated
  tool table and counts are updated (64 tools: 37 read, 27 write;
  `docs/ide/MCP_SERVER.md`, `CLAUDE.md:118`).

## Tests added

- `tests/deploy-git-release-live.test.js` (8): Live + records across an existing
  dimension, target removals, before-value mismatch, the written-file check, the
  index rule (Live carry + unowned link removal), values both-side/one-side,
  alias clash, chore split.
- `tests/process-capture.test.js` (3): a TI run's 2 elements and value changes
  with before/after; edge weight/removal; DEV/no-change-set rule.
- `tests/close-check.test.js` (3): attribute type stop; values with owner;
  deleted dimension/attribute a process writes.
- `tests/sync-dev-plan.test.js` (2): default take PROD's across every object kind;
  untick skips.

## Not done, and why

- **Process-created subsets, views, processes and cubes (F.2) — done in Fix 5.**
  The capture now reads every model name list before and after a DEV run, so a
  subset/view/process/cube created (or deleted) with a run-time name is recorded.
  Content changes on existing objects are compared through the MDX/members of
  subsets and the definition of views the process names; see "Fix 5 — done".
- **The debug route is not gated or captured.** `/api/process/debug`
  (`routes/processes.js:87`) executes a modified process and stays read-only, but
  the run rule is enforced on `/api/process/run` and the MCP `run_process` only.
- **Whole-dimension IDE changes — done in Fix 2.** A bulk import and the MCP
  `build_dimension` diff before/after and record each element/edge/hierarchy; a
  remaining whole record only rides over a target that did not change (otherwise
  Build Release stops and names the dimension).
- **Alternate-hierarchy records — done in Fix 1.** Element/edge records now carry
  their hierarchy name (IDE routes, TI capture, MCP build tools) and Build Release
  applies each record to its own hierarchy file; created/deleted hierarchies carry
  or remove their file and link. See "Fix 1 — done" below. Attribute values remain
  shared per element (the v11 lab check).
- **Sync clash display (E.3) — done in Fix 4.** `planRefresh` carries both values
  and the owning change set; the sync preview shows them and the developer is told
  through a note on their change set.
- **After-clone chore warning (E.6) — done in Fix 9.** On connect to DEV the IDE
  warns about every chore still switched on (`core/connect-check.js`).
- **Carry-back change set (D.4.1–D.4.4) — done in Fix 7.** The pre-deploy screen
  offers it, `core/carry-back.js` copies PROD's rule/process text onto DEV in a
  closed `carry-back` set, stops on an open/undeployed owner, and Build Release
  treats a PROD build of it as already on PROD (TEST deploys normally).
- Previously deferred and still so: backup measurement and v12 backup (I.3),
  M.2, J.5, L.1/L.2 cycle.

## Questions for James

1. **Whole-dimension changes (G.3).** Refresh/import writes one
   `DIMENSION_UPDATED` row with no per-element state. Should I convert the refresh
   decisions (`REFRESH_DECISION` + the applied changes) into element records so
   those releases can also start from Live, or keep DEV's whole file for them?
2. **Same-object rule (G.6).** The existing order tests expect "older set first is
   allowed". I stop a same-object build either way round only when a live branch
   exists, so those tests stay green. Should the rule also apply to targets with no
   live branch (and the old tests be changed)?
3. **Sync clash detail (E.3).** The plan currently exposes the conflict but not
   the other developer's value/change set. Do you want the sync preview to show
   both values and the owning change set (which needs new fields in
   `planRefresh`)?
4. **Process-created objects (F.2).** A TI that creates a subset/view/process/cube
   with a run-time name cannot be discovered by reading its text. Do you want the
   capture to diff the whole object lists before/after a DEV run (slow on a large
   model, but complete), or keep the current dimension/attribute capture?

## Every place `deployed_target` is still read (updated audit)

Decisions use the per-target tables; these are display/compatibility reads:

- `core/git-release.js:291`, `:295` — `deployedTo` fallback for callers with no target.
- `core/change-log.js:200`, `:202`, `:247`, `:297` — writes/clears of the compat column; `:542` selected for ordering.
- `routes/changesets.js:94`, `:96`, `:138`, `:140` — fallback when no deploy row exists; `:196` the legacy `deployed` boolean.
- `client/src/lib/deploy/change-sets.js:25`, `:56` — the old ready list / `deployedTo` fallback.
- `client/src/components/ChangeLogPanel.jsx:161`, `:242` — the row's "deployed to" text and report link.

## Fix 1 — alternate hierarchies (James, 26 Nov: fix first)

Found in review (`core/git-release.js:919`): element/edge records carry no hierarchy name, so for an
alternate hierarchy Build Release takes Live's file unchanged. A change set's moves in an alternate
hierarchy are silently left out, and a new alternate hierarchy may never reach the target (the
dimension file comes from Live, so its hierarchy index doesn't list it). Fix:

1. Every element/edge/weight/type record carries its hierarchy name: IDE routes
   (`routes/dimensions.js`), TI capture (`core/process-capture.js` — snapshot every hierarchy of each
   captured dimension, not only the default), the sync, and the MCP build tools.
2. Build Release applies each record to its own hierarchy file (Live's file + that hierarchy's
   records), with the same before-value rule and written-file check.
3. A hierarchy the change set **created** (recorded): carry DEV After Close's hierarchy file and add
   it to the dimension file's `Hierarchies@Code.links` taken from Live. One it **deleted**
   (recorded): remove the file and its link. Hierarchies the target added itself stay (Live's index).
4. Safety: a record for a non-default hierarchy without a hierarchy name (older rows) → Build Release
   stops and names the dimension. Never take Live's file silently when this change set has records
   for that hierarchy.
5. Tests: move in an alternate hierarchy deployed; new alternate hierarchy created and listed;
   deleted hierarchy removed; target-added hierarchy kept; old row without hierarchy → stop.

### Fix 1 — done (26 Nov)

- **Records carry their hierarchy.** `core/recorded-changes.js:44` adds `hierarchies` to a
  dimension record; `:52` `hierarchyInfo()` reads `HIERARCHY_CREATED`/`HIERARCHY_DELETED`
  (structured state first, then `detail`), and `:78` tags every element/edge/weight/type op
  with `hierarchy` from its before/after state. A bulk summary row ("3 elements …") is no
  longer mistaken for an element (`:87`). Creation/deletion no longer marks the whole
  dimension — only an unreadable HIERARCHY row falls back to that (`:181`).
- **IDE routes write the hierarchy.** `routes/dimensions.js:291`, `:313`, `:328`, `:341`,
  `:357-358`, `:387` put `hierarchy` in every element/edge/weight/rename record; the add-edge
  route now records at all (`:341`). Hierarchy create/delete/from-attribute log structured
  dimension+hierarchy (`:419`, `:445`, `:457`).
- **The sync’s hierarchy rows are attributable too.** `core/refresh-hierarchy.js:183` and `:266`
  put dimension+hierarchy in the before/after state (sync sets are never deployed, but the
  rows now read correctly).
- **TI capture snapshots every hierarchy.** `core/process-capture.js:71` reads each hierarchy
  of the captured dimension (skipping `Leaves`) instead of only the default; `:182-185`
  records a hierarchy the run created/deleted; `:188-224` diffs elements and edges per
  hierarchy and writes `hierarchy` into every before/after state.
- **MCP build tools.** `tools/tm1mcp/tools/build.js:106` records an updated dimension as a
  whole change instead of a fake element; `:155` adds per-element records with hierarchy and
  per-edge records; restructure records now carry `hierarchy`; `:208` and `:686` record
  hierarchy creation/deletion structurally; `delete_object` accepts `hierarchy` (`:662`).
- **Build Release applies each record to its own hierarchy file.** `core/git-release.js:734`
  ensures a recorded new/deleted hierarchy and its dimension index are in the release;
  `:760` maps every hierarchy file the release carries; `:968` rebuilds the dimension's
  `Hierarchies@Code.links` from Live, adding a carried hierarchy and removing a deleted one,
  keeping hierarchies the target added itself; `:1020` carries DEV’s file for a created
  hierarchy; `:1036-1060` applies only that hierarchy’s records to Live’s file with the existing
  before-value rule, and `:1072` runs `checkWrittenHierarchy`. A pre-fix record with no hierarchy name
  stops the build when that alternate hierarchy changed on DEV (`:1047`).
- **Link closure:** `core/git-release.js:1155` stages the files the writer placed in the tree
  before reading `git ls-files`; without it a hierarchy carried from Live as a dependency was
  "missing" on every pass (an infinite loop, found by the target-added test).
- **Tests:** `tests/deploy-git-release-hierarchies.test.js` (5) — alternate-hierarchy move
  applied; new hierarchy carried and linked; deleted hierarchy file+link removed; target-added
  hierarchy kept in Live’s index; old row with no hierarchy stops. `tests/process-capture.test.js`
  now also asserts a per-hierarchy move and its record (1 added there; existing edge assertion
  updated for the new `hierarchy` field).
- **Test run:** `npm test` — 929 tests, 928 pass, 1 skipped, 0 fail. No client file changed,
  so no `cd client && npm run build` was needed. Nothing committed, nothing pushed, server not
  restarted.

## Fix 2 — whole-dimension changes (James, 26 Nov)

Build question 1 answered. A bulk import (`routes/dimensions.js` import) or an MCP tool that updates a
whole dimension records only "dimension changed", so Build Release carries DEV's whole file — which
lacks the target's own elements, and the loss check then stops every deploy.

1. **Record a bulk import per element:** the import knows every element, type, parent and weight it
   writes — record each one with before/after and hierarchy, the same as an IDE edit. Same for the
   MCP whole-dimension update (`tools/tm1mcp/tools/build.js:106`) — diff before/after and record per
   element, as the TI capture does.
2. **When only "dimension changed" is known** (any remaining `whole` record) **and Live differs from
   Last Deployed for that dimension:** Build Release stops and names the dimension ("the target
   changed Employee and this change set only recorded 'Employee changed' — redo the change so it is
   recorded per element"). If the target did not change it, carrying DEV's file stays allowed.
3. The refresh is out of scope: sync change sets are never deployed.
4. Tests: import of 3 elements → 3 records → applied to Live; whole record + target changed → stop;
   whole record + target unchanged → DEV's file carried.

- **Bulk import records per element.** `routes/dimensions.js:30-56` snapshots the dimension before
  the import and diffs it afterwards (`recordDimensionDiff`, attributes off), so each element,
  edge and hierarchy change is logged with before/after and `hierarchy` instead of one
  `DIMENSION_UPDATED` row. Only when the dimension cannot be read back does `:63` keep the whole
  record as a fallback.
- **MCP `build_dimension` records per element.** `tools/tm1mcp/tools/build.js:53` snapshots before
  the writes; `:113-127` diffs before/after and records each element/edge/hierarchy through the
  tool's own `logChange` (attributes stay with their existing `logAttributeValue` /
  `ATTRIBUTE_CREATED` records, so nothing is doubled). `:132` keeps a whole record only when the
  snapshot failed.
- **The shared diff can log through the caller.** `core/process-capture.js:162` takes a `writeLog`
  hook and `attributes: false` (used by the two callers above); TI capture keeps the default, so
  its records are unchanged (`:234`).
- **A whole record only rides over an unchanged target.** `core/git-release.js:112`
  (`dimensionChangedOnTarget`) compares the target's live commit against its last deployed commit
  for that dimension's index and every hierarchy file; `:968-985` stops the build and names the
  dimension when it differs ("the target changed D and this change set only recorded 'D changed' —
  redo the change so it is recorded per element"), otherwise it still carries DEV's file and says
  so in the notes.
- **Tests:** `tests/deploy-git-release-whole-dimension.test.js` (3) — bulk import of 3 elements →
  3 `ELEMENT_ADDED` records → applied to Live; whole record + target changed → stop; whole record
  + target unchanged → DEV's file carried. `tests/mcp-build-dimension-records.test.js` (1) —
  `build_dimension` on an existing dimension logs each element/edge and no whole row.
- **Test run:** `npm test` — 933 tests, 932 pass, 1 skipped, 0 fail. No client file changed, so no
  `cd client && npm run build` was needed. Nothing committed, nothing pushed, server not restarted.


## Fix 3 — same-object rule everywhere (James, 26 Nov) — do after Fix 2

Build question 2 answered: if two change sets changed the same rule, process, view, subset or cube,
Build Release **always stops**, either way round, on every target — with or without a `live-`
branch. James: "that's an issue with developers overlapping". Update the old order tests that
expected "older set first is allowed" for these objects.

## Fix 4 — sync clash detail (James, 26 Nov) — do after Fix 3

Build question 3 answered: the sync preview shows, for each clash, PROD's value, the developer's
value on DEV and the developer's change set (name, owner) — new fields in `planRefresh` as needed.
When PROD's value replaces a developer's change, that developer is told: a note on their change set
(item, PROD's value, their old value, the sync change set), shown in the change set list and in the
IDE's notifications if there is one. Tests: clash shows both values and the owner; note written.

## Fix 5 — objects a TI run creates with a run-time name (James, 26 Nov) — do after Fix 4

Build question 4 answered: around every TI run on DEV, also read the **name lists** of every
subset (per hierarchy), view (per cube), process, cube, chore and dimension, before and after.
Anything created or deleted during the run is recorded in the run's change set (for a subset/view
also its content after the run). A name list can't show that an **existing** subset or view
changed content, so also compare the MDX/members of every subset, and the definition of every view,
on the dimensions and cubes the process names; any change is recorded. Time it on the lab's DEV and put the time in the DONE file. Tests: a run that
creates `'Top ' | pRegion` → subset recorded; one that deletes a view → delete recorded.

### Fix 3 — done (26 Nov)

- **Every whole object stops either way round, on every target.** `core/git-release.js:237`
  adds `SHARED_OBJECT_STRICT` (rule, process, view, subset, cube); `:238` `sharedObjectOrdering`
  puts any other change set that changed one of those and is not deployed into `shared`,
  regardless of which change is older or newer. A deployed newer change is still refused
  (`newer`), and a retired / `noChange` / already-deployed older set still does not block.
  Dimensions and chores keep the ordering rule (their records/fields are applied individually).
  `:1337` each ordering row now carries its object `type`; the old `liveRef`-only block is gone
  (`:1291`), so the rule is the same with or without a `live-` branch.
- **Refusal payload.** `core/git-release.js:1356` now returns `ordering.shared` as well as
  `older`/`newer`.
- **Old order tests updated.** `tests/deploy-order-shared.test.js` (14) keeps the dimension/
  chore ordering cases and adds four strict-object cases: a NEWER undeployed set on a subset
  now stops (the old "older set first" allowance), an OLDER one stops, every strict kind
  (rules/cube/process/view/subset) stops, and an already-deployed older set still does not.
  The two rebuild tests in `tests/deploy-git-release-flow.test.js:172` and `:213` now start the
  second change set only after retiring the first, because the same cube in two open sets is
  exactly what the new rule refuses.
- **Test run:** `npm test` — 940 tests, 939 pass, 1 skipped, 0 fail. Test-file totals in this
  fix: `deploy-order-shared` 14 (was 10), `deploy-git-release-flow` unchanged at 7. A client
  file changed in Fix 4, so `cd client && npm run build` was run once after all three fixes.

### Fix 4 — done (26 Nov)

- **The plan carries the clash detail.** `core/refresh-dev.js:107` `clashOwner` finds the
  developer's change set through the change log; `:112` `addClash` builds one row per clash
  with `item`, `kind`, `prodValue`, `devValue` and `changeSet { id, name, user }`. `:148`
  collects them, `:202-218` adds dimension element-type and move conflicts, `:287-307` adds
  conflicting subsets, views and hierarchies, and `:315-318` returns `plan.clashes` (the same
  row is also attached to its plan item as `.clash`).
- **The owner lookup.** `core/change-log.js:563` `getObjectOwner` returns the latest session
  that logged a change to an object (exact detail for a subset/view; `anyDetail` for a
  dimension), skipping `sync` sets. Exported at `:703`.
- **Both values are available from the planners.** `core/refresh-covers.js:224` and `:266`
  put `prodValue`/`devValue` on subset and view conflicts; `core/refresh-hierarchy.js:149`
  does the same for a hierarchy. `core/refresh-covers.js` also exports `canonSubset`/`canonView`
  so the capture can use the same comparison.
- **The developer is told.** `core/sync-dev.js:66` `clashNote` writes item, PROD's value, the
  developer's old value and the sync set; `:70` `notifyClashOwners` appends it to their change
  set's note (once — a retry does not duplicate it). `:218` runs it after the writes succeed,
  only for clashes the admin did not untick; `out.developerNotes` reports who was told.
- **The UI shows it.** `client/src/components/DeploySync.jsx:86-96` adds the "Clashes" panel
  (item, PROD value, DEV value, change set name and owner) and `:121` lists the developers
  told. There is no separate IDE notification store; the note is on the change set, which the
  change set list shows as its description (`client/src/components/ChangeLogPanel.jsx:199`).
- **Tests:** `tests/sync-clash-detail.test.js` (2) — a subset clash through `planRefresh` shows
  both values and the owner (`Jo UI work`, `jo`); the note names the item, both values and the
  sync set, and is not written twice.
- **Test run:** `npm test` — 940 tests, 939 pass, 1 skipped, 0 fail.

### Fix 5 — done (26 Nov)

- **Name lists before and after every DEV run.** `core/process-capture.js:121` `snapshotNames`
  reads every model dimension, cube, process and chore, every subset per hierarchy and every
  view per cube. `:177` `diffNames` turns the two lists into created/deleted entries.
- **Content of the named objects.** `core/process-capture.js:153` `snapshotContent` reads the
  MDX/members of every subset and the definition of every view on the dimensions and cubes the
  process names; `:203` `diffContent` reports an existing one whose content changed. The named
  scope comes from `writeTargets` (`:283`), which now also takes the subset and view calls
  (`core/process-scan.js:101-108`, returned at `:278-279` as `subsetOps`/`viewOps`).
- **Recorded in the run's change set.** `core/process-capture.js:241` `recordObjectDiff` writes
  `DIMENSION/CUBE/PROCESS/CHORE_CREATED|DELETED`, `SUBSET_SAVED|DELETED` (detail = dimension)
  and `VIEW_SAVED|DELETED` (detail = cube); a created subset/view carries its content after the
  run (`:221` reads the content directly when the dimension/cube was not in the named scope).
  `:305` `beginCapture` snapshots before and after and calls it from `complete()`; `:370`
  records how many object changes were found.
- **Timing.** Every capture now returns `timing` (`namesMs`, `contentMs`, `afterNamesMs`,
  `afterContentMs`, `objectChanges`), measured around the extra reads. **Measured on the lab's
  DEV: not done from this environment** — the job had no authenticated lab session, and the
  running server refuses unauthenticated requests. Question: should I run it through the
  browser session (which needs you to sign in and lends the tab), or will the next lab run
  record the four `timing.*` values? I did not invent a number.
- **Tests:** `tests/process-capture-objects.test.js` (1) — a run that creates
  `'Top ' | pRegion` (here `Top North`) records `SUBSET_SAVED` with its content, and a run that
  deletes a view records `VIEW_DELETED`; `tests/process-scan.test.js` expected shape updated for
  `subsetOps`/`viewOps`.
- **Test run:** `npm test` — 940 tests, 939 pass, 1 skipped, 0 fail. `cd client && npm run build`
  was run (one client file changed, in Fix 4), so `static/` is current. Nothing committed,
  nothing pushed, server not restarted.

## Fixes 6–9 — remaining build (James, 26 Nov) — in this order

### Fix 6 — the TEST cycle, derived (Part L.1/L.2, L.4)
No admin list. (1) A re-clone of TEST (`recloneTest`) starts a new cycle. (2) Every change set
deployed to TEST after that re-clone is in the cycle. (3) Once any of them is deployed to PROD,
the cycle takes no new change sets: Deploy to TEST of a change set not already in it is refused,
naming the re-clone needed, until TEST is re-cloned again. (4) Retire is allowed for a change set
that reached TEST but never PROD (L.4). Show the open cycle and its change sets on the Deploy tab.
Tests for each rule.

### Fix 7 — carry-back change set (Part D.4, D.5)
Build D.4.1–D.4.5 as written in the brief: "Bring PROD's version onto DEV" from the pre-deploy
check; copy the rule/process text from Live onto DEV through REST in a `carry-back` change set;
clash with an open/undeployed change set on the same object → stop and name it; close it (Part F
close); mark it already on PROD (never deployed to PROD; deployable to TEST); Build Release takes
Live's version where DEV After Close matches Live. And D.5: the pre-deploy check stops when DEV
deleted something a PROD process uses, if not caught at close. Tests.

### Fix 8 — after the deploy (Part Q)
Q.1 reprocess feeders on PROD for every cube whose rules the release changed (TI process with
`CubeProcessFeeders`, in `ti-processes/`, p/v/n/s/c naming; time per cube in the report; failure →
`incomplete`). Q.2 run DEV's tests on PROD read-only after the deploy; failure → "needs checking".
Q.3 developer sign-off ("tested on PROD", name and time) and a short plain summary to send users;
"awaiting sign-off" until confirmed. Q.4 security is never written. Tests.

### Fix 9 — screens and warnings
(1) `GitSetup.jsx`: the TEST/PROD step uses `/api/git/setup/start` (the server writes its own
copy); remove the first-pull offer for TEST/PROD. (2) The pre-deploy check screen in DeployFlow:
the list from `/api/deploy/pre-check` with the stop / kept / carry-back / sync lines and the
"Bring PROD's version onto DEV" and "Sync DEV from PROD" buttons; Continue only once it has run.
(3) K.2: on connect, warn when DEV no longer matches its last write into `dev` while a change set
is open. (4) E.6: on connect to DEV, warn about any chore that is on. Rebuild the client.

Run the whole test suite after each fix. Record per fix: file:line, test count, not done and why.
Do not commit, never push to GitHub, never restart the server. Stop and ask if unclear.

### Fix 10 — every step has a screen (James, 26 Nov) — do after Fix 9

Built routes with no screen yet. Add a UI for each, in the Deploy tab (admin only, plain wording,
each says what it will do and asks to confirm):
1. **Re-clone TEST** — "TEST was re-cloned from PROD" (`POST /api/deploy/reclone-test`): shows which
   TEST deploys will be superseded first.
2. **Start again with a new repo** (`POST /api/deploy/start-again`): shows the refusal reasons
   (closed, undeployed change sets) or what will be cleared.
3. **Prepare DEV for restore** (`POST /api/deploy/prepare-dev-restore`): shows open change sets that
   block it; when clear, shows the steps (keep DEV's `}git.ctx`, restore, reconnect).
4. **Developer sign-off** after a deploy (Fix 8 / Part Q.3): "Tested on PROD" button on the deploy
   report and the change set, with name and time; the "awaiting sign-off" status; the plain summary
   to send users, with a Copy button.
Check no other built route lacks a screen; list any in the DONE file. Rebuild the client.

### Fix 6 — done (26 Nov)

- **The cycle is derived, never listed.** `core/change-log.js:75` adds a `test_cycles` table holding only re-clone events; `:278` `recordTestReclone` writes one, `:285` `latestTestReclone` reads the newest. `core/test-cycle.js:26` `deriveCycle` starts at the latest re-clone (or the first TEST deploy when no re-clone has ever been recorded), takes every `complete`/`incomplete` TEST deploy after it as the cycle, and closes it at the first member deployed to any other target (`:44-60`).
- **Rule 1.** `core/deploy-admin.js:50` lets `recloneTest` inject `recordTestReclone`; `:66` writes the marker only after TEST has written its own objects and the deploy note is recorded, so a failed re-clone does not restart the cycle.
- **Rules 2 and 3.** `core/test-cycle.js:70` `canDeployToTest`: a member is always allowed (a TEST retry); a new set joins an open cycle; a closed cycle refuses it and names the set that reached PROD plus the re-clone needed. Enforced server-side in `core/git-deploy.js:375-388` (label read from TM1 Git; an unreadable label never invents a refusal).
- **Rule 4.** `core/test-cycle.js:97` `reachedTestOnly` reads each deploy target's Git label; `routes/changesets.js:140-151` allows retire only when the set reached TEST and never PROD, keeping the old refusal once PROD is in the list.
- **Screens.** `routes/deploy.js:683` `GET /api/deploy/test-cycle` returns the cycle and the server's label. `client/src/components/DeployRelease.jsx:26-37` reads it for the selected target and `:67-82` shows the open/closed cycle and its change sets on the Deploy tab.
- **Tests:** `tests/test-cycle.test.js` (4) — re-clone starts a cycle and a later deploy is a member; an outside set is refused after a member reaches PROD (already-in-cycle still allowed); a new re-clone reopens it; retire allowed for TEST-only, refused through PROD. `tests/deploy-admin.test.js` still passes with the marker write.
- **Not done:** nothing in L.1/L.2/L.4 was left out. A project that has never recorded a re-clone is treated as being in its first implicit cycle, so no migration step is needed.
- **Test run:** `npm test` after the four fixes — 956 tests, 955 pass, 1 skipped, 0 fail. (Per-fix file run: 4/4.)

### Fix 7 — done (26 Nov)

- **Carry-back change set.** `core/carry-back.js:87` `bringToDev` reads the rule/process text from the target, writes it on DEV through TM1 REST (`:46` `readObject`, `:70` `writeObject`), records each write with before/after (`RULES_SAVED` / `PROCESS_SAVED`), runs DEV's block tests then closes the set through the existing close service and finalizes DEV After Close (`:155-185`), and describes it as "Already on PROD … never deployed to PROD; deployable to TEST" (`:157`). The route is `routes/deploy.js:130`.
- **Clash stop.** `core/carry-back.js:28` `clashingSets` names every open or undeployed change set that already changed the same rule/process; `:98-107` returns a refusal before creating a set or writing anything.
- **Already on PROD / deployable to TEST.** `routes/deploy.js:399-409` makes a Build Release for PROD of a `carry-back` set a no-op ("already on PROD"), while a TEST build still goes through normally. `client/src/lib/deploy/change-sets.js:62-76` includes carry-back sets in the ready list for TEST and keeps them out of PROD.
- **D.5.** `core/pre-deploy.js:169-197` accepts the change set on the pre-deploy check, turns its recorded deletes into the same deleted-dimension/cube/attribute shape the close check uses, runs `scanDeletedUsage` against the TARGET's processes, and adds a `deleted-usage` stop naming the PROD process. A scan that cannot run is reported (`deletedUsageError`), never read as "nothing found".
- **Screens.** `client/src/components/DeployFlow.jsx:145-187` runs `/api/deploy/pre-check` as part of the first step, offers "Bring PROD's version onto DEV" for a carry-back, and "Sync DEV from PROD" for the sync items.
- **Tests:** `tests/carry-back.test.js` (5) — PROD rule copied into a closed carry-back set with before/after; a developer's open set stops it and is named; process text copied section by section; a failing block test leaves the set open; D.5 stop from a PROD process. `tests/deploy-records-per-target.test.js` updated for carry-back on TEST.
- **Not done:** nothing in D.4/D.5 was left out. The "tell the developer" note is the Fix 4 change-set note; the carry-back owner lookup is the same clash list.
- **Test run:** `npm test` after the four fixes — 956 tests, 955 pass, 1 skipped, 0 fail.

### Fix 8 — done (26 Nov)

- **Q.1 — feeders.** `ti-processes/reprocess-feeders/process.json` adds `}IDE.ReprocessFeeders` (parameter `pCube`, `CubeProcessFeeders`, p/v/n/s/c naming, failure on an empty name). `core/after-deploy.js:19` `cubesWithChangedRules` selects only cubes whose `.rules` file the release changed (deleted rules excluded); `:31` `reprocessFeeders` installs the process on demand, runs it once per cube and times each run. `core/git-deploy.js:706-712` runs it after the pull and before verify; a failure is added to `out.incomplete` and names the cube.
- **Q.2 — DEV's tests on the target.** `core/after-deploy.js:64` `runDevTestsOnTarget` runs the full assertion set with `targetServer`. `core/git-deploy.js:831-843` runs it after the deploy, records `devTests`, and on a failure sets `needsChecking` + the failing test names. `routes/deploy.js` marks that deploy `incomplete` with the reason "Needs checking: DEV's tests on … failed — <tests>".
- **Q.3 — sign-off and the user summary.** `core/deploy-records.js:143-149` records `feeders`, `devTests`, `needsChecking`, `needsCheckingTests` and `signoff` (null at first). `:158-172` `userSummary` writes the short plain text for users; `:175-193` `updateSignoff` (route `routes/deploy.js:189`) fills in "tested on PROD" name/time and shows "awaiting sign-off" until then. `client/src/components/DeployReport.jsx:309-340` shows the after-deploy block and the sign-off button; `client/src/components/DeployFlow.jsx:970-978` shows the outcome.
- **Q.4 — security.** Nothing here writes element/cube security or groups, and the pre-deploy check has no security branch; no code change was needed beyond not adding one.
- **Tests:** `tests/after-deploy.test.js` (4) — rules-only cube selection; per-cube timing and a named failure; DEV tests against the target with a named failure; record awaiting sign-off → confirmed, and the user summary both ways.
- **Not done:** nothing in Q.1–Q.3 was left out; Q.4 needed no code (security is never written).
- **Test run:** `npm test` after the four fixes — 956 tests, 955 pass, 1 skipped, 0 fail.

### Fix 9 — done (26 Nov)

- **(1) Setup uses the server's own copy.** `client/src/components/GitSetup.jsx:85` `doSetupStart` calls `/api/git/setup/start`; `:196-205` the TEST/PROD step writes "TEST/PROD writes its own copy" and starts it. The first-pull offer, its analysis hook/state and `doFirstPull` were removed (`:121` help text and `:165` label text updated). DEV keeps its first commit at `:207-211`.
- **(2) Pre-deploy screen.** `client/src/components/DeployFlow.jsx:145-164` runs `/api/deploy/pre-check` after the idle check; `:426-459` shows the stop / kept / carry-back / sync lines and the two buttons (`doCarryBack` `:166`, `openSync` `:180`). `Continue` is disabled until the check has run and has no stops (`:463`). `openSync` sets the new store `deployView` (`client/src/store/index.js:523-524`) and `client/src/components/DeployTab.jsx:29-37` lands on the Sync view.
- **(3) K.2 on connect.** `core/connect-check.js:59-79` compares DEV's local commit with the last closed set's `dev` commit while any set is open and warns, naming the set. Route `routes/deploy.js:672`; shown by `client/src/App.jsx:159-172` as a toast on connect.
- **(4) E.6 on connect.** `core/connect-check.js:41-57` lists every active chore on DEV and warns. Same route/toast.
- **Client rebuilt:** `cd client && npm run build` ran after these UI changes and wrote `static/` (do not copy from `client/dist`).
- **Tests:** `tests/connect-check.test.js` (3) — active chores named; open set + moved DEV warns and names it; no DEV-only warnings on a PROD-labelled server. Route table fixture updated for the four new routes.
- **Not done:** nothing in the four screen/warning items was left out.
- **Test run:** `npm test` after the four fixes — 956 tests, 955 pass, 1 skipped, 0 fail. Nothing committed, nothing pushed, server not restarted.

### Fix 10 — done (26 Nov)

- **One admin screen for all three resets.** `client/src/components/DeployAdmin.jsx:273` composes the three cards; `client/src/components/DeployTab.jsx:26` adds the `Admin` nav item and `:45` hides it from anyone who is not a server admin (`:96` also gates the view). Each card states what it does, shows what it will affect, and needs a second click before it sends anything.
- **1. Re-clone TEST.** `client/src/components/DeployAdmin.jsx:46` `RecloneTest` calls `POST /api/deploy/reclone-test` (`:74`) and, before confirming, reads `GET /api/deploy/test-cycle` (`:63`) to name the TEST deploys in the cycle that will be superseded (`:104-106`). The result names the new commit and how many deploys were superseded (`:132-136`).
- **2. Start again with a new repo.** `client/src/components/DeployAdmin.jsx:143` `StartAgain` calls `POST /api/deploy/start-again` (`:154`); a refusal shows the server's reason and the closed/undeployed change sets that block it (`:196-198`), and a success shows what was cleared (`:201`).
- **3. Prepare DEV for restore.** `client/src/components/DeployAdmin.jsx:205` `PrepareDevRestore` calls `POST /api/deploy/prepare-dev-restore` (`:215`); when open sets block it they are named (`:256`), and when clear it shows the three steps — keep DEV's own `}git.ctx`, restore/re-clone outside the IDE, reconnect (`:262-264`).
- **4. Sign-off (the Fix 8 half was already there).** `client/src/components/DeployReport.jsx:338-347` already showed "Signed off" / "Awaiting sign-off", the name/time, and the "I tested this on <target>" button (`:149` `signOff`); nothing was duplicated. What was missing: the change set row now reads its deploy record (`client/src/components/ChangeLogPanel.jsx:156-170`), shows `awaiting sign-off` / `signed off by` in the status line (`:207`), offers "I tested this on <target>" in the row menu (`:294-299`), and shows the same status and button in the expanded set (`:389-403`). The plain user summary is shown with its own Copy button on the report (`client/src/components/DeployReport.jsx:175`, `:352-356`) and on the change set (`client/src/components/ChangeLogPanel.jsx:188`, `:405-414`).
- **Other built routes with no screen (found, not built — outside Fix 10's four):** `GET /api/deploy/settings/suggest` (`routes/deploy.js:272`, suggestion only); `POST /api/deploy/git/reconcile-deletes` (`routes/deploy.js:291`, recovery for a deploy whose reconcile left an object behind); `GET /api/deploy/git/approval` (`routes/deploy.js:529`, the report already shows the approval via `/api/deploy/record`); `GET /api/deploy/records` (`routes/deploy.js:820`, History/archives covers the screen need); `GET /api/git/lock` and `POST /api/git/lock/clear` (`routes/deploy.js:545`, `:554`, the lock is acquired/released inside a deploy); `GET /api/git/setup/label` (`routes/deploy.js:721`, read server-side by the TEST cycle).
- **Client rebuilt:** `cd client && npm run build` ran after these changes and wrote `static/` (do not copy from `client/dist`).
- **Tests:** `npm test` — 956 tests, 955 pass, 1 skipped, 0 fail. No new server route was added, so the route-table fixture is unchanged.
- **Not done:** the seven routes listed above still have no screen; nothing else in Fix 10 was left out. Nothing committed, nothing pushed, server not restarted.

### Fix 11 — retire an open change set (James, 26 Nov)

Valid case: work that is abandoned while its change set is still open. Today Retire only shows for
a closed set (`client/src/components/ChangeLogPanel.jsx` ⋯ menu) and the route refuses an open one
(`routes/changesets.js` retire), and the only close is the deploy flow's "Tests & close" step.

1. **Retire on an open change set** (= the Discard agreed in Part F.5): one action in the ⋯ menu,
   "Retire — never ship this". It marks the set closed and retired in the IDE's records **without**
   running tests and **without** TM1 Git writing DEV into `dev` (nothing from it will ever be
   deployed). The confirm says plainly: "The edits stay on DEV. Undo them on DEV if you don't want
   them there."
2. **Close** in the ⋯ menu for an open set: runs the same close as "Tests & close" (tests, the
   attribute-value ownership list, TM1 Git writes DEV into `dev`), for closing without starting a
   deploy.
3. Unretire stays as today. Tests: retire an open set → closed + retired, no `dev` write; Close from
   the menu → same result as Tests & close.

- **Retire an open set.** `routes/changesets.js:137-149` — when the set is still open the route now
  calls `closeChangeSet` with `tests: null` (`routes/changesets.js:142-143`) and then
  `markWontDeploy` with a default reason (`routes/changesets.js:144-149`), returning the closed +
  retired row. It never touches `core/assertions`, `preCloseCheck` or `finalizeDevClose`, so no tests
  run and TM1 Git never writes DEV into `dev`. The closed-set retire path is unchanged.
- **Retire / Close in the ⋯ menu.** `client/src/components/ChangeLogPanel.jsx:346-359` adds two
  actions for an open set — "Close — run tests" (`:351`) and "Retire — never ship this" (`:357`) —
  beside the existing closed-set Retire/Unretire (`:361-369`). The Close action
  (`client/src/components/ChangeLogPanel.jsx:134-152` `closeSet`) posts the same
  `/api/sessions/close` its "Tests & close" step uses. Neither sends anything until the confirm bar
  (`:393-428`) is accepted; the Retire confirm reads "The edits stay on DEV. Undo them on DEV if you
  don't want them there." (`:397-399`).
- **Tests:** `tests/change-set-retire-open.test.js:67-80` proves retire-open closes + retires with no
  tests, no close checks and no `dev` write; `:82-93` proves Close-from-menu runs the tests, close
  checks and `finalizeDevClose` exactly as "Tests & close". `npm test` — 958 tests, 957 pass,
  1 skipped, 0 fail (2 new). No route was added, so the route-table fixture is unchanged.
- **Client rebuilt:** `cd client && npm run build` ran after these changes and wrote `static/`.
  Nothing committed, nothing pushed, server not restarted.

### Fix 12 — DEV setup writes its attributes (James, 26 Nov)

`client/src/components/GitSetup.jsx:209` — DEV's box 5 button ("Commit this server to the repo")
calls `/api/git/setup/first-push`, which only has TM1 Git write DEV into `dev`; it never writes
`attrs-<DEV>`. Without it the first close has no attribute baseline. Point DEV's button at
`/api/git/setup/start` (`setupServer`, which writes `dev` + `attrs-<DEV>`), label it "Start DEV",
and for an already-linked server whose `attrs-<server>` branch is missing show a "Write attributes"
button using `attrsOnly: true` (`startAttrs`). Test; rebuild the client.

- **DEV's box 5 is now Start DEV, not first-push.** `client/src/components/GitSetup.jsx:217-225` calls `doSetupStart` (`:81`), which posts `/api/git/setup/start` (`setupServer`) — TM1 writes DEV into `dev` and the IDE writes `attrs-<DEV>` in the same step. The old `first-push` handler was removed from the component (`/api/git/setup/first-push` still exists as a route, unused here). The helper text at `:124` says the same.
- **Write attributes for an already-linked server.** `/api/git/setup/status` now returns `branches` and `attrsBranch` (`routes/deploy.js:572-574`). When the server is linked, the branch list is known and `attrs-<server>` is absent, `client/src/components/GitSetup.jsx:140-145` shows an amber "Write attributes" card; its `doStartAttrs` (`:88-91`) posts `/api/git/setup/start` with `attrsOnly: true`, i.e. `startAttrs`, and reports the commit (or that attributes were already on the branch). Nothing is pushed onto the server and the deploy baseline is untouched.
- **Tests:** `tests/git-secrets.test.js:73-81` checks the status route reports the remote branches and `attrs-<server>`; `tests/git-setup-start.test.js:88-95` checks `startAttrs` writes only the attributes branch — no `GitPush`, no deploy record. `npm test` — 960 tests, 959 pass, 1 skipped, 0 fail (2 new).
- **Client rebuilt:** `cd client && npm run build` ran after these changes and wrote `static/`. `eslint . --quiet` still reports only the 3 pre-existing `core/carry-back.js:162,181,182` no-useless-assignment errors. Nothing committed, nothing pushed, server not restarted.
