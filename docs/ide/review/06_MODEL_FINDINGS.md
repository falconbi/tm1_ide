# 06 — Understanding the model: Cube Map, Runbook, trace, search

Read-only review. No code changes, no server restart, no TM1 calls.

Scope: `CubeMapEditor.jsx`, `RunbookDialog.jsx`, the Cube Map model route in `server.js`,
`core/cube_data_sources.js`, `core/rule_lens.js`, `core/process_summaries.js`,
`RuleLensPanel.jsx`, the cell trace panel and `/api/cube/trace`, `FindReplace.jsx` and the
cross-object search routes.

## Summary

This area is the part of the IDE that answers "where does this number come from and what will
this process do?" The Cube Map and Data Sources strip are useful, but they are fed by two
separate copies of the same scanner that have already drifted. The Rule Lens parser is not
robust for real element/string syntax, the trace panel keeps the previous trace when you
right-click a different cell, and Find & Replace reports success even when one or more saves
fail.

The most serious issues are model-trust issues: a cache shared across users, a search/replace
that cannot tell a failed save from a successful one, and a Rule Lens that silently misreads
some areas and measures.

---

## 1. Cube Map model and `CubeMapEditor.jsx`

### 1.1 The Cube Map scanner is duplicated in `server.js` and `core/cube_data_sources.js`, and the copies already disagree

**What:** Both the Cube Map route and the Rules editor's Data Sources strip scan every process
for cube reads/writes. The helper functions (`stripComments`, `splitArgs`, `resolveName`), the
`CellPut`/`CellGet`/`ExecuteProcess` regexes, variable-literal resolution and the
`ViewZeroOut`/`CubeClearData` handling are duplicated. `CubeDataSources.jsx` even says "Same
scan as the Cube Map — see `core/cube_data_sources.js`", but the Cube Map does not call that
module.

**Where:** `server.js:3506-3526` (`stripComments`), `3527-3534` (`scanRefs`), `3565-3579`
(`splitArgs`), `3623-3640` (`resolveName`), `3560-3564` (`DIM_WRITE_FNS`).
`core/cube_data_sources.js:17-70` has the same helpers; `116-127` scans rules differently.
`client/src/components/CubeDataSources.jsx:9-10` states they are the same scan.

The copies already differ:

- The server scans every `DB(...)` per line; `core/cube_data_sources.js:116-127` uses
  `line.match()` and only records the first cube per line.
- The server accepts `DB('Cube', ...)`; core uses `DB[S]?`.
- The server filters control processes (`server.js:3642`); core scans `(pd.value ?? [])`
  without that filter (`core/cube_data_sources.js:175-178`).

**Why it matters to a forker:** The Cube Map and the Rules Data Sources strip can show different
writers/readers for the same cube. A fix to one scanner does not reach the other, and a forker
has to learn two implementations of the same model. This is the "one obvious way" problem.

**Suggested fix:** Extract one scanner (`stripComments`, comment-aware string/argument helpers,
literal variable resolution, and the process scan) into a `core/` module. Have
`/api/cubemap/model` and `getCubeDataSources` both call it; keep only the Cube Map-specific
graph enrichment (steps/positions/callers) in the route. Make the single scanner return both
the writer/reader index and the ordered steps the Cube Map needs.

**Effort:** Medium to large.

### 1.2 The Data Sources cache is keyed by server, not by user, so one user's scan can be served to another

**What:** `core/cube_data_sources.js` caches its full process/cube index in a global
`server -> { at, index }` map. The route creates a per-user client (`makeClient(server,
req.ideToken)`), but the cached index contains process code evidence, process names, cube
metadata and summaries from whichever user caused the scan.

**Where:** `core/cube_data_sources.js:14-15` (`cache`), `303-309` (`indexFor`).
`server.js:3485-3493` (route); `server.js:3401-3404` (process summaries use the same cache via
`listProcessSummaries`).

