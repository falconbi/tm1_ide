# 03 — Explorer and the editors: findings

Reviewed 16 Nov 2026, read-only. No 03 brief existed, so this follows `00_STANDARD.md` and
the area definition: Explorer, the tab shell, Rules/TI/Dimension/Subset/View/Chore/Cube editors,
`hooks/useApi.js` and `store/`. Lenses (area 10), deploy (07), admin (08) and MCP (09) are out of
scope except where a shared component is used here.

Method: counted and imported every component, mapped exports in `useApi` to their consumers,
grepped direct `fetch`/token/formatter patterns, read the store and the five largest editors, and
ran ESLint read-only. No code changed, no server restarted, no TM1 call.

The layer works, but it has accumulated two data-access paths, four different ways to close a tab,
and five editors large enough that a forker cannot read one in an evening.

## What's good — keep as the model

- **The tab shell is small and capable.** `TabBar.jsx` (260 lines) and the store's nested-split
  helpers handle drag reorder, split, move, close and history without a layout library.
- **Conflict handling is shared.** `useConflictCheck` + `ConflictBanner` +
  `ConflictSaveWarning` are used by Rules, TI, View and Subset, so one behaviour, not four.
- **The grid surface is shared.** `GridToolbar.jsx`, `grid-appearance.js` and the shared pivot
  keep search, freeze, fit, widths, CSV and appearance in one place.
- **Monaco setup is central.** `lib/tm1-functions.js` owns the language, theme and completions;
  editors point at it rather than registering their own.
- **Explorer is decomposed.** Cube, dimension, rules, control, history and lenses are separate
  section components, not one 1,400-line render.
- **No orphan editors.** Every component is imported (checked all `.jsx` files); there is no
  second copy of Rules/TI/Dimension/Subset/View.

---

## 1. Closing a group, "close others" or "close to the right" can discard unsaved edits

`closeTab` asks about dirty tabs (`client/src/store/index.js:232-238`), but the other close paths
do not:

- `closeGroup` (`store/index.js:312-329`)
- `closeOtherTabsInGroup` (`store/index.js:405-416`)
- `closeTabsToRight` (`store/index.js:418-431`)
- `closeAllTabs` (`store/index.js:282-287`) has no check of its own; it relies on the caller.

The TabBar exposes them directly: the **Close group** button (`TabBar.jsx:250`), and the context
menu's **Close others** / **Close to the right** (`TabBar.jsx:82-83`). Only the **Close all**
button pre-checks dirty tabs (`TabBar.jsx:148-159`). A dirty Rules or TI tab in a group therefore
disappears with no prompt from two of the three close paths.

**Why it matters to a forker:** this is silent data loss in the editor shell. The store is the
only place that knows which tabs are dirty; relying on each button to pre-check it will drift.

**Suggested fix:** one `canClose(ids)` helper in the store returning the dirty list; every close
variant calls it (or a shared `requestClose` action) before mutating layout. The confirm dialog
still belongs in the UI, but the policy is one function. Effort: **small**.

## 2. Forge persistence can resurrect stale content and a stale dirty flag

`_saveForge` writes the **whole** `tabs` array (`store/index.js:89-104`), including `content` and
`dirty`. The only calls are on tab/layout actions: `openTab`, `closeTab`, `closeGroup`,
`reorderTabInGroup`, split/move, etc. `initTabContent`, `updateTabContent` and `markTabSaved`
(`store/index.js:433-443`) do **not** save.

That means the forge file is a snapshot from the last layout action, not the last edit or save:

- Save a dirty tab, then reload the IDE without touching another tab: the forge file can still say
  `dirty: true`, so the reload restores an unsaved warning for work that was saved.
- Edit after the last tab action, then reload: forge restores the older `content`, and Rules
  (`EditorPane.jsx:438-445`) uses `tab.content` before the server copy unless the tab is marked
  dirty. The restored buffer can be older than TM1.
- Conversely, an ordinary tab switch can write the full unsaved Rules/TI buffer into
  `config/forge.json`; there is no size limit and no indication that editor bodies are persisted.

**Why it matters:** persistence is a user-visible contract. Today it is incidental — whatever
happened to be in `tabs` at the last layout change — not a deliberate save of layout or content.

**Suggested fix:** choose one contract. Either persist only layout/meta (strip `content`,`dirty`,
`savedAxes`,`savedMdx` from that write, and always refetch server content), or persist editor
buffers deliberately on `updateTabContent`/`markTabSaved` with a size cap and a restored-dirty
warning. Do not keep the current half-way state. Effort: **medium**.

## 3. Two data-access paths: 139 hooks and 103 direct `fetch` calls

`client/src/hooks/useApi.js` exports 139 query/mutation hooks. At the same time, 35 components
make **103** direct `fetch()` calls. The todirect calls are not obvious from the code because
`useApi.js:11-116` monkey-patches `window.fetch` to attach the IDE token, detect
`needsServerLogin`, and prompt for a change set on writes.

The split causes drift:

