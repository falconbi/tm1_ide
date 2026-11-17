# 03 — Split EditorPane / RulesEditor (editor split 5 of 5)

Build brief for OpenCode. Follows the View, Cube Map, Process and Dimension splits; copy their
shape. **Move code and fold server calls into hooks. Do not change behaviour.** The screen,
buttons, requests and query keys stay the same. Work on branch `rules-editor-split`, which
starts from `dimensioneditor-split`.

## Today

`client/src/components/EditorPane.jsx` is 1,137 lines. It holds two things:
- the **Rules editor** with its lineage and cell-trace panels (lines 42–1,057);
- the **tab dispatcher** that picks an editor for the active tab (1,058–1,137).

The Rules editor itself holds 21 `useState`, 13 `useEffect` and 6 `useRef`.

| Lines | What |
|---|---|
| 42–125 | `TreeNode` (lineage tree), `LineagePanel` |
| 126–360 | `TraceNode`, `ElementPicker`, `CellTracePanel` |
| 361–435 | `RulesEditor`: refs, saved panel UI state, open-tab actions |
| 436–529 | `runCheck` (static + TM1 check, sequence guard) and the check effects |
| 530–564 | `runFormat`, format popup effects |
| 565–595 | save, conflict, check-references |
| 596–735 | undo/redo, `handleMount`, regions, snippets, minimap |
| 736–753 | conflict banner and save warning |
| 754–975 | the toolbar (data sources, check, format, regions, panel toggles) |
| 976–1,057 | help, Monaco, history, issues list, snippets, trace, lineage, Rule Lens |
| 1,058–1,070 | `getRevealTarget` |
| 1,071–1,137 | `EditorPane` dispatcher |

Direct calls to move:

| Line | Call | Where |
|---|---|---|
| 200 | `get /api/elements` | `ElementPicker`, lazy load on first open |
| 447 | `post /api/rules/check` | `runCheck` |
| 577 | `post /api/cube/rules/check-references` | after a successful save |

## Target

```
client/src/components/rules-editor/
  RulesEditor.jsx            shell (under 400 lines)
  RulesToolbar.jsx           today 754–975
  IssuesList.jsx             the check errors list under the editor
  lineage/                   LineagePanel.jsx LineageNode.jsx (today's lineage TreeNode)
  trace/                     CellTracePanel.jsx TraceNode.jsx ElementPicker.jsx
  hooks/                     one concern per hook:
    useRulesPanels.js        show* flags, lineage mode, Rule Lens grouping, the saved rules session
    useRulesMonaco.js        mount, one-time completions, regions, minimap, undo/redo, snippet insert
    useRulesCheck.js         runCheck, sequence guard, check result/errors, markers, its effects
    useRulesFormat.js        format popup, expression-formatter settings, runFormat
    useRulesSave.js          save, Ctrl+S, conflict state/diff, check-references, bumpRulesVersion
client/src/lib/rules-editor/     pure functions, no React
  check-merge.js             static + TM1 errors → the list shown (static only before the first TM1 error)
  regions.js                 scan #Region lines
client/src/lib/reveal-target.js  getRevealTarget(tab)
client/src/components/EditorPane.jsx   the dispatcher only (about 100 lines)
```

- `EditorPane.jsx` stays at its current path. It is the dispatcher, not an editor, and `App.jsx`
  imports it.
- `TreeNode` becomes `LineageNode`, so it doesn't share a name with the Dimension editor's
  `tree/TreeNode`. Keep its props.
- No file over 600 lines. No re-export shim is left behind.

## Steps

1. **Pure functions + tests.**
   - `check-merge.js`: test with no TM1 errors, with a TM1 error at line 10 and static findings
     at lines 5 and 20, and with a TM1 `LineNumber` that isn't a number.
   - `regions.js`: test nested and unclosed regions, using whatever the code does today.
   - `getRevealTarget` → `lib/reveal-target.js`: one test per tab type, including a cube view
     with and without a view name, and an unknown type → `null`.
2. **Lineage and trace panels.** Move `TreeNode` (as `LineageNode`), `LineagePanel`,
   `TraceNode`, `ElementPicker` and `CellTracePanel` into `lineage/` and `trace/`. Keep their
   props identical.
3. **Toolbar and issues list.** Move the toolbar JSX and the check errors list into
   `RulesToolbar.jsx` and `IssuesList.jsx`, passing values and callbacks as props.
4. **The three calls behind hooks or factories.**
   - In `hooks/useApi.js`, lift `useElements` into `elementsQuery(server, dim, hierarchy)`, with
     the same key. `ElementPicker` reads it with `queryClient.fetchQuery(elementsQuery(server,
     dim))` on first open. Keep the `.map(e => e.Name ?? e)` and the empty list on failure.
   - Add `useCheckRules()` (mutation, `mutateAsync` inside `runCheck`). Keep the sequence guard,
     and keep "TM1 check failed, so static errors are still shown".
   - Add `useCheckRuleReferences()` (mutation). It stays non-blocking and keeps swallowing its
     own failure.
   - After this step, no `get`/`post`/`request`/`apiFetch` import remains in `rules-editor/` or
     `EditorPane.jsx`.
5. **State into hooks.** Cut `RulesEditor` along the five hooks above.
   - Keep effect order and dependencies exactly. If two effects depend on each other's order,
     keep them in the same hook and comment why.
   - Keep the `registeredRef` once-only completion guard.
   - The rules session (`getRulesSession`/`saveRulesSession`, in memory per tab) must restore
     and save the same panel flags as today. `CellTracePanel` keeps its own `rows`/`lastPairs`
     session key unchanged.
6. **Shell, dispatcher and docs.**
   - `rules-editor/RulesEditor.jsx` must be under 400 lines. `EditorPane.jsx` imports it and
     `getRevealTarget`.
   - Update CLAUDE.md:
     - the Key Files entry: `EditorPane.jsx` is the dispatcher, and `rules-editor/` is a new
       folder;
     - "Adding a New Editor Type" step 6: `getRevealTarget` now lives in `lib/reveal-target.js`;
     - the "Code folding" and "Completed Features" lines that name `EditorPane`.
   - Update `CONTRIBUTING.md`.
   - Record the final files, hooks and calls, and anything not done.

## A question to answer, not to do

The Rules editor's `CellTracePanel` and the View editor's `view-editor/trace/` both call
`/api/cube/trace` through `useTraceCellCalc`, and each renders the result its own way. In
`03_RULESEDITOR_SPLIT_QUESTIONS.md`, write down:
- what each one shows that the other doesn't;
- whether the Rules trace could use `view-editor/trace/` components without changing what the
  user sees.

Don't merge them in this round.

## Rules

- One commit per step. Before each commit:
  - `npm test` passes;
  - `cd client && npm run build`, then commit `static/`;
  - client lint is at or below `client/lint-baseline.json`, and lower the baseline if the count
    drops;
  - root lint is 0.
- Do not push. Do not restart any server. Do not touch TM1.
- Any behaviour bug found while moving goes in `03_RULESEDITOR_SPLIT_QUESTIONS.md`, not into the
  split.

## When finished

`docs/ide/review/03_RULESEDITOR_SPLIT_FIXES_DONE.md`:
- one line per step, with its commit hash and test counts;
- lint before and after;
- the file and hook tables;
- the calls moved;
- anything not done;
- the manual check list below.

## Manual check list for James

Only things the editor does today:

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