**Why it matters to a forker:** In a multi-user deployment, a user with narrower TM1 security
can see names, code evidence and headers from objects they cannot open. It also makes a
per-user feature behave as a server-wide snapshot. This is a cache-key bug, not just a
performance concern.

**Suggested fix:** Key the cache by `server + ideToken` (or by the resolved TM1 user) and cap
the number of entries; do not share entries across identities. Prefer a per-request memo if
identity is not stable. Add a test with two clients/users that verifies isolation.

**Effort:** Small to medium.

### 1.3 A slow Cube Map load can overwrite a newer one

**What:** `fetchModel` starts a request on every server change/refresh but does not cancel or
sequence the requests. If the user switches server or refreshes while an older request is
still running, the older response can arrive last and replace the newer data.

**Where:** `client/src/components/CubeMapEditor.jsx:871-893` (`fetchModel`), `:893`
(`useEffect(() => { fetchModel() }, [fetchModel])`).

**Why it matters to a forker:** The map can show the wrong model after switching servers or
clicking refresh on a slow PAW/TM1 connection. The user has no indication that the displayed
data belongs to the previous request.

**Suggested fix:** Use an `AbortController` or a monotonically increasing request id; only the
newest request may call `setCubeData`/`setModelReady`. Cancel on unmount and on dependency
change. Show the old map as stale until the new response arrives rather than silently
swapping.

**Effort:** Small.

### 1.4 `showProcesses` is persisted but never restored

**What:** The map writes `showProcesses` into the per-server preferences object, but the state
initializer is `useState(true)` rather than `useState(prefs.showProcesses ?? true)`. Every
reload turns process display back on.

**Where:** `client/src/components/CubeMapEditor.jsx:833` and `:969-976`.

**Why it matters to a forker:** A toggle that appears to persist (and is included in the same
object as the settings that do persist) silently resets. Other toggles in the same block work,
so this is easy to copy as a pattern without noticing.

**Suggested fix:** Initialize from `prefs.showProcesses ?? true` like `allTI`, `showDims` and
`showLensActions`.

**Effort:** Small.

### 1.5 `CubeMapEditor.jsx` is a 2,177-line component with the model, graph builder, playback and four dialogs in one place

**What:** One component owns the model fetch, a large graph-building effect, trace state,
layout, grouping, playback, session restore, the detail panel, the runbook, the Show bar and
step info. The state block alone has dozens of independent `useState` hooks.

**Where:** `client/src/components/CubeMapEditor.jsx` (2,177 lines); the main component starts
at `:780`, state at `:793-864`, graph build at `:1061-1237`, playback at `:1248-1370`, dialogs
at `:1985-2177`.

**Why it matters to a forker:** It is hard to find the one effect that changes what the map
shows, and impossible to test the graph builder without React Flow and the whole component.
This is the largest readability cost in the area.

**Suggested fix:** Move the pure graph functions (`buildReverseMap`, `getReachable`,
`foldProcesses`, `applyGrouping`, layout) into a `lib/cubemap-graph.js` module with tests.
Extract `useCubeMapModel(server)` and the runbook/Show/details panels into their own
components. Keep `CubeMapEditor` as the composition layer.

**Effort:** Large.

---

## 2. `RunbookDialog.jsx`

### 2.1 Summary loading hides server errors

**What:** The dialog fetches `/api/process/summaries` and only checks that the response has a
`processes` array. A 401/500 response is silently ignored, leaving every process with "No
description" instead of an error.

**Where:** `client/src/components/RunbookDialog.jsx:95-104`.

**Why it matters to a forker:** The runbook is a documentation view; silently losing every
description makes it look like no process has a header. The user cannot tell a permissions
failure from missing comments.

**Suggested fix:** Check `r.ok` and `d.error`, show an inline error or retry control, and only
fall back to the Prolog header when the summaries request succeeded but has no entry.

**Effort:** Small.

### 2.2 The selected chore index is not reset when the list changes

**What:** `active` is a numeric index. If the chore list is replaced with a shorter/different
list after a model refresh, the index can point at a different chore or beyond the end.