- **Existing hooks are bypassed.** `useCubeDimensions` exists (`useApi.js:371`) but `EditorPane`
  fetches `/api/cube/dimensions` by hand (`EditorPane.jsx:391`). `useTraceCellCalc` exists
  (`useApi.js:618`) but `ViewEditor` fetches `/api/cube/trace` twice
  (`ViewEditor.jsx:753`, `ViewEditor.jsx:1127`). `useElementAttrValues` exists but `ViewEditor`
  fetches element attributes by hand (`ViewEditor.jsx:722`).
- **Query invalidation misses direct reads.** A save invalidates the TanStack cache, but a
  component that fetched directly keeps its own `useState` copy; it only refreshes if its own
  effect reruns.
- **Tokens are read directly 54 times in 28 components** (e.g. `EditorPane.jsx:391`,
  `ProcessEditor.jsx:1060`, `SubsetVisualEditor.jsx:180`) instead of one auth helper or
  `useStore(s => s.token)`. One storage change breaks all of them.
- **A global monkey-patch is invisible to the next reader.** It works, but a forker reading a
  component's `fetch` cannot see where auth, login prompts or change-set creation come from.

**Why it matters:** this is the first thing a forker adds to. If they copy a direct `fetch`, they
lose cache, invalidation and the one error path; if they copy a hook, they may not find one for
their endpoint.

**Suggested fix:** adopt one rule — server state goes through `useApi`; a direct `fetch` is allowed
only for streaming/downloads and must be named in a short exception list. Export an explicit
`apiFetch` from `lib/` instead of patching global `fetch` (or keep the patch but document it at the
top of every component family). Add hooks for the missing reads (`process summaries`, `error log`,
`data sources`, `rules lens`). Effort: **medium** (mechanical migration, but touches many files).

## 4. Conflict warning can be missed: refs read during render

`useConflictCheck` (`useApi.js:671-697`) stores the baseline in `baselineRef` and
`initializedRef`, sets them in a `useEffect`, then reads both refs inside `useMemo`
(`useApi.js:682-688`). The first render with fetched history computes `openConflict` while
`initializedRef.current` is still false, then the effect updates the ref without a re-render. The
banner only appears if something else causes another render. ESLint already flags this as
`Cannot access refs during render` (three of the repo's 24 errors).

**Why it matters:** the feature exists to stop one user overwriting another's save. Missing the
first banner is a real overwrite risk, and a forker copying the hook inherits a pattern React 19
warns about.

**Suggested fix:** make the baseline/initialised state reactive (`useState` set from the history
effect, or compute the initial baseline in a `useMemo` keyed on a `history` snapshot and a
`baselineId` state). Keep `checkBeforeSave` on the same value. Effort: **small**.

## 5. The same view opens under two identities

Explorer opens a saved view as `type: 'cubeview'`, id `cubeview:<server>:<cube>:<view>`
(`Explorer.jsx:1262, 1271`). CubeMap and Model Health open the default view as `type: 'view'`, id
`view:<server>:<cube>:Default` (`CubeMapEditor.jsx:1538, 1544`, `ModelHealth.jsx:193`). Both are
rendered by the same `ViewEditor` (`EditorPane.jsx:1122`), and the store typedef lists both.

The result: the same saved view can be open twice, with two tabs, two dirty states and two
histories. A save in one does not close or refresh the other. The intent is clearly one editor for
one view.

**Why it matters:** duplicate tabs and stale grids are the kind of bug a forker will reproduce by
copying either opener.

**Suggested fix:** one tab type and id for a view (prefer `cubeview`, already used by Explorer and
the tab reveal), and make CubeMap/Model Health call the same `openView` helper. Remove `view` from
the typedef or alias it at the boundary. Effort: **small**.

## 6. Docs describe a cell menu and a feeder check that no longer exist

`CLAUDE.md:353-386` still documents `CellContextMenu` as a five-tab panel (Write, Trace, Log, Copy,
Rules) triggered from `HierarchyGrid.jsx`, and says `isAllLeaf` exists for the Write tab.
`HierarchyGrid.jsx` no longer exists, and `CellContextMenu.jsx` (55 lines) contains a header and a
single **Trace** action. The `.badge` paragraph refers to “sub-panels” that are not there.

`docs/ide/FEATURES.md:50` and `:94` still advertise a **check feeders** / **Feeders check** in the
Rules and View editors; the Fire Feeders feature and its route were removed (it called a v11
function that did not exist).

**Why it matters:** these are the first docs a forker reads when adding a cell action. They will
build the wrong menu, and they cannot find the missing feeders feature.

**Suggested fix:** rewrite the CellContextMenu section to the two-component Trace flow
(`CellContextMenu` → `TraceSidePanel`) or restore the menu; delete `HierarchyGrid` references.
Remove the feeder-check claims from FEATURES.md. Effort: **small**.

## 7. Five editors are too large to read in an evening

`ViewEditor.jsx` is 2,836 lines, with the main component at `1345-2836` (~1,490 lines) plus
`RuleBreakdown`, `TraceSidePanel`, `DropZone`, `SubsetPopover` and the axis helpers in the same
file. `CubeMapEditor.jsx` is 2,176 (`CubeMapInner` at `779-2170`, ~1,390); `ProcessEditor.jsx`
1,851 (`724-1851`, ~1,127); `GuidedMDXBuilder.jsx` 1,718 (`655-1718`, ~1,060);
`DimensionEditor.jsx` 1,681.

Each mixes UI, data transforms, Monaco configuration, dirty/save/conflict state, persistence and
side panels. The shared pivot already proves the alternative: the slice-and-dice logic lives in
`shared/pivot/` pure modules with tests, and the editor wrapper is small.

**Why it matters:** file size is the largest barrier to a fork. A new contributor cannot hold
ViewEditor in their head, and changes to save, trace or drill all touch the same file.

**Suggested fix:** extract pure logic first (`useViewAxes`, `useViewDrill`, `useViewSave`; Cube Map
layout/selection; TI datasource/sections) and then the panels. Do one editor per change; no
framework. Effort: **large** (incremental, but high value).

## 8. Three MDX formatters, two different behaviours

`formatMDX` is defined three times:

- `GuidedMDXBuilder.jsx:24` — keyword/line formatter.
- `ViewEditor.jsx:193` — the same keyword/line formatter (near-identical copy).
- `SubsetEditor.jsx:33` — a brace/indent formatter that keeps `{}` structure.

The same MDX expression formats differently depending on which editor's **Format** button you
press, and fixes to one copy do not reach the others.

**Why it matters:** formatting is a teaching surface; two answers for one query is exactly the
“one obvious way” problem.

**Suggested fix:** one `lib/mdx-format.js` with a mode (`statement` vs `set`) and tests; all three
editors call it. Effort: **small**.

## 9. Direct fetches that ignore the response status

Some direct calls do not check `r.ok`, so a failed request becomes an empty view:

- `ProcessEditor.jsx:1060-1063` reads `/api/process/errorlog/content`, then
  `setErrorLogContent(d.content ?? '')`; a 500 shows a blank log with no error.
- `EditorPane.jsx:391-396` fetches `/api/cube/dimensions` and
  `setCubeDims(Array.isArray(d) ? d : [])`; an error becomes “no dimensions”.
- `SubsetVisualEditor.jsx:180-182` loads subset elements; a JSON error object reaches
  `els.map(...)`, then the generic “Failed to load subset” toast.
- `ChangeLogPanel.jsx:148` closes a session and ignores both the status and the body.

**Why it matters:** the user sees an empty feature rather than the real server error — the exact
problem the new `fail`/`tm1-error` server contract is meant to remove.

**Suggested fix:** use the corresponding hook where one exists; otherwise check `r.ok` and
`d.error`. This is the direct-fetch exception list from finding 3. Effort: **small**.

## 10. Almost no tests for 29,495 lines of editor code

The only editor-layer tests are `tests/attr-grid-widths.test.js` (AG Grid width behaviour used by
DimensionEditor) and the shared-pivot jsdom tests (the grid inside View/Lenses). There is no test
for:

- the store's close/split/reorder/move operations and their dirty policy;
- `useConflictCheck` (see finding 4);
- ViewEditor's axis → MDX, drill and save paths (the pure pivot logic is tested, the editor's
  translation into it is not);
