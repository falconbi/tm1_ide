# 07 — Deploy round 2: the model says what it owns, and first pull is checked

Build brief for OpenCode. It finishes the two "not done" items in `07_DEPLOY_FIXES_DONE.md`.
Work on branch `deploy-round2`, which starts from `main` (`427cd10`).

James decided both behaviours (18 Nov 2026):
- **A fresh IDE reads ownership from the server, never from a local file.** The IDE only *reads*
  the governance manifest. It never writes it, and it fails closed if the manifest is missing or
  unreadable. James converts the existing servers by hand, once each, with the tool in step 2.
- **First pull is allowed only after a complete analysis.** If elements would be lost, the user
  must type a sentence naming the exact loss. If any part of the analysis can't be read, the
  pull is **refused**: "couldn't check" is never treated as safe.

## Today

**Ownership is decided by two local markers.**
- `core/model-store.js:27` reads `data/model-migration.json` (`isMigrated`, `markMigrated`).
  It's used by `git-state.js:31`, `git-approvals.js:27,64`, `change-set-model.js` and
  `model-store.js` `readDoc`.
- `core/assertions.js:55–75` has its own `"migrated": "model"` marker in
  `config/assertions.json`.
- `tools/migrate-governance.js` writes the documents and then sets the local marker.
- A new machine has neither file, so it treats a model-owned server as unmigrated. It then
  misses the model's change sets, approvals and deploy state, and writes local copies beside them.
- `change-set-model.js` `listSessions` skips any document it can't read (`catch { /* skip
  unreadable */ }`), so a damaged record silently disappears from the list.

**First pull runs with no analysis.**
- `core/git-readiness.js` `firstPullAnalysis` exists, but nothing calls it.
- `core/git-setup.js` `firstPull` checks the typed text and executes the pull plan straight away.
- `firstPullAnalysis` has three faults:
  1. It checks elements only when given a `repoDir`, and no caller provides one.
  2. It reads only each dimension's main hierarchy.
  3. Every read failure is a `continue`, so a dimension it couldn't read counts as "no loss".

## Target

**The manifest.** `Applications/Governance/manifest.json`:

```json
{ "version": 1,
  "areas": { "changeSets": "model", "approvals": "model", "deployState": "model", "assertions": "local" } }
```

- Each area is `"model"` or `"local"`. Any other value, a missing area, or a bad version is an
  error.
- **Missing manifest** (the folder or document isn't there) **and unreadable manifest** (any
  other error, or bad JSON) both throw a `GovernanceManifestError`. Routes report it with
  `fail(res, e)`. Its message names the server and the fix:
  `node tools/migrate-governance.js --manifest <server> --local` (or `--model`).
- Nothing in `core/` or `routes/` writes the manifest. Only the tool does.

**The first-pull analysis.** `firstPullAnalysis(server, opts)` returns:

```
{ complete, reason,                      // complete:false → reason says what couldn't be read
  deployedCommit, plan: { create, update, delete, skip },
  targetOnly: { cubes, dimensions, processes, chores },   // on the target, not in the repo
  elementLoss: [{ dimension, hierarchy, count, sample }],
  loss: { elements, dimensions },
  confirmText }                          // the exact sentence the user must type