**Where:** `client/src/components/RunbookDialog.jsx:82-92`.

**Why it matters to a forker:** Reopening or refreshing the model can silently change which
runbook is shown. With an empty list the right-hand panel says "Select a chore" rather than
"No chores".

**Suggested fix:** Store the selected chore name, not its index, or clamp/reset `active` when
`list` changes. Reset on open.

**Effort:** Small.

### 2.3 No other correctness issue found

The runbook is read-only, builds its sequence through the shared `buildRunSequence`, and does
not execute anything. The tree grouping and `affects` map are consistent with the data shape
they receive; the only caveats are the two UI issues above.

---

## 3. Cube Data Sources, Rule Lens and process summaries

### 3.1 Rules Data Sources records only the first DB() on a line

**What:** `scanRules` runs a non-global regex with `line.match(re)`, so a rule line with more
than one `DB()` contributes only the first cube to the Data Sources strip. The Cube Map route
scans all matches.

**Where:** `core/cube_data_sources.js:116-127`.

A local run of
`['M']=N: DB('A') + DB('B');`
returns `ruleReads.calc: ['A']` only.

**Why it matters to a forker:** The Rules editor shows an incomplete list of source cubes for
exactly the kind of multi-source calculation rules are common in. It also makes the strip
disagree with the Cube Map for the same rules.

**Suggested fix:** Use a global scan per line (reset `lastIndex` each line) or scan the whole
calc/feeder text, preserving each matching line as evidence. Add a test with two `DB()` calls
on one line.

**Effort:** Small.

### 3.2 Rule Lens misreads element names containing `]` and escaped apostrophes

**What:** The Rule Lens parser uses a simple `'` toggle and `/\[([^\]]*)\]/` for bracketed
elements. It does not understand `]]` inside an element name, and does not treat `''` as an
escaped quote. A bracketed area such as `['Net Sales]]YTD']` is read as `Net Sales`, and a
measure named `O'Brien` is not matched.

**Where:** `core/rule_lens.js:8-22` (`stripCommentsKeep`), `:24-37` (`splitStatements`),
`:39-48` (`splitList`), `:50-56` (`bracketedElements`).

Local examples:

- `['Net Sales]]YTD'] = N: 1;` reports `areaElements: ['Net Sales']`, so a measure named
  `Net Sales]YTD` is not recognised.
- `['O''Brien'] = N: 1;` keeps `O''Brien` in `areaElements`, so a measure named `O'Brien` is
  not recognised.

**Why it matters to a forker:** Rule Lens is a review aid; wrong measures and areas make the
"By measure" view and transaction-log buttons wrong. TM1 names with brackets/apostrophes are
not exotic, and the rest of the repository already has a `]]`-aware parser.

**Suggested fix:** Use the existing `]]`-aware element parser and a quote-aware scanner that
handles doubled quotes, or reuse the rules comment/structured parser. Add the two examples
above to `tests/rule-lens.test.js`.

**Effort:** Medium.

### 3.3 Process summary writes do not use `gateReadOnly`

**What:** `POST`/`PUT /api/process/summary` write `data/process-summaries.json`, but neither
route calls `gateReadOnly`. `CLAUDE.md` explicitly names process summaries as a local-file
write that must use `gateReadOnly`.

**Where:** `server.js:3410-3459`; house rule at `CLAUDE.md:126`.

**Why it matters to a forker:** A read-only/Prod-posture server still accepts summary writes,
and the local file changes even when the user cannot write the model. It is also inconsistent
with the routes that do gate local writes.

**Suggested fix:** Call `gateReadOnly(res, server)` before the write in both routes; keep the
AI/read work outside the write path if possible. Add a route test or at least a comment that
matches the house rule.

**Effort:** Small.

### 3.4 The summary lookup rereads and reparses the JSON file for every process

**What:** `getLatest()` calls `read()` every time. `getCubeDataSources` calls it for every
writer/reader, `listProcessSummaries` calls it for every process, and `getProcessFacts` walks
the whole index. On a large model this is many file reads/JSON parses for one request.

