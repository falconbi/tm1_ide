# 06 — One process scanner for the Cube Map and Data Sources

Build brief for OpenCode. It finishes the "not done" item in `06_MODEL_FIXES_DONE.md`: the
Cube Map and the Rules editor's Data Sources strip share their helpers, but each still runs its
own process loop. **Move both onto one scanner.** The screens, buttons, requests and query
keys stay the same. The only behaviour changes are the ones named in this brief. Work on
branch `cubemap-scanner`, which starts from `main`.

## Today

There are two modules, and each fetches every process and scans it separately:

| | `core/cube-data-sources.js` (408 lines) | `core/cubemap.js` (216 lines) |
|---|---|---|
| Used by | `/api/cube/data-sources`, `/api/view/source-usage`, process facts and the summary list | `/api/cubemap/model` |
| Process fetch | `client.get('Processes', …)` | the same call, a second time |
| Variable resolution | `ASSIGN_RE`, `VAR_ASSIGN_RE`, 3 passes | a copy of the same |
| `CellPut`/`CellIncrement` | `splitArgs`, 2nd argument | the same |
| `CellGet` | `splitArgs`, 1st argument | regex `([^,)]+)`, which breaks on `'A' \| sYear` and on names containing `,` or `)` |
| `ViewZeroOut`/`CubeClearData`/`CubeProcessFeeders` | `splitArgs`; kinds `clear`/`feeders` | regex `([^,)]+)`; everything is `write` |
| `ExecuteProcess` cube parameter | skipped on a self-call | attributed even on a self-call |
| Version copy / snapshot copiers | yes | no |
| Dimension writes | no | yes, from the catalog |
| Rules `FEEDERS;` split | on comment-stripped text, leading spaces allowed | on the raw text with `^FEEDERS` only, so an indented `FEEDERS;` counts every feeder as a calc reference |
| Rule refs to itself or to a missing cube | kept | dropped |
| Process fetch fails | `catch { return index }` | `catch {}` |

The Cube Map scan has one more flaw: `CellPut` calls `addStep` for any resolved name, so a
write to a cube that doesn't exist still appears in that process's `writes` and `steps`.

## Step 0 — Two bugs found while reading (each its own commit and `BUG_FIXES.md` line)

- **0a. Every writer's summary shows "stale".** In `getCubeDataSources`, `join(w)` passes no
  process meta, so `latest.hash === meta.codeHash` compares against `undefined`. Every writer
  that has a summary is flagged stale (`CubeDataSources.jsx:170`, and the summaries dialog
  rows). Readers pass the meta and are right. Fix: `join(w, index.processes[w.process] ?? {})`.
  Remove the summary fields `buildIndex` sets on writers, because `join` overwrites them.
  Test: a writer whose summary hash matches the process is not stale; a changed process is.
- **0b. A failed process read returns the wrong shape.** `buildIndex` returns the bare cube
  map on failure, not `{ cubes, processes, viewSources }`. `getCubeDataSources` then reports
  "no sources" and `getProcessFacts` and `listProcessSummaries` throw a `TypeError`. The bad
  result is also cached for 30 seconds. Fix: return the full shape with empty `processes` and
  `viewSources`, plus `scanError: e.message`. Don't cache a result that has `scanError`. Test
  with a stub client whose `get('Processes')` rejects.

## Target

```
core/process-scan.js     new: fetchProcesses(client), scanProcess(p, ctx), scanRules(rules)
core/cube-data-sources.js  buildIndex folds scanProcess results into writers/readers/copiers
core/cubemap.js            buildCubeMapModel folds the same results into edges/steps/dims
```

- `scanProcess(p, { cubeNames, cubeDims, dimNames })` returns one process's facts **in code
  order**, each with `pos` and the statement text:
  - `writes: [{ cube, kind: 'write'|'clear'|'feeders', measure, pos, code }]`
  - `reads: [{ cube, how: 'cellget'|'view', pos, code, view }]` (a cube-view data source has
    `pos: -1`)
  - `calls: [{ process, pos, code, cubeParams: [cube], versionDim }]`
  - `dimWrites: [{ dim, pos }]`
- `scanRules(rules)` returns calc and feeder references with their evidence lines (today's
  `cube-data-sources` version). The Cube Map filters self and missing cubes from it, as it
  does today.
