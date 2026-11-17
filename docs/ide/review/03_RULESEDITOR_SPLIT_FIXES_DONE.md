# 03 — Split EditorPane / RulesEditor (editor split 5 of 5)

Completed 17 Nov 2026. One commit per step. Behaviour is unchanged: the screen, buttons,
requests and query keys are the same. `EditorPane.jsx` remains at its path as the dispatcher and
`App.jsx` still imports it.

| Step | Commit | Tests |
|---|---|---|
| 1 — Pure helpers, `getRevealTarget` and tests out | `c18afd8` | 557 (556 pass, 1 skip) |
| 2 — Lineage and trace panels out | `9ff6200` | 557 (556 pass, 1 skip) |
| 3 — Toolbar and issues list out | `4725721` | 557 (556 pass, 1 skip) |
| 4 — The three calls behind hooks/factories | `d1f4e4b` | 557 (556 pass, 1 skip) |
| 5 — State into the five hooks | `d4ec844` | 557 (556 pass, 1 skip) |
| 6 — Shell, dispatcher and docs | this commit | 557 (556 pass, 1 skip) |

Final: **557 tests, 556 pass, 1 skipped, 0 fail**. Client lint **115 → 113** (baseline lowered to
113 in Step 5); root lint **0**. `rules-editor/RulesEditor.jsx` is **224 lines**;
`EditorPane.jsx` is **88 lines**. No file is over 600 lines and no re-export shim is left behind.

## Files

| File | Lines | What |
|---|---:|---|
| `components/EditorPane.jsx` | 88 | dispatcher only: the active tab's editor + "Show in tree" |
| `rules-editor/RulesEditor.jsx` | 224 | shell: hooks, navigation, conflict banners, editor, side panels |
| `rules-editor/RulesToolbar.jsx` | 231 | history/undo/redo/save/check/format/regions/minimap/panel toggles |
| `rules-editor/IssuesList.jsx` | 31 | static + TM1 check findings, counts, jump to line |
| `rules-editor/lineage/LineagePanel.jsx` | 52 | sources/consumers panel |
| `rules-editor/lineage/LineageNode.jsx` | 37 | lineage tree node (was `TreeNode`) |
| `rules-editor/trace/CellTracePanel.jsx` | 114 | tuple picker, trace action and result tree |
| `rules-editor/trace/TraceNode.jsx` | 57 | recursive trace result node |
| `rules-editor/trace/ElementPicker.jsx` | 77 | searchable element picker, cached by the elements query |
| `lib/rules-editor/check-merge.js` | 21 | `mergeCheckErrors`: TM1 errors + static findings |
| `lib/rules-editor/regions.js` | 12 | `scanRegions`: `#Region` lines |
| `lib/reveal-target.js` | 18 | `getRevealTarget(tab)` |
| `tests/rules-editor-split.test.mjs` | 84 | 8 tests: check merge, regions, reveal targets |

## Hooks

| Hook | Lines | Owns |
|---|---:|---|
| `hooks/useRulesPanels.js` | 37 | `show*` flags, lineage mode, Rule Lens grouping, cube dimensions for Trace, saved rules session |
| `hooks/useRulesMonaco.js` | 209 | mount, one-time completions, cursor, Ctrl+S, regions, minimap, undo/redo, snippet insert, region/format click-outside, theme and font effects |
| `hooks/useRulesCheck.js` | 70 | `runCheck`, sequence guard, result/errors, Monaco markers, live 800ms debounce |
| `hooks/useRulesFormat.js` | 37 | format popup state, expression-structure setting, `runFormat` |
| `hooks/useRulesSave.js` | 51 | save, conflict state/diff, reference warnings, `bumpRulesVersion` |

Effect order is kept: the conflict hook's effect, the saved rules session, `initTabContent`, live
validation, scroll-to-line, region and format click-outside, theme, then font. The format popup's
click-outside listener lives in `useRulesMonaco` with the region listener so it keeps its original
position between the scroll/region effects and the theme/font ones; `useRulesFormat` still owns the
popup state and the formatting action.

## Calls moved

| Old call | New owner |
|---|---|
| `GET /api/elements` in `ElementPicker` | `elementsQuery(server, dim)` in `hooks/useApi.js`; `ElementPicker` reads it with `queryClient.fetchQuery(...)` on first open, keeping `.map(e => e.Name ?? e)` and the empty list on failure |
| `POST /api/rules/check` in `runCheck` | `useCheckRules()` mutation; `runCheck` still uses `mutateAsync`, keeps the sequence guard and still shows static errors when TM1 fails |
| `POST /api/cube/rules/check-references` after save | `useCheckRuleReferences()` mutation; still non-blocking and still swallows its own failure |

No `get`/`post`/`request`/`apiFetch` import remains under `components/rules-editor/` or
`components/EditorPane.jsx`.

## Not done / notes

- All six steps are complete.
- No behaviour bug was found while moving. The CellTracePanel vs `view-editor/trace/` question is
  answered in `03_RULESEDITOR_SPLIT_QUESTIONS.md`; the panels were not merged.
- That file also records one latent behaviour: a non-numeric TM1 `LineNumber` becomes line 0 and
  filters out every static finding. It is now covered by a test, not changed.
- `check-merge.js` returns the merged list as well as `staticToShow`, so the run-check path and the
  issues list cannot drift apart.

## Manual check list for James

1. Open a cube's rules. Edit, then undo and redo. Toggle the minimap. Open the regions menu,
   jump to a region, and collapse and expand all regions.
2. Make a syntax error. The issues list shows it with a squiggle, and clicking it jumps to the
   line. Press Check Now and see the pass/fail glow.
3. Format the rules, and change a setting in the format popup.
4. Save. You should get the reference warnings toast if there are any. An open view of the same
   cube refreshes.
5. Edit the same rules in two tabs, save one, and check the conflict banner and its diff.
6. Open Lineage, switch between sources and consumers, and open a cube from it.
7. Open Cell Trace, pick elements and trace a cell, then open history from a trace node.
8. Open Rule Lens and grouping. Open the Cube Map from it.
9. Open the snippets, history and help panels and a Cell Trace. Open a cube from Lineage, then
   go back to the rules tab: the same panels are open and the trace keeps its rows. (This lives
   in memory per tab, so closing the tab clears it. That is today's behaviour.)
10. Use "show in tree" from a rules, process, subset, dimension and view tab.
