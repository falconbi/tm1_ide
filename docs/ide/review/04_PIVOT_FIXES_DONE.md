# 04 — Shared pivot and the grid: fixes done

Completed 16 Nov 2026. No push, no server restart, no TM1 call. `static/` and
`static/lens-kit/` were rebuilt and committed wherever `shared/` or `client/src` changed.

| step | commit | result | tests | lint |
|---|---|---|---|---|
| 0 — Delete `core/git-review.js` | `229c99a` | File deleted; deploy handoff/escaping-audit mentions removed; grep for `git-review` is empty | 376 (375 pass, 1 skip) | 133 (24 errors, 109 warnings) |
| 1 — Display rollback (bug) | `a1272ea` | Error branch restores `cell.d` with `cell.v`; jsdom test asserts the old display text | 376 (375 pass, 1 skip) | 133 |
| 2 — `dimOf` / type prefix (bugs) | `c7be8b3` | `dimOf` is `]]`-aware; only `c:`/`n:`/`s:` on numeric values is stripped; text `1:30`/`A:B` survive; tests | 378 (377 pass, 1 skip) | 133 |
| 3 — Shortcuts scoped (bug) | `8f6ab76` | `GridToolbar` checks the host wrapper; PivotGrid, flat View grid and MDX ResultGrid pass refs; two-scope jsdom test | 380 (379 pass, 1 skip) | 133 |
| 4 — CSV formatted (bug) | `99abdc0` | CSV and copy share `show()`; `csvText()` added; test exports `1,234.50`; tooltip says “values as shown” | 381 (380 pass, 1 skip) | 133 |
| 5 — Edit lifecycle | `59a9df4` | `setPivot` refuses held save-mode edits unless forced; Lens uses it for same-shape refreshes and surfaces the refusal; test | 382 (381 pass, 1 skip) | 133 |
| 6 — Contract and plan | `e3f4b78` | Header lists `state`, `fitColumns`, `resetWidths`, `toText`, `csvText`; every open `PIVOT_PLAN` item marked done/pending/dropped; theme decision documented | 382 (381 pass, 1 skip) | 133 |
| 7 — Appearance naming | `dc55072` | Global key documented; Format popover says “Grid format (all grids)”; `PivotGrid` no longer mounts a second appearance instance | 382 (381 pass, 1 skip) | 133 |
| 8 — `formatOf` fallback | `cf4aef1` | Optional `measureDimension`; only that dimension is tried when the cell's own dimension has no format; ViewEditor passes the last cube dimension; test | 383 (382 pass, 1 skip) | 133 |

## Notes / not done

- Test counts are one less than some commit messages: the final suite is **383 total, 382 pass,
  1 skip**. Lint stayed at the 133 baseline (24 errors, 109 warnings) at every commit.
- **Step 2:** `stripTm1TypePrefix` keeps its default `numeric = true` for the existing
  `rule-parser.test` contract; `cellsetToPivot` passes the cell type explicitly (`true` for the
  numeric readback, `typeof v === 'number'` for display), so text `1:30`/`A:B` still survives.
  Only `c`, `n`, `s` are treated as prefixes; the comment in `format.js` says so.
- **Step 3:** the test exercises the `inGridScope` helper with two scopes and jsdom focus, rather
  than mounting two React toolbars (the repo has no React test renderer). The listener code uses
  the same helper.
- **Step 5:** when `setPivot` refuses, the grid keeps its blue cells and the host's `onError`
  receives “Save or undo your changes before refreshing.” The Lens shows that through its normal
  error channel; no new inline banner was added.
- **Step 6:** the grid header comment change did not change the built asset hash, so no static
  rebuild was committed for that step. Step 0 touched no client/shared code.
- `docs/ide/review/` remains untracked; none of these commits include the review documents.