- The helpers (`stripComments`, `splitArgs`, `resolveName`, `CUBE_FIRST_FNS`) move into
  `process-scan.js`. Nothing re-exports them from `cube-data-sources.js`.
- The two consumers keep their own output shapes. Only the scanning moves.

## Settled rules (one rule each, in `process-scan.js`)

1. Every cube and dimension argument is read with `splitArgs` then `resolveName`. There are no
   `([^,)]+)` captures.
2. A name is counted only if the cube or dimension exists. This applies to steps too.
3. `FEEDERS;` is found on comment-stripped text, with leading whitespace allowed.
4. A process calling itself adds no call edge and no cube-parameter writer.
5. The scanner keeps the kinds (`clear`, `feeders`). The Cube Map maps them to `write`, as it
   draws today.
6. The process fetch happens once per build, with the one `$select` both modules use today.

## Steps

1. **Pin today's output.** Add a fixture, `tests/fixtures/process-scan.js`, with stub cubes,
   dimensions and processes covering every pattern in the table above: a literal, a variable,
   a variable chain, a parameter default, a cube-view data source, a generic copier called with
   `pCube`, a version copy, a self-call, a dimension write, an indented `FEEDERS;`, a
   `CellGetN('Sales ' | sYear, …)`, and a write to a missing cube. Record what
   `getCubeDataSources` and `buildCubeMapModel` return for it today, as plain expected objects
   in `tests/model-process-scan.test.js`.
2. **`core/process-scan.js` and its tests.** Write the scanner and test `scanProcess` and
   `scanRules` directly on the fixture: code order, `pos`, evidence text, and each settled rule.
3. **Data Sources on the scanner.** `buildIndex` uses `fetchProcesses` and `scanProcess`. The
   step-1 expectations for `getCubeDataSources`, `getViewSourceUsage`, `getProcessFacts` and
   `listProcessSummaries` must stay **unchanged**.
4. **Cube Map on the scanner.** `buildCubeMapModel` uses the same two functions. Update the
   step-1 Cube Map expectations **only** for the settled-rule differences: `CellGet` with an
   expression, an indented `FEEDERS;`, the missing-cube write and the self-call. List each
   changed expectation in the commit message.
5. **Doubled quotes in names.** `resolveName`, the assignment regex and the rules `DB`/`DBS`
   pattern accept `''` inside a literal, the same as the Rule Lens fix in round 1. Test a cube
   named `O'Brien Sales`, both in TI (`CellPutN(1, 'O''Brien Sales', …)`) and in a rule
   (`DB('O''Brien Sales', …)`).
6. **Report scan failures and use the hook layer.**
   - `/api/cube/data-sources` and `/api/cubemap/model` use `fail(res, e)`.
   - `buildCubeMapModel` sets `scanError` when the process fetch fails, as 0b does, and still
     returns the cubes and rule edges.
   - The Cube Map sidebar and the Data Sources strip show one amber line when `scanError` is
     set: "Process scan failed: …". Rules edges still draw.
   - `CubeDataSources.jsx` reads through a new `useCubeDataSources(server, cube)` hook in
     `hooks/useApi.js`, with a factory for the refresh click (`refresh=1`, `staleTime: 0`).
     After this step, `CubeDataSources.jsx` has no `request`/`get` import.
7. **Docs.** Update the header comments of both modules and the CLAUDE.md Key Files list (add
   `core/process-scan.js`). Record in the DONE file what each consumer still owns.

## Rules

- One commit per step, Step 0a and 0b included. Before each commit:
  - `npm test` passes;
  - `cd client && npm run build`, then commit `static/` when the bundle changes;
  - client lint is at or below `client/lint-baseline.json` (113), and lower the baseline if
    the count drops;
  - root lint is 0.
- Do not push. Do not restart any server. Do not touch TM1. The tests use stub clients only.
- Any other behaviour bug found while moving goes in `06_CUBEMAP_SCANNER_QUESTIONS.md`, not into
  this round. This includes the `/measure/i` dimension-name guess for the measure argument, which
  stays as it is.

## When finished

`docs/ide/review/06_CUBEMAP_SCANNER_FIXES_DONE.md`:
- one line per step, with its commit hash and test counts;
- lint before and after;
- the final line counts of the three modules;
- every Cube Map expectation that changed in step 4, and why;
- anything not done;
- the manual check list below.

## Manual check list for James

Only things the screens do today:

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