**Where:** `core/process_summaries.js:20-39`; `core/cube_data_sources.js:318` (per writer),
`:330` (per reader), `:372-379` (per process).

**Why it matters to a forker:** The Data Sources strip and process-summary list become slow on
a real model, and the cost is invisible because the route still succeeds. It also amplifies
the cache issue above.

**Suggested fix:** Read the summary file once per index/request and pass the map into the join
functions, or maintain an in-memory cache invalidated by `put`/`remove`. Keep `getLatest` for
single lookups, but do not call it in a loop.

**Effort:** Small to medium.

### 3.5 Core process index includes control processes; the Cube Map excludes them

**What:** `core/cube_data_sources.js` builds metadata for every `Processes` row, including
`}...` control processes. The Cube Map route filters those out. `getProcessFacts` and
`listProcessSummaries` therefore expose control-process names and headers that the map does
not show.

**Where:** `core/cube_data_sources.js:175-178`; server filter at `server.js:3642`.

**Why it matters to a forker:** The two surfaces disagree about what "the model" contains, and
the summary list includes objects a normal TM1 user may not expect to review.

**Suggested fix:** Apply the same `!Name.startsWith('}')` filter in `buildIndex`, or explicitly
document that control processes are included for summaries.

**Effort:** Small.

### 3.6 Rule Lens checks only calc-section DB sources, not feeder target cubes

**What:** The Rule Lens route checks missing cubes from `parsed.items.flatMap(i => i.dbSources)`.
Feeder items have `dbSources: []` and put their target cubes in `targetCubes`, so a feeder
pointing at a missing cube is not reported.

**Where:** `core/rule_lens.js:99-103` (feeder `targetCubes`, empty `dbSources`);
`server.js:3475` (missing check).

**Why it matters to a forker:** A broken feeder target is exactly the kind of model error the
lens is meant to catch; it can pass the check while failing at TM1 load time.

**Suggested fix:** Include `targetCubes` in the missing-cube check (and decide whether a
feeder target counts as a "cube read" in the summary).

**Effort:** Small.

### 3.7 Concurrent summary writes can lose an entry

**What:** `put()` reads the whole file, mutates the object and renames a temp file. Two
simultaneous summary requests can both read the same base and the second rename overwrites the
first.

**Where:** `core/process_summaries.js:24-28` and `:42-46`.

**Why it matters to a forker:** Bulk "generate summaries" runs one request at a time in the
current UI, but the route is independently callable and the pattern is unsafe to copy.

**Suggested fix:** Serialize writes with a promise/mutex, or use one read-modify-write helper
guarded per file; keep the temp+rename atomicity.

**Effort:** Small.

---

## 4. Cell trace (`TraceSidePanel`, `/api/cube/trace`)

### 4.1 The trace panel keeps the previous stack when you trace a different cell

**What:** `TraceSidePanel` initializes `stack` only from `initialStack` at mount. When the
parent sets a new `traceCtx` (right-click another cell while the panel is open), the component
remains mounted, its state stays on the old cell, and it keeps tracing the old cube/coordinates.

**Where:** `client/src/components/ViewEditor.jsx:1110-1116` (state initializer only); parent
render at `:2786-2794` passes new `ctx`/`initialStack` but no `key` and the child has no
`useEffect` for `ctx`.

**Why it matters to a forker:** The user right-clicks a different cell and sees the previous
cell's rule trace, with no obvious sign it is stale. This is a trust-breaking bug in the core
"why is this number here?" feature.

**Suggested fix:** Key the panel by the trace context (e.g. `key={traceCtx}`) so it remounts,
or add an effect that resets `stack` when the incoming ctx differs. Keep the saved stack only
for the same ctx (the existing `traceRef` equality check can decide).

**Effort:** Small.

### 4.2 After drilling, the cross-cube label compares against the original cube

**What:** `crossCube` is `c.Cube.Name !== ctx.cube`, where `ctx.cube` is the originally traced
cube. After drilling into another cube, components from that current cube are incorrectly
labelled as cross-cube, and components that refer back to the original cube are not labelled.

