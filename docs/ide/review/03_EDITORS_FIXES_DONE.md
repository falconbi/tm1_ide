# 03 — Explorer and the editors: fixes done

Completed 16 Nov 2026. No push, no server restart, no TM1 call.
`client/` rebuilt and `static/` committed wherever a client file changed.

| step | commit | result | tests | lint |
|---|---|---|---|---|
| 1 — Dirty check on every close path (bug) | `40efc6e` | One `confirmDiscard(tabs)` in the store; `closeGroup`, `closeOtherTabsInGroup`, `closeTabsToRight`, `closeAllTabs` ask and name the dirty tabs; `closeTab` keeps its single-tab wording; TabBar no double prompt; `beforeunload` warns | 389 (388 pass, 1 skip) | 133 (24 errors, 109 warnings) |
| 2 — Workspace layout only (bug) | `fabf02c` | `_saveForge`/`loadForge` strip `content`/`dirty`; `POST /api/forge` strips old payloads; CLAUDE.md says layout only; editors reload from TM1 | 391 (390 pass, 1 skip) | 133 |
| 3 — Conflict ref read (bug) | `cba076e` | Baseline/initialised are state; `conflictEntry()` is pure and tested; the three `useApi` ref warnings are gone | 396 (395 pass, 1 skip) | 132 (22 errors, 110 warnings) |
| 4 — One tab identity per view (bug) | `83001fc` | `lib/tab-ids.js` for view/rules/process/dimension/subset; all openers use it; Cube Map/Model Health open `cubeview`; `subset-tab.js` folded in | 399 (398 pass, 1 skip) | 132 |
| 5 — One MDX formatter | `60dd0f3` | `lib/mdx-format.js` with statement/set modes; three local copies removed; fixtures pin the old output | 402 (401 pass, 1 skip) | 132 |
| 6 — Docs match code | `c06a6c9` | CellContextMenu section is Trace-only; HierarchyGrid references and feeder-check promises removed | 402 (401 pass, 1 skip) | 132 |
| 7 — Direct fetch exceptions | `1c224a0` | EditorPane uses `useCubeDimensions`; ViewEditor trace/value lookups use `useTraceCellCalc`; ProcessEditor/SubsetVisualEditor/ChangeLogPanel check `r.ok`/`d.error`; rule written in CLAUDE.md | 402 (401 pass, 1 skip) | 132 |
| 8 — Small clean-ups | `b29b2c7` | Removed `useDimCubes`, `ui/sidebar.jsx`, `use-mobile.js`, duplicate Explorer branch; TabBar uses `dragFrom` state for the highlight | 402 (401 pass, 1 skip) | 129 (20 errors, 109 warnings) |
| 9 — Store tests | `2b805e8` | `tests/client-store.test.js`: open/focus, close, split both ways, move, reorder, close others, close right, history | 411 (410 pass, 1 skip) | 129 |

Before: **376 tests** (375 pass, 1 skip); lint **133** (24 errors, 109 warnings).
After: **411 tests** (410 pass, 1 skip); lint **129** (20 errors, 109 warnings).

## Step 7 — direct-fetch list (what is left)

100 direct `fetch()` calls remain in 35 component files. Counts:

`LensEditor 8`, `DimensionEditor 8`, `ViewEditor 7`, `ProcessEditor 6`,
`AssertionsManager 6`, `TransactionLogPanel 5`, `DeployWizard 5`, `GitSetup 4`,
`FindReplace 4`; the other 26 files have 1–3 each
(`CatalogAdmin`, `ChangeLogPanel`, `CubeDataSources`, `CubeMapEditor`, `DeployCenter`,
`DeployPanel`, `EditorPane`, `Explorer`, `FileManager`, `GitDrift`, `GuidedMDXBuilder`,
`ImportPackagePanel`, `LoginPage`, `ModelHealth`, `ObjectHistoryPanel`, `PeriodBuilder`,
`PicklistBuilder`, `ProcessSummariesDialog`, `RuleLensPanel`, `RunbookDialog`,
`SaveDataButton`, `ServerLoginDialog`, `ServerSelector`, `SubsetEditor`, `SubsetVisualEditor`).

One more this round: `ViewEditor` still fetches cross-cube dimensions on demand inside
`TraceSidePanel.drillTo`; it is a dynamic target cube, so it cannot use the fixed `useCubeDimensions`
hook without a refactor.

## Notes / not done

- **Step 3:** no React test renderer in the repo, so the test covers the pure
  `conflictEntry(history, username, baseline)` decision, not the hook mount. The hook now calls
  that function with state, so the state transition is the only untested part.
- **Step 1:** `beforeunload` cannot be meaningfully tested under Node; implemented in `App.jsx`.
- **Step 2:** checked `initTabContent`/content consumers; restored tabs have no `content`, and the
  editors fetch from TM1 as for a fresh tab.
- **Step 4:** `process:server:new:…` remains the only non-helper tab id; it is a fresh, unnamed
  tab, not an existing object identity.
- **Step 8:** removing the unused shadcn sidebar changed the CSS asset; rebuilt and committed.
- `docs/ide/review/` remains untracked; none of these commits include the review documents.
