# 07 — Deploy round 4: fixes done

Branch `deploy-round4`, starting at `b2ef76d` (the brief) on top of
`deploy-round3` `f9831a2`. Steps 0–4, one commit each; the two record files are a
final documentation commit. No push, no server restart, no TM1 call and no remote
Git use. Tests use plain objects, stubs and local bare Git repos in temp folders.

## Commits and test counts

| Step | Commit | What | `npm test` |
|---|---|---|---|
| 0 | `b8dac16` | Removed "or together" / "combined release": refusals now say `Release "<owner>" to <target> first, then rebuild this release.`; `BUG_FIXES.md` line; test assertions updated | 639 — 638 pass, 1 skipped |
| 1 | `1e8410c` | Won't deploy: `wont_deploy_at/by/reason` in the change log and the model record; owner/admin via `canManageSession`; required reason; open sets refused; mark/unmark routes and list UI; `ownerOf` skips; wizard refuses commit/release; grey badge and "Show N won't deploy" | 646 — 645 pass, 1 skipped |
| 2 | `b31661a` | Catch-up release: admin-only entries per eligible target, typed sentence, closed empty `kind='catch-up'` session, `commit_ref` from the source GitStatus (unpushed refused), `buildRelease({catchUp:true})`, review banner/grouped included/covered/open/target-only, History kind; execute accepts the release commit | 656 — 655 pass, 1 skipped |
| 3 | `82c8a6e` | Covered sets marked after a clean catch-up deploy only; open sets never covered; model records updated; `ownerOf` skips; list hides with "Covered by catch-up <date>" | 661 — 660 pass, 1 skipped |
| 4a | `50b16da` | Follow-up: catch-up approval skipped the close-tests gate it can never satisfy; ordinary releases still require a clean result | 663 tests — 662 pass, 1 skipped |
| 4c | `9742380` | `readDoc` gains a `missingOk` opt-in; the backfill can read a missing model-owned record without weakening the default fail-closed read | 665 tests — 664 pass, 1 skipped |
| 4b | `27e2950` | Backfill a closed model record from the local log before marking an older set won't deploy; covered updates use the same path | 664 tests — 663 pass, 1 skipped |
| 4 | `94589fd` | `DEPLOY_LIFECYCLE.md` in-order rule, catch-up exception, won't deploy, covered; `FEATURES.md` one line per deploy feature; Chore "run now" claim removed | 661 — 660 pass, 1 skipped |

Final: **665 tests — 664 pass, 1 skipped**; root lint **0**; client lint **112**.

## Wording correction

After review, the flag is called **Retire phantom** everywhere (`ff9cdcb`). It retires an empty
change set from release ownership; it does not exclude files from DEV or from a catch-up. The UI,
docs and refusal messages now state that meaning.

## Automatic phantom detection

After the live check, the manual **Retire phantom** action was removed. `GET /api/sessions`
now detects a closed set as phantom when none of the objects it touched still exist, returns
`phantom: true`, and the list hides it behind **Show N phantom**. No manual mark or override.
Catch-up still ships files; the check does not filter them.

## Lint

| | Before (b2ef76d) | After |
|---|---|---|
| Root `npm run lint:count` | 0 | 0 |
| Client `eslint src` | 112 (baseline `client/lint-baseline.json` = 112) | 112 |

## Tests added

- `tests/change-set-wont-deploy.test.js` — mark/unmark and required reason; open
  set refused; model record fields; `ownerOf` skips; a won't-deploy set no longer
  owns a needed subset; non-owner/non-admin 403; release of a marked set refused.
- `tests/deploy-git-catchup.test.js` — catch-up includes owned and unowned files;
  broken link refused; won't-deploy/open sets excluded from covered preview;
  unpushed source refused; source-pushed-commit helper; session name/kind/closed/
  no entries; wrong sentence refused; route 403 for non-admin; unpushed route 409;
  eligible-targets route.
- `tests/change-set-covered.test.js` — closed-only coverage, never open or
  won't-deploy; model record updated; non-catch-up covers nothing; covered set no
  longer blocks a release; route-level proof that coverage happens only on a
  clean deploy.
- `tests/deploy-git-release.test.js` — `execute` accepts a catch-up session's
  release commit (Rule 1 unchanged).

## Not done

- No live checks were run: no TM1, Git remote or server restart was allowed.
- The unpushed-DEV check depends on GitStatus fields that need the live check in
  `07_DEPLOY_ROUND4_QUESTIONS.md` item 3.
- Catch-up target-only objects cover cubes, dimensions, processes and chores, not
  views/subsets (question 4).
- Out-of-scope findings are in `07_DEPLOY_ROUND4_QUESTIONS.md`.

## Live check list for James (TM1_Test_DEV → TM1_Test_PROD)

1. **Won't deploy:** mark the proof and lab sets ("WFP_Lab — test model, never
   deploy", ChangeSet_A/B, Proof…, route-gate-proof, UI Walkthrough, Audit-write
   proof, Round 2…) with a reason. They leave the list and sit under
   "Show N won't deploy".
2. **Catch-up:** Deploy → "Catch up TM1_Test_PROD with TM1_Test_DEV", type the
   sentence; Review shows the banner, included objects, covered sets, open sets
   and target-only objects; then Approve, Deploy, Verify.
3. **Covered:** after the deploy, the WFP history sets show "Covered by catch-up".
   The list shows only "AI: Trim WFP" (open, partly shipped) and anything newer.
4. **In order works again:** make a small change in a new change set, close it,
   and release it to PROD. No refusal about old sets.
5. **Rule 1 holds:** the wizard still offers no way to deploy DEV's head without
   a built release.
6. **Unpushed DEV:** with an uncommitted DEV change, starting a catch-up says
   "Commit DEV first" (confirm the GitStatus fields on this server first).