**Where:** `client/src/components/ViewEditor.jsx:1263`.

**Why it matters to a forker:** The blue cube name is the only indication that a component
belongs to another cube; after one drill it points at the wrong cube.

**Suggested fix:** Compare against `current.cube` (the stack top) rather than `ctx.cube`.

**Effort:** Small.

### 4.3 `/api/cube/trace` returns raw 500 instead of the normalised failure

**What:** The route catches the error and responds `{ error: e.message }` with status 500,
while the rest of the routes use `fail(res, e)`. The trace UI still gets a message, but TM1
status/error shape differs from the rest of the app.

**Where:** `server.js:2111-2115`.

**Why it matters to a forker:** A route template copied from here loses the adapter's TM1
error normalisation. The trace panel only displays `e.message`, so this is not currently
breaking the UI, but it is an inconsistent route pattern.

**Suggested fix:** Use `fail(res, e)` like the other TM1 routes.

**Effort:** Small.

### 4.4 No other trace-data issue found

`useTraceData` clears old data, ignores results after unmount, and surfaces the error; the
drill path fetches dimensions for the current cube. Apart from 4.1/4.2, the trace stack and
cross-cube drill logic read correctly.

---

## 5. `FindReplace.jsx` and cross-object search

### 5.1 Find & Replace reports success when saves fail

**What:** Replace sends one `fetch` per changed Rules/process but never checks `r.ok` or the
JSON error body. `Promise.all` resolves for 401/403/409/500 responses, so a failed save is
reported as "Replaced in N objects", the preview is cleared and the search is reset.

**Where:** `client/src/components/FindReplace.jsx:169-199` (especially `:174-192` and
`:196`).

**Why it matters to a forker:** A read-only server, a permissions failure, a validation error
or a conflict is silently swallowed. The user believes the model changed when it did not. This
is a data-changing action, so the failure must be visible and the preview must remain.

**Suggested fix:** Check every response (`r.ok` plus `d.error`), collect successes and failures,
toast the failure count/names, do not clear the preview when anything failed, and invalidate the
search index only for successful saves. Consider using the existing hooks/`gateWrite` error
shape instead of raw `fetch`.

**Effort:** Small.

### 5.2 Search-index errors look like "No matches"

**What:** The Find & Replace query function returns `r.json()` without checking `r.ok`. A 500
body `{ error: ... }` has no `rules`/`processes`, so `searchIndex` returns `[]` and the UI says
"No matches". The user cannot tell an empty model from a failed scan.

**Where:** `client/src/components/FindReplace.jsx:139-143`, `:146-160`.

**Why it matters to a forker:** Search is a read-only operation, but hiding its failure is
confusing and can make a broken server look like an empty model.

**Suggested fix:** Use the shared `get()` helper or check `r.ok`/`d.error`, store the query
error, and render it instead of a zero-result message. Keep the previous results visible on a
refresh failure.

**Effort:** Small.

### 5.3 Two search surfaces and two routes, with different scopes; the docs call one of them cross-object

**What:** `FindReplace.jsx` uses `/api/search/index` and searches Rules + TI with replace.
`GlobalSearch.jsx` uses `/api/processes/search` and searches TI only, despite being named
"GlobalSearch". `CLAUDE.md` describes Global Search as "cross-object search across rules + TI
code".

**Where:** `client/src/components/GlobalSearch.jsx:26-30`; `server.js:971-1001`
(`/api/processes/search`); `server.js:1573-1603` (`/api/search/index`);
`client/src/components/FindReplace.jsx:139-143`; `CLAUDE.md:294`.

**Why it matters to a forker:** There are two search implementations to maintain, with
different matching and scopes, and the docs promise a scope one of them does not provide.
The Global Search modal also returns a different result shape (process/section/line) from the
Find & Replace index.

**Suggested fix:** Pick one search index/route. Either make the global modal search the same
index (rules + TI) and share result matching, or rename it to "Process search" and correct the
docs. Remove the unused route/hook if only one surface remains.

