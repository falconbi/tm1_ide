# 06 — Split CubeMapEditor (editor split 2 of 5)

Completed 17 Nov 2026. One commit per step. Behaviour unchanged; effect order and dependencies
kept (the restore-session effect still runs before both deep-link effects). No direct API calls
remain in the Cube Map folder.

| Step | Commit | Tests |
|---|---|---|
| 1 — Pure helpers out | `7179b16` | 526 (525 pass, 1 skip) |
| 2 — Graph nodes, edges, markers out | `5061141` | 526 (525 pass, 1 skip) |
| 3 — Legend, detail panel, show bar out | `d1a0f03` | 526 (525 pass, 1 skip) |
| 4 — Model, filters, selection, run into hooks | `7f23829` | 526 (525 pass, 1 skip) |
| 5 — Layout/grouping into a hook | `447cff0` | 526 (525 pass, 1 skip) |
| 6 — Shell under 400 lines + docs | this commit | 526 (525 pass, 1 skip) |

Final: **526 tests, 525 pass, 1 skipped, 0 fail**. Client lint **118** (down from 122); backend
lint **0**. `CubeMapEditor.jsx` is **216 lines**. Largest file is `useCubemapLayout.js` at 291
lines; no file needed a size exception.

## Files

| File | Lines | What |
|---|---:|---|
| `components/CubeMapEditor.jsx` | 216 | shell: hooks, open-tab actions, CSS variables, panel composition |
| `cubemap-editor/MapSidebar.jsx` | 269 | object list, model/search/spotlight, Show switches, grouping |
| `cubemap-editor/MapCanvas.jsx` | 161 | ReactFlow canvas, hint, focused thread bar, Show bar, legend |
| `cubemap-editor/DetailPanel.jsx` | 256 | cube detail panel and its small row/chip/section components |
| `cubemap-editor/ShowBar.jsx` | 155 | playback bar and step-detail card |
| `cubemap-editor/Legend.jsx` | 36 | legend |
| `cubemap-editor/Toggle.jsx` | 22 | Show switch |
| `cubemap-editor/reachText.js` | 7 | “12 cubes · 9 processes” thread-bar text |
| `cubemap-editor/graph/CubeNode.jsx` | 46 | cube node |
| `cubemap-editor/graph/GroupNode.jsx` | 21 | module group node |
| `cubemap-editor/graph/ProcessNode.jsx` | 40 | process node |
| `cubemap-editor/graph/DimNode.jsx` | 23 | dimension node |
| `cubemap-editor/graph/edges.jsx` | 36 | the seven custom edges |
| `cubemap-editor/graph/edgeTypes.js` | 7 | `edgeTypes` + `PROCESS_EDGE_TYPES` (kept out of `edges.jsx` so the latter exports only components) |
| `cubemap-editor/graph/SvgMarkers.jsx` | 15 | arrow marker defs |

Pure logic stays in `client/src/lib/cubemap-editor/`: `layout.js`, `filters.js`, `graph.js`,
`grouping.js` (Step 1).

## Hooks

| Hook | Lines | Owns |
|---|---:|---|
| `useCubemapModel.js` | 55 | cube/process/dimension/chore load, loading/error/ready, Lens usage, refresh |
| `useCubemapFilters.js` | 59 | model scope, search, spotlight, trace kinds/depth, Show flags, filtered cube list |
| `useCubemapSelection.js` | 215 | selected cube/module/phase, trail, reachability/steps, dim filter, Esc/Backspace |
| `useCubemapRun.js` | 251 | Show playback, step/speed/follow, per-tab session restore/save, deep links, open-tab actions |
| `useCubemapLayout.js` | 291 | nodes/edges, dagre/group/fold, fit camera, dimming/spotlight, view-pref persistence |

`useCubemapRun` keeps the restore-session effect and both deep-link effects together and in that
order: the old editor relied on restore running before the Rules/runbook deep links so a deep link
wins on the first render. `useCubemapLayout` keeps the build, fit and dimming effects together and
in their original order; the prefs write is commented as independent of them.

## Direct calls moved

| Old call | New owner |
|---|---|
| `/api/cubemap/model` | `cubemapModelQuery` (shared factory) + `queryClient.fetchQuery`, `useCubemapModel` |
| `/api/process/summaries` | `processSummariesQuery` (shared factory) + `queryClient.fetchQuery`, `useCubemapRun` |

No `get`/`post`/`put`/`patch`/`del`/`request`/raw `fetch` call remains in
`components/CubeMapEditor.jsx` or `components/cubemap-editor/`.

## Not done / notes

- No behaviour bugs surfaced while moving, so no `06_CUBEMAP_SPLIT_QUESTIONS.md` was needed.
- `groupRegex` is still read in the shell (three lines from settings) because both the filters
  hook and the selection hook need it before the layout hook is called; grouping itself is in
  `useCubemapLayout`.
- No file needed the “over 600 lines” exception.

## Manual check list for James

Open the Cube Map; switch lens/filter/prefix grouping; fold a process; focus a cube; open a
process/rule/dimension/cube; play a run sequence and step through it; open Detail/Show sidebars;
reopen and confirm the tab keeps its focus/position.
