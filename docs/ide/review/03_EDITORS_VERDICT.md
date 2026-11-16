# 03 — Explorer and the editors: checked verdict

Claude checked OpenCode's `03_EDITORS_FINDINGS.md` against the code on 16 Nov 2026. Nothing
fixed yet. James decides.

## What was checked

| Claim | Result |
|---|---|
| `closeGroup`, `closeOtherTabsInGroup`, `closeTabsToRight` skip the dirty confirm that `closeTab` has (`store/index.js:232` vs `312`, `405`, `418`) | **Confirmed** — only `closeTab` has `if (closing?.dirty) window.confirm(...)` |
| Forge saves full tab content and dirty flags only on layout actions, and restores them on reload (`store/index.js:89-104`, `136-160`, `433-443`) | **Confirmed** — `_saveForge` sends `state.tabs` whole; `updateTabContent` / `markTabSaved` never call it; `loadForge` sets `patch.tabs = forge.tabs` as is |
| Two data paths: hooks vs direct `fetch` | **Confirmed** — 142 exported hooks in `useApi.js`; 76 `fetch('/api…')` calls in 30 component files (OpenCode counted 103 in 35 with a wider pattern; the shape is the same) |
| `useConflictCheck` reads `initializedRef.current` inside `useMemo` (`useApi.js:671-688`) | **Confirmed** — the banner is computed one fetch late because the ref is set in an effect after the memo ran |
| Same view opened as `cubeview:` (Explorer) and `view:` (Cube Map, Model Health) | **Confirmed** — three of each in `client/src/components` |
| `CLAUDE.md` describes a five-tab cell menu; `CellContextMenu.jsx` has Trace only | **Confirmed** — the file is 55 lines. Matches area 02's dead annotation routes |
| Three `formatMDX` definitions, two behaviours | **Confirmed** — `SubsetEditor.jsx:33`, `GuidedMDXBuilder.jsx:24`, `ViewEditor.jsx:193` |
| Five editors 1,700–2,800 lines | **Confirmed** — ViewEditor 2,836; CubeMapEditor 2,176; ProcessEditor 1,851; GuidedMDXBuilder 1,718; DimensionEditor 1,681 |

Not re-verified: the `r.ok` list (finding 9), the unused shadcn kit and `useDimCubes` (finding 11).
Consistent with the rest.

## Ranked recommendations

1. **Dirty check on every close path** (`closeGroup`, `closeOtherTabsInGroup`, `closeTabsToRight`,
   and window close). One shared `confirmDiscard(tabs)` in the store; tests for each path.
   *Small. Data loss today.*
2. **Forge contract.** Decide what forge.json is for and make the code match. Two honest options:
   (a) layout only — strip `content` and `dirty` before saving, editors reload content from TM1 on
   restore; or (b) a real draft store — save on every edit (debounced) and on save, and show a
   "restored unsaved draft" banner on reload. (a) is simpler and matches "the model owns the data";
   (b) is what users may expect. *Small either way.* **Decided by James 16 Nov: (a), layout only.**
3. **`useConflictCheck` ref-in-render.** Move the baseline into state set from the effect, so the
   memo recomputes when it is initialised. Add the fake-history test. *Small. Users can miss a
   conflict warning today.*
4. **One tab identity per view.** One `viewTabId(server, cube, view)` helper used by Explorer,
   Cube Map and Model Health; open-tab dedupe then works. *Small.*
5. **One MDX formatter.** `lib/mdx-format.js` with `statement` and `set` modes plus tests; the
   three editors call it. *Small.*
6. **Fix the docs now, not later.** `CLAUDE.md:353-386` (cell menu, HierarchyGrid) and
   `FEATURES.md:50,94` (feeder check) describe removed features. This goes with the front-door
   fix brief. *Small.*
7. **Direct fetches: the exception list.** Where a hook exists, use it (`EditorPane.jsx:391`,
   `ViewEditor.jsx:753,1127`). Where none exists and the call is one-off, check `r.ok` and
   `d.error`. Write the rule in `CLAUDE.md`: "data through hooks; direct `fetch` only for one-off
   commands, and it checks `r.ok`." *Small/medium.*
8. **Tests for the store** (close/split/reorder/move/dirty) and `useConflictCheck`. These two are
   where findings 1–3 live and need no browser. *Medium.*
9. **Split the five big editors**, pure logic first (`useViewAxes`, `useViewSave`, Cube Map
   selection/layout, TI sections), one editor per change. Start with ViewEditor. *Large,
   incremental. Do after 1–8, and after area 04 (grid) so the pivot boundary is settled.*
10. **Small clean-ups**: remove `useDimCubes`, `ui/sidebar.jsx`, `use-mobile.js`, the duplicate
    branch in `Explorer.jsx:30-31`, the ref-in-render in `TabBar.jsx:198`. *Small.*

## Keep as the model (agreed with the findings)

`TabBar.jsx` and the nested-split store helpers; shared conflict handling; one grid toolbar and
appearance module; Monaco set up once in `lib/tm1-functions.js`; a decomposed Explorer; no
duplicate editors.
