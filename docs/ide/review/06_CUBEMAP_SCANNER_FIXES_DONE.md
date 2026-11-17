# 06 — One process scanner for the Cube Map and Data Sources

Completed 18 Nov 2026. One commit per step. The screens, routes, query keys and output shapes
are unchanged apart from the settled scanner rules and the two Step 0 bugs. The Cube Map and the
Rules Data Sources strip now both fold the same facts from `core/process-scan.js`.

| Step | Commit | Tests |
|---|---|---|
| 0a — Writers no longer always show "summary stale" | `b6bb16f` | 567 (566 pass, 1 skip) |
| 0b — A failed process read returns the full shape, uncached | `c9f6a4e` | 568 (567 pass, 1 skip) |
| 1 — Fixture and today's outputs pinned | `17788b2` | 572 (571 pass, 1 skip) |
| 2 — `core/process-scan.js` + direct tests | `d012d00` | 583 (582 pass, 1 skip) |
| 3 — Data Sources index on the scanner | `a259010` | 583 (582 pass, 1 skip) |
| 4 — Cube Map model on the scanner | `99fe6a5` | 583 (582 pass, 1 skip) |
| 5 — Doubled quotes in names | `b198251` | 584 (583 pass, 1 skip) |
| 6 — Scan failures reported, Data Sources hook | `1af2d08` | 585 (584 pass, 1 skip) |
| 7 — Docs, line counts and this file | this commit | 585 (584 pass, 1 skip) |

Final: **585 tests, 584 pass, 1 skipped, 0 fail**. Root lint **0** throughout. Client lint **113
before, 112 after**; `client/lint-baseline.json` is lowered from 113 to 112.

## Final module line counts

| File | Lines | Still owns |
|---|---:|---|
| `core/process-scan.js` | 232 | process fetch (one `$select`), comment/argument/name helpers, `scanProcess`, `scanRules`, catalog-derived dimension writes |
| `core/cube-data-sources.js` | 262 | process metadata (header/source/parameters/code hash), per-user brief cache, summary join, writers/readers/copiers/view-source folding, process facts and summary list |
| `core/cubemap.js` | 133 | rule-ref filtering (existing cubes, not self), TI edge maps, distinct code-order steps, dimension/chore model, `scanError` |

`core/cubemap.js` fell from 216 lines and `core/cube-data-sources.js` from 408; the shared
scanner is the new 232-line module. No file needed a size exception.

## Cube Map expectations changed in Step 4

All of these come from the settled rules, not from a rewrite of the map:

| Expectation | Before | After | Why |
|---|---|---|---|
| `Source.ruleCalcRefs` | `['ReadCube', 'FeederCube']` | `['ReadCube']` | an indented `FEEDERS;` now ends the calc section |
| `Source.ruleFeederRefs` | `[]` | `['FeederCube']` | the same indented `FEEDERS;` starts the feeder section |
| `Source.ruleLoc` | `3` | `1` | the feeder block is no longer counted as calculation lines |
| `Sales 2026, Ltd.tiReaders` | `[]` | `['P comma read']` | `CellGet` now reads its first argument with `splitArgs` then `resolveName` |
| `processes['P comma read']` | absent | a `read` step at pos 16 | follows the new `CellGet` read |
| `Target.tiWriters` | included `P self` | no `P self` | a self-call adds no cube-parameter writer |
| `processes['P self']` | write `Target` at pos `Infinity` | absent | follows the self-call rule |
| `processes['P missing write']` | write `Missing Cube` at pos 0 | absent | a name is counted only when the cube exists, steps included |

Step 5 also changed the fixture expectations for doubled quotes: `Source` gains
`O'Brien Sales` in both calc and feeder refs, `O'Brien Sales.tiWriters` gains `P obrien`, and
`processes['P obrien']` gains its write step. Data Sources gains the same writer and rule
references.

## Not done / notes

- No live TM1 checks were made. Every test uses stub clients; no server was restarted and TM1 was
  not touched. Nothing was pushed.
- The `/measure/i` dimension-name guess for the measure argument is unchanged, as the brief says.
- `processHeader`, `tidyCode`, the 30-second per-identity cache and the summary join stay in
  `core/cube-data-sources.js`; they are presentation/aggregation, not scanning.
- `scanError` on the Cube Map is best-effort for the process fetch only. A failed cube/rules fetch
  still fails the route through `fail(res, e)`, as before.
- No other behaviour bug surfaced while moving, so no `06_CUBEMAP_SCANNER_QUESTIONS.md` was needed.
- `BUG_FIXES.md` records Step 0a and Step 0b under 18 November 2026.

## Manual check list for James

1. Open the Cube Map. Check that the cubes, the rule edges (calc and feeder) and the TI edges
   look the same as before.
2. Focus a cube and check that its writer and caller processes appear around it.
3. Switch on All TI and run the Show playback on a process. The steps should play in code order.
4. Open a cube that has a dimension-maintenance process, and check that the dimension node and
   its writer show.
5. Rules editor: open the Data Sources strip on a cube that TI loads. Check the writers,
   readers, evidence lines and copiers.
6. Generate or open a process summary. "summary stale" should now show only when the process
   has changed since the summary was written.
7. Press refresh on the Data Sources strip and check it reloads.
8. Open a view that a process uses as its data source, and check that the process is listed.