**Effort:** Medium.

### 5.4 The search index fetches every cube and process individually on every search

**What:** `/api/search/index` calls `getCubes()`/`getProcesses()`, then `getCube(name)` and
`getProcess(name)` for every object with no concurrency limit and no server-side cache.
`FindReplace` refetches on every Search, and `staleTime` only affects the client cache.

**Where:** `server.js:1583-1598`; `client/src/components/FindReplace.jsx:139-143`,
`:157-160`.

**Why it matters to a forker:** A model with hundreds of cubes/processes makes a search slow
and can overload PAW/TM1. It is also wasteful for repeated searches in one session.

**Suggested fix:** Add a short-lived server-side search index (like the Cube Map cache, with
per-user identity), bound concurrency, or fetch the already-available batch endpoints. Return
an index version so the client can decide whether to refetch.

**Effort:** Medium.

### 5.5 Replace does not participate in the conflict/dirty-tab workflow

**What:** Find & Replace writes directly to `/api/rules` and `/api/process` and does not use
`checkBeforeSave`/conflict detection, does not mark or refresh open tabs, and does not ask
about unsaved open buffers. An open editor can still hold the old content and save over the
replacement.

**Where:** `client/src/components/FindReplace.jsx:169-199`; Rules save route `server.js:713-727`;
process save `server.js:1022-1051`.

**Why it matters to a forker:** Bulk replace is a model-wide edit. Without the normal conflict
and open-tab handling it can silently undo another user's save or be undone by an editor tab.

**Suggested fix:** Reuse the editor save path (conflict baseline + tab refresh), or at minimum
invalidate/refresh open Rules/process tabs after a successful replace and warn when a matching
tab is dirty. Add the change-set/session behaviour the normal editor uses.

**Effort:** Medium.

### 5.6 The search-index route logs under the wrong name

**What:** The route logs `[api/process] request` even though it is `/api/search/index`.
`req.query.name` is undefined for this route.

**Where:** `server.js:1575`.

**Why it matters to a forker:** Log noise makes the route look like a process call; it is a
small but misleading copy/paste.

**Suggested fix:** Change the label to `[api/search/index]` and log the cube/process counts.

**Effort:** Small.

---

## 6. Tests

The area has some useful tests, but they do not cover the problems above:

- `tests/cube-data-sources.test.js` covers literals, variables, generic copy, clear/feeders,
  comments and view sources, but not multiple `DB()` calls on one line, escaped apostrophes, or
  per-user cache isolation.
- `tests/rule-lens.test.js` covers normal areas, multi-line DB sources and a semicolon inside a
  string, but not `]]` element names or `''` escaped quotes.
- `tests/cubemap-trail.test.mjs` covers only the trail helpers, not model fetching or graph
  building.
- There are no tests for `TraceSidePanel` resetting on a new cell, `FindReplace` handling failed
  saves, or the search-index error path.

**Suggested fix:** Add focused tests for the scanner (one line with two DBs, apostrophe/bracket
names), the Rule Lens edge cases, cache isolation, trace reset, and a mocked failed replace
response. Keep the graph builder extractable so it can be tested without React Flow.

---

## Checked and found nothing (worth calling out)

- `client/src/components/CubeDataSources.jsx` checks `r.ok`/`d.error`, shows load errors and
  passes `refresh=1` for the explicit rescan; the UI side is sound.
- `client/src/components/RuleLensPanel.jsx` checks the response, shows loading/errors, and
  cancels no state after unmount incorrectly; its own fetch path is fine.
- `core/process_summaries.js` uses a temp file + rename, so a single summary write is atomic;
  the remaining issue is concurrent read-modify-write (3.7).
- `RunbookDialog` is genuinely read-only and does not execute processes; no execution risk found.
- The Cube Map graph effect does not depend on `nodes`, so the previous React Flow measuring
  loop is not present in this component.
- No live TM1 server or REST call was used in this review.