- Explorer's locate/reveal and tab-id helpers;
- Rules/TI save, session and conflict flows.

**Why it matters:** the two worst findings here (dirty-close, stale forge) are both store
behaviours and both trivially testable without a browser.

**Suggested fix:** add unit tests for `store/index.js` (pure state transforms), `useConflictCheck`
with a fake history, tab-id helpers, and one jsdom smoke test per editor mount. The existing
`attr-grid-widths` test is a good pattern for the grid parts. Effort: **medium**.

## 11. Smaller clean-ups

- `useDimCubes` (`useApi.js:475`) has no consumer.
- `components/ui/sidebar.jsx` and `hooks/use-mobile.js` are an unused shadcn kit (no importer).
- `shouldAutoOpen` has a duplicate, unreachable view branch
  (`Explorer.jsx:30-31`): the second condition is already covered by the first.
- `TabBar.jsx:198` reads `dragIdx.current` during render for the drop highlight; ESLint flags it
  (`Cannot access refs during render`). Use drag-over state for the style, ref for the payload.
- The editor layer owns most of the repo's baseline lint errors: ViewEditor 8, GuidedMDXBuilder 4,
  useApi 3, plus one each in TabBar, SubsetEditor, SubsetVisualEditor, SQLEditor, Explorer and
  ChangeLogPanel. These are not new, but they are concentrated here and include the conflict bug.

**Checked and found nothing:** no orphan editor component, no duplicate editor implementation, no
`TODO`/`FIXME`/“not implemented” markers in `client/src/components`, and `shared/pivot` has no
equivalent second implementation inside the editors.

---

**Overall:** the shell and shared pieces are sound. The next review of fixes should start with
**1 (dirty close)**, **2 (forge contract)**, **4 (conflict refs)** and **5 (view identity)** —
all small, all user-visible, all in the store/hooks rather than the large editors.
