# 07 — Deploy round 3: fixes done

Branch `deploy-round3`. Steps 1–3 from `07_DEPLOY_ROUND3_FIXES.md`, one commit each.
No push, no server restart, no TM1 call and no remote Git use. Tests use plain objects,
stubs and local bare Git repos in temp folders only.

> Note: while this work ran, the brief on the branch gained commit `31f1600`
> ("Add the Git token and setup status step"), which adds a separate **Step 4** (Git token
> / setup screen). The task asked for steps 1–3; Step 4 is not implemented here. Step 1
> therefore sits on `31f1600`, not directly on `ea66004`.

## Commits and test counts

| Step | Commit | What | `npm test` |
|---|---|---|---|
| 1 | `162591a` | Link closure; auto-add unowned dependencies, refuse owned/missing links; `checkDependencies` catches an old broken release; review screen lists `addedAsDependency` | 623 tests — 622 pass, 1 skipped |
| 2 | `209f0bc` | "Add to this release" checkboxes for unowned excluded items; `buildRelease` validates `addObjects`; records `addedByUser` + `addedAsDependency` on the change set and approval history | 626 tests — 625 pass, 1 skipped |
| 3 | `4bcd45a` | `PROCESS_RUN` records from IDE run route, MCP `run_process` and MCP chore run; masked parameters; "Processes run" heading; review hint; regression test proving a run never ships the process file | 630 tests — 629 pass, 1 skipped |

## Lint

| | Before | After |
|---|---|---|
| Root `npm run lint:count` | 0 | 0 |
| Client `eslint src` | 112 (baseline `client/lint-baseline.json` = 112) | 112 |

## Link keys the closure handles

Any JSON property ending in:

- `@Code.links` — an array of relative paths (e.g. `Subsets@Code.links`,
  `Hierarchies@Code.links`, `Views@Code.links`);
- `@Code.link` — one relative path (e.g. `MDX@Code.link` → the sibling `.mdx`).

Paths resolve relative to the folder of the file that names them. The closure follows links
in linked files (nested links), ignores a link already present in the release tree, and
returns `{ file, neededBy }` for each missing target. `buildRelease` repeats until no new
file is added, so a chain (`dimension → hierarchy → subsets`) settles.

## Tests added

- `tests/deploy-git-release-links.test.js` — pure closure (hierarchy→subsets, cube→views,
  dimension→hierarchies, already-present link, nested link, singular `@Code.link`); local
  bare-repo `buildRelease` tests for auto-added dependencies, owned-dependency refusal,
  missing-on-DEV refusal, `addObjects` success with `addedByUser`, owned add refusal, and
  not-excluded add refusal.
- `tests/process-run-record.test.js` — masking for object and `[{Name,Value}]` parameters,
  record only when a change set is active, `process-run` absent from `ENTRY_TO_OBJECT`, and a
  local bare-repo release proving a `PROCESS_RUN` never ships the process file.

## Not done

- **Step 4** (Git token / setup screen) added to the brief in `31f1600` after this task was
  issued. Out of scope of steps 1–3; see `07_DEPLOY_ROUND3_QUESTIONS.md`.
- No live checks were run (no network, TM1, Git remote or server restart allowed).
- Out-of-scope bugs are listed in `07_DEPLOY_ROUND3_QUESTIONS.md` (not fixed):
  `ownerOf` ignores subset/view parent; identical `PROCESS_RUN` rows collapse in the view;
  Windows-style link paths are not normalised.

## Live check list for James

1. **Today's release:** rebuild the release for "Testing WFP" → TM1_Test_PROD. `Cities` and
   `Default` should appear under "Added because something in the release needs it", and the
   pull plan should now succeed. Continue to approve and deploy.
2. **Owned dependency:** in two change sets, add a subset in one and a hierarchy linking it in
   the other. Releasing the hierarchy alone is refused, and the message names the other change
   set.
3. **Add to this release:** run a process on DEV that changes a subset, outside any edit. At
   review, the subset is under "Left on DEV" with a checkbox. Tick it, rebuild, and check it
   ships, with your name in the release record and deploy history.
4. **Owned item:** an item owned by another change set has no checkbox.
5. **Process runs:** run a process from the IDE and one through MCP with a change set open.
   Both appear under "Processes run", and parameter passwords are masked. The release doesn't
   include the process file just because it ran.
6. **Old release blocked:** before rebuilding (check 1), the review step's dependency check
   flags the missing `Cities.json` and `Default.json` instead of reaching the pull plan.
