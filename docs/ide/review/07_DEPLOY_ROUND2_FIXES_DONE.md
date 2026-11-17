# 07 — Deploy round 2: fixes done

Both behaviours are implemented on `deploy-round2`. No push, no server restart, no TM1 server and
no Git remote was touched: every test uses stub clients and a local fixture repository.

## Steps and commits

| Step | Commit | What changed | Tests |
|---|---|---|---|
| 1 | `a764884` | `core/model-store.js` reads `Applications/Governance/manifest.json`; async `isMigrated` cached per server + identity for 30 s (errors never cached); local markers removed; every caller awaits; `assertions.js` uses the manifest | 594 (593 pass, 1 skipped) |
| 2 | `43086a8` | `tools/migrate-governance.js` gains `--manifest/--model/--local/--areas` and `--from-markers [--write]`; normal migration writes the manifest and reads it back | 598 (597 pass, 1 skipped) |
| 3 | `509020e` | `change-set-model.listSessions` fails loudly on an unreadable model-owned document and names it | 601 (600 pass, 1 skipped) |
| 4 | `bc96ecf` | `firstPullAnalysis` clones the branch into a throwaway folder, compares every hierarchy (skipping `Leaves`), lists target-only objects, fails closed, and builds `loss`/`confirmText` | 606 (605 pass, 1 skipped) |
| 5 | `cffa7b1` | `firstPull` re-runs the analysis and requires that run's sentence; read-only route `GET /api/git/setup/first-pull-analysis`; `useFirstPullAnalysis`; `GitSetup` shows plan, target-only objects, loss table and hides the box when incomplete | 608 (607 pass, 1 skipped) |
| 6 | `610b961` | Docs (`DEPLOY_LIFECYCLE`, `IMPROVEMENTS`, `BUG_FIXES`), this DONE file, the questions file; `--areas` now changes only the named areas in the tool | 609 (608 pass, 1 skipped) |

A review follow-up (`95eb93b`, 612 tests: 611 pass, 1 skipped) made assertions read the manifest **before** the model document — a missing manifest now fails closed even when an assertion document exists, and a `local` area never reads that document. It also made the migration tool refuse to merge an invalid existing manifest instead of silently resetting the other areas to local.

## Files

- Step 1: `core/model-store.js`, `core/assertions.js`, `core/git-state.js`, `core/git-approvals.js`,
  `core/change-set-model.js`, `tests/governance-manifest.test.js`
- Step 2: `tools/migrate-governance.js`, `tests/migrate-governance-tool.test.js`
- Step 3: `core/change-set-model.js`, `tests/change-set-model-read.test.js`
- Step 4: `core/git-readiness.js`, `tests/deploy-git-first-pull-analysis.test.js`
- Step 5: `core/git-setup.js`, `routes/deploy.js`, `client/src/hooks/useApi.js`,
  `client/src/components/GitSetup.jsx`, `tests/fixtures/route-table.json`,
  `tests/safety-firstpull.test.js`, `static/` (bundle changed)
- Step 6: `docs/deploy/DEPLOY_LIFECYCLE.md`, `docs/ide/IMPROVEMENTS.md`, `docs/ide/BUG_FIXES.md`,
  `docs/ide/review/07_DEPLOY_ROUND2_FIXES_DONE.md`,
  `docs/ide/review/07_DEPLOY_ROUND2_QUESTIONS.md`, `tools/migrate-governance.js` (+ its test)

## Lint

- Before: client **112** problems (18 errors, 94 warnings), root **0**.
- After: client **112** (18 errors, 94 warnings), root **0**. No drop, so
  `client/lint-baseline.json` stays at 112.
- Client builds ran for step 5 (the only step that changed client source) and again for step 6; steps 1–4 changed no client source, so the bundle was unchanged. `static/` was committed with step 5.

## Every caller of `isMigrated`, and what it does on a manifest error

The manifest reader throws `GovernanceManifestError` (missing folder/document, bad JSON, bad version,
missing area, or a value other than `model`/`local`). Nothing catches it and falls back to a local
file.

| Caller | Behaviour on a manifest error |
|---|---|
| `core/model-store.js` `readDoc` | Throws. A model-owned area with a missing document also throws (names the document and the fix). |
| `core/git-state.js` `recordDeploy` | Throws; the deploy write fails loudly. |
| `core/git-approvals.js` `readFor` / `append` | Throws; approval reads and writes fail loudly. |
| `core/change-set-model.js` `closeAndPersist` | Throws; closing the change set fails (it does not silently stay local). |
| `core/change-set-model.js` `listSessions` | Throws; the list fails instead of returning a partial/local list. |
| `core/assertions.js` `list` / `add` / `remove` / `update` / `migrate` | Throws; assertions never fall back to `config/assertions.json` and never silently run zero. |

## Commands for James

Convert an existing install from the old local markers (dry run, then write):

```bash
node tools/migrate-governance.js --from-markers
node tools/migrate-governance.js --from-markers --write
```

Or set each server explicitly. These commands write only the manifest:

```bash
node tools/migrate-governance.js --manifest TM1_Test_DEV  --model --areas changeSets,approvals,deployState
node tools/migrate-governance.js --manifest TM1_Test_PROD --model --areas changeSets,approvals,deployState
```

If assertions are model-owned as well:

```bash
node tools/migrate-governance.js --manifest TM1_Test_DEV  --model --areas assertions
node tools/migrate-governance.js --manifest TM1_Test_PROD --model --areas assertions
```

`--areas` changes only the named areas; the others keep their current value. A normal migration
(`node tools/migrate-governance.js TM1_Test_DEV`) writes the change-set/approval/deploy-state
documents and then the manifest, preserving the current `assertions` choice. Run the tool against
TM1 only when you are ready; this round did not.

## Anything not done

- No live run of the migration tool, no manifest written to a real server, and no live first pull.
- `tools/migrate-assertions.js` still only copies the assertion document; set the `assertions` area
  afterwards with `--manifest <server> --model --areas assertions` (noted in the lifecycle doc and
  in `07_DEPLOY_ROUND2_QUESTIONS.md`).
- Out-of-scope governance catches (`readOptional`, Lens list errors, local deploy-state read) are
  listed in `07_DEPLOY_ROUND2_QUESTIONS.md`, not changed.

## Live checks for James

First convert the servers with the tool (dry run, then `--write`). Then:

1. **Fresh IDE:** move `data/model-migration.json` aside and restart. Change sets, approvals and
   deploy history for `TM1_Test_DEV` still come from the model.
2. **Missing manifest:** on a scratch server with no manifest, closing a change set and opening
   approvals both stop with the error naming the tool command. Nothing is written locally.
3. **First pull, clean:** on a scratch v12 target that matches the repo, the analysis shows no loss
   and asks for the plain overwrite sentence.
4. **First pull, planted loss:** add elements on the target that aren't in the repo, in two
   dimensions, one in an alternate hierarchy. The analysis names both with counts, and only the
   exact loss sentence lets the pull run.
5. **Changed since preview:** open the analysis, add one more element on the target, then type the
   old sentence. The pull is refused.
6. **Can't check:** use a bad Git token, or remove read access to one dimension. The analysis shows
   the reason, with no confirmation box, and the route refuses the pull.
7. Then rerun the seven checks in `07_DEPLOY_FIXES_DONE.md`.
