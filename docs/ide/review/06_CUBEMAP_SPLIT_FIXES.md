# 06 — Split CubeMapEditor

Build brief for OpenCode, following the ViewEditor split. **Move code and fold server calls into
hooks; do not change behaviour.** Same screen, buttons, graph, requests and query keys.

## Today

`client/src/components/CubeMapEditor.jsx`: 2,181 lines.

| Lines | What |
|---|---|
| 31–302 | pure layout/filter helpers: DAGRE, reverse map, neighbours/reachability, lens actions, process folding, dimension narrowing, prefix groups |
| 303–466 | graph node components: CubeNode, GroupNode, ProcessNode, DimNode |
| 429–466 | edge components |
| 467–631 | SvgMarkers, Legend, Section, LensTag, FlowItem, DimItem, ActionBtn, StatChip |
| 632–778 | DetailPanel |
| 779–1,988 | CubeMapInner: model load, filters, selection, focus, run/play, panel state |
| 1,989–2,174 | ShowBar, StepInfo, reach text, Toggle |
| 2,175–2,181 | exported CubeMapEditor wrapper |

## Target

```
client/src/components/cubemap-editor/
  CubeMapEditor.jsx        shell (target under 400 lines)
  graph/
    CubeNode.jsx GroupNode.jsx ProcessNode.jsx DimNode.jsx
    edges.jsx              RuleCalc/RuleFeeder/ProcessWrite/ProcessRead/ProcessDimWrite/DimUsedBy/ProcessCall
    SvgMarkers.jsx
  DetailPanel.jsx
  Legend.jsx
  ShowBar.jsx
  hooks/                   one concern per hook: useCubemapModel.js, useCubemapFilters.js,
                           useCubemapSelection.js, useCubemapRun.js, useCubemapLayout.js
client/src/lib/cubemap-editor/  pure functions, no React
  layout.js  filters.js  graph.js  grouping.js
```

No file over 600 lines unless a single JSX panel genuinely cannot be split without changing
behaviour; record the exception.

## Steps

1. **Pure helpers + tests.** Move lines 31–302 into `lib/cubemap-editor/` split by concern. Test
   prefix groups, reachability, dimension narrowing, process roots/folding and lens actions with
   plain objects; DAGRE layout only needs a smoke test that it returns positions for nodes/edges.
2. **Graph nodes, edges and markers.** Move components into `graph/`. No state change.
3. **Legend, section, detail panel, show bar.** Move to their files; keep props identical.
4. **Model/filter/selection/run state into hooks.** Cut `CubeMapInner` along those concerns.
   Hooks may call `hooks/useApi.js`; no `lib/api.js` call in a component. Reads in handlers use
   the query factory + `fetchQuery` pattern from ViewEditor.
5. **Layout/grouping into a hook.** Keep effect order and dependencies exactly; if two effects
   depend on each other's order, keep them together and comment why.
6. **Shell + docs.** `CubeMapEditor.jsx` under 400 lines. Update `CLAUDE.md` Key Files and
   `CONTRIBUTING.md` to name `cubemap-editor/` beside `view-editor/`. Record final files,
   hooks, calls and anything not done.

## Rules

- One commit per step; run `npm test`, `cd client && npm run build` (commit `static/`), client
  lint at or below its baseline, root lint 0.
- Do not push, restart servers, or touch TM1.
- Behaviour bugs found while moving go in `06_CUBEMAP_SPLIT_QUESTIONS.md`, not into the split.

## Manual check list for James

Open the Cube Map; switch lens/filter/prefix grouping; fold a process; focus a cube; open a
process/rule/dimension/cube; play a run sequence and step through it; open Detail/Show sidebars;
save rules for the same cube and confirm the map refreshes; reopen and confirm the tab keeps its
focus/position.