```

- `confirmText` is `I understand this overwrites <server>` when there's no element loss. With
  loss, it is `I understand this overwrites <server> and removes <n> elements in <d>
  dimensions`.

## Steps

1. **The manifest reader.**
   - In `core/model-store.js`, add `readManifest(server, opts)` and make `isMigrated(server,
     area, opts)` **async**, read from the manifest.
   - Cache per `server + identity` for 30 s, like the scanner cache. Never cache an error.
   - Every caller listed above `await`s it.
   - `core/assertions.js` uses `isMigrated(server, 'assertions')` instead of its own marker.
   - Delete `loadMarkers`, `saveMarkers`, `markMigrated`, `MARKER_FILE` and `_isMigratedMarker`.
     Nothing reads `data/model-migration.json` or the assertions marker any more.
   - Tests with stub clients: missing manifest throws; bad JSON throws; an unknown area value
     throws; `model` and `local` work; a cached error isn't reused.
2. **The tool writes the manifest; James runs it.** `tools/migrate-governance.js` gains:
   - `--manifest <server> --model|--local [--areas a,b]`, which writes only the manifest. The
     default is all four areas.
   - `--from-markers`, which reads the old `data/model-migration.json` and `config/assertions.json`
     and **prints** the manifest each server would get. It writes only with `--write`.
   - The normal migration run writes the manifest at the end, instead of setting a local marker.
   - The tool prints what it wrote and reads it back to confirm. Never run it against TM1 in this
     round. James runs it.
3. **No silent gaps in governance reads.** `change-set-model.js` `listSessions`: on a model-owned
   area, an unreadable document throws an error naming the document. It is not skipped. Any other
   `catch` that hides a governance read goes in `07_DEPLOY_ROUND2_QUESTIONS.md`, not into this
   round.
4. **Fix the analysis** (`core/git-readiness.js`), with tests on a stub client and a fixture repo
   folder:
   - Clone the branch into a temp folder with the same throwaway-clone approach and
     `core/git-repo.js` helpers that `git-release.js` uses. Delete it afterwards in a `finally`.
     The token never appears in output (`sanitize`).
   - Compare **every hierarchy** in the repo with the same hierarchy on the target, skipping
     `Leaves`. A target hierarchy that isn't in the repo is listed in `targetOnly`.
   - List target cubes, dimensions, processes and chores that aren't in the repo, with control
     objects (`}`) excluded.
   - **Any read that fails sets `complete: false`** with the object and TM1's own message as
     `reason`. Then stop. There is no `continue` past a failure.
   - Build `loss` and `confirmText` as in Target.
   - `GitStatus`/`GitPull` keep going through the client. A pull **plan** is created and never
     executed here.
5. **Wire it into first pull.**
   - `core/git-setup.js` `firstPull` runs `firstPullAnalysis` itself, immediately before
     executing:
     - refuse when `complete` is false, returning the `reason`;
     - refuse unless the typed text equals that run's `confirmText` exactly.
   - So if the target changed since the preview, the counts differ, the sentence no longer
     matches, and the pull is refused.
   - Add `GET /api/git/setup/first-pull-analysis` (read-only) in `routes/deploy.js`, using
     `fail(res, e)`.
   - Add a `useFirstPullAnalysis(server, branch)` hook in `hooks/useApi.js`.
   - `GitSetup.jsx` shows the analysis before the confirmation box:
     - the plan counts;
     - the target-only objects;
     - an element-loss table (dimension, hierarchy, count, sample);
     - the exact sentence to type.
   - When `complete` is false, it shows the reason in red and **no** confirmation box.
6. **Docs.**
   - `DEPLOY_LIFECYCLE.md`: ownership comes from the manifest; how to convert a server; what first
     pull checks.
   - `IMPROVEMENTS.md`: remove 10.2's "not wired" gap.
   - Add `BUG_FIXES.md` lines for the silent-skip and false-safe analysis bugs.
   - Record in the DONE file the exact commands James runs for `TM1_Test_DEV` and `TM1_Test_PROD`.

## Rules

- One commit per step. Before each commit:
  - `npm test` passes;
  - `cd client && npm run build`, then commit `static/` when the bundle changes;
  - client lint is at or below `client/lint-baseline.json`, and lower the baseline if the count
    drops;
  - root lint is 0.
- Do not push. Do not restart any server. **Do not touch TM1 or Git remotes**: no manifest
  writes, no clones of the real repo, no pulls. Tests use stubs and a local fixture folder.
- Any other behaviour bug goes in `07_DEPLOY_ROUND2_QUESTIONS.md`.

## When finished

`docs/ide/review/07_DEPLOY_ROUND2_FIXES_DONE.md`:
- one line per step, with its commit hash and test counts;
- lint before and after;
- every caller of `isMigrated` and what it now does on a manifest error;
- the commands for James;
- anything not done;
- the live check list below.

## Live check list for James

First convert the servers with the tool (dry run, then `--write`). Then:

1. **Fresh IDE:** move `data/model-migration.json` aside and restart. Change sets, approvals and
   deploy history for `TM1_Test_DEV` still come from the model.
2. **Missing manifest:** on a scratch server with no manifest, closing a change set and opening
   approvals both stop with the error naming the tool command. Nothing is written locally.
3. **First pull, clean:** on a scratch v12 target that matches the repo, the analysis shows no
   loss and asks for the plain overwrite sentence.
4. **First pull, planted loss:** add elements on the target that aren't in the repo, in two
   dimensions, one of them in an alternate hierarchy. The analysis names both with counts, and
   only the exact loss sentence lets the pull run.
5. **Changed since preview:** open the analysis, add one more element on the target, then type
   the old sentence. The pull is refused.
6. **Can't check:** use a bad Git token, or remove read access to one dimension. The analysis
   shows the reason, with no confirmation box, and the route refuses the pull.
7. Then rerun the seven checks in `07_DEPLOY_FIXES_DONE.md`.
