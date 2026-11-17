# 03 — Split ProcessEditor (editor split 3 of 5)

Build brief for OpenCode. Follows the ViewEditor and Cube Map splits; copy their shape.
**Move code and fold server calls into hooks. Do not change behaviour.** The screen, buttons,
requests and query keys stay the same. The one exception is the ASCII preview bug in step 4.
Work on branch `processeditor-split`.

## Today

`client/src/components/ProcessEditor.jsx` is 1,841 lines. The `ProcessEditor` component itself
holds 47 `useState`, 9 `useEffect`, 3 `useCallback` and 8 `useRef`.

| Lines | What |
|---|---|
| 24–36 | constants: `CODE_TABS`, `SECTION_LABEL`, `CAPTURE_HOVER`, `CAPTURE_WHEN_HELP`, `PARAM_TYPE` |
| 38–105 | `EditableParamsPanel` |
| 106–238 | `EditableDatasourcePanel` |
| 239–367 | `DatasourcePreviewPanel`, which makes 3 direct calls |
| 368–412 | `CollapsibleSection`, `VariablesPanel` |
| 413–508 | `RunDialog`, `SaveAsDialog` |
| 509–721 | `DebugPanel` |
| 722–1,300 | `ProcessEditor` state, Monaco mount, regions, run, error log, save/save as/create, breakpoints, check, debug run |
| 1,300–1,380 | conflict banner/diff, help, dialogs |
| 1,381–1,585 | section tabs and the action toolbar |
| 1,586–1,633 | collapsible datasource, preview, variables and parameter sections |
| 1,634–1,726 | run output, `__RUN_LOG` and the TM1 error log panel |
| 1,727–1,841 | Monaco editor, history, snippets, debug and issues side panels |

Direct calls to move:

| Line | Call | Where |
|---|---|---|
| 269 | `post /api/view/preview-records` | datasource preview, cube view |
| 272 | `get /api/subset/elements` | datasource preview, subset |
| 277 | `request /api/files/content` | datasource preview, ASCII file |
| 1058 | `get /api/process/errorlog/content` | Error Log button |
| 1111 | `post /api/process/check-references` | after a successful save |

Repeated logic to pull out once: building `sections` from `edits` plus `data` (save,
check-references and debug run each do it), and building the run parameter array.

## Target

```
client/src/components/process-editor/
  ProcessEditor.jsx          shell (under 400 lines)
  ProcessToolbar.jsx         section tabs + actions (today 1,381–1,585)
  RunOutputPanel.jsx         status bar, __RUN_LOG, TM1 error log
  DebugPanel.jsx
  panels/                    ParamsPanel.jsx DatasourcePanel.jsx DatasourcePreview.jsx
                             VariablesPanel.jsx CollapsibleSection.jsx
  dialogs/                   RunDialog.jsx SaveAsDialog.jsx
  hooks/                     one concern per hook:
    useProcessEdits.js       edits, paramEdits, dsEdits, markDirty, current value per section
    useProcessMonaco.js      mount, completions, decorations, regions menu, minimap, undo/redo, jump to line
    useProcessRun.js         run dialog, run output, __RUN_LOG, error log load
    useProcessSave.js        save, save as, create new, conflict state, check-references
    useProcessDebug.js       watches, breakpoints, capture-when, debug events, debug run
    useProcessCheck.js       Check button, issues panel results
client/src/lib/process-editor/   pure functions, no React
  constants.js  sections.js (sections from edits+data, run param array)
  ascii-preview.js (lines → columns/rows by delimiter and header count)
  debug-result.js (debug response → issues list, unknown-watch check)
```

- No file over 600 lines. A single JSX panel that genuinely can't be split without changing
  behaviour may go over; record the exception in the DONE file.
- `EditorPane.jsx` imports `@/components/process-editor/ProcessEditor`. No re-export shim is left
  behind.

## Steps

1. **Pure functions + tests.** Move the constants and the repeated logic into
   `lib/process-editor/`. Test them with plain objects:
   - sections from edits+data, where an edited section wins and an empty section becomes `''`;
   - the run parameter array, where a missing value falls back to the process default;
   - ASCII parsing with and without a header and with a `;` delimiter;
   - debug result → issues;
   - the unknown-watch check, which is case-insensitive.
2. **Panels and dialogs.** Move `EditableParamsPanel`, `EditableDatasourcePanel`,
   `CollapsibleSection`, `VariablesPanel`, `RunDialog`, `SaveAsDialog` and `DebugPanel` to their
   files. Keep their props identical. No state changes.
3. **Toolbar and run output.** Move the section tabs/actions JSX and the run output/log JSX into
   `ProcessToolbar.jsx` and `RunOutputPanel.jsx`, passing values and callbacks as props.
4. **The five calls behind hooks or factories.**
   - In `hooks/useApi.js`, lift `useSubsetElements` and `useViewPreviewRecords` into factories:
     `subsetElementsQuery` and `viewPreviewRecordsQuery`. The hooks then use them, with the same
     keys.
   - Add `errorLogContentQuery(server, filename)`, `fileContentQuery(server, name)` (returns
     text) and `useCheckReferences()` (a mutation).
   - The preview button and the Error Log button read with
     `queryClient.fetchQuery({ ...factory(...), staleTime: 0 })`, so a click always reads fresh,
     as it does today.
   - Check-references stays non-blocking and keeps swallowing its own failure.
   - **ASCII preview bug (fix it; it gets a `BUG_FIXES.md` line):** `request()` already throws on
     a non-2xx response, so the `if (!r.ok)` branch at line 278 never runs. A v11 user therefore
     gets the bare server error instead of "Reading server files needs Planning Analytics v12…".
     Catch the thrown error and show that message when the server's own message is empty or
     generic. Also delete the hand-built `x-ide-token` headers (line 248), because `apiFetch`
     already adds the token.
   - After this step, no `get`/`post`/`request`/`apiFetch` import remains anywhere under
     `process-editor/`.
5. **State into hooks.** Cut `ProcessEditor` along the six hooks above.
   - Keep effect order and dependencies exactly. If two effects depend on each other's order,
     keep them in the same hook and comment why.
   - `handleMount` registers completions once (`registeredRef`) and wires decorations and
     breakpoints. Keep that once-only guard.
   - The debug hook takes the current sections from `useProcessEdits`. Don't copy the edits state.
6. **Shell + docs.** `process-editor/ProcessEditor.jsx` under 400 lines. Update the CLAUDE.md
   Key Files entry (ProcessEditor becomes a folder, shaped like `view-editor/`) and
   `CONTRIBUTING.md`. Record the final files, hooks and calls, and anything not done.

## Rules

- One commit per step. Before each commit:
  - `npm test` passes;
  - `cd client && npm run build`, then commit `static/`;
  - client lint is at or below `client/lint-baseline.json`, and lower the baseline if the count
    drops;
  - root lint is 0.
- Do not push. Do not restart any server. Do not touch TM1.
- Any behaviour bug found while moving, other than the one in step 4, goes in
  `03_PROCESSEDITOR_SPLIT_QUESTIONS.md`, not into the split.

## When finished

`docs/ide/review/03_PROCESSEDITOR_SPLIT_FIXES_DONE.md`:
- one line per step, with its commit hash and test counts;
- lint before and after;
- the file and hook tables;
- the calls moved, and to which hook or factory;
- anything not done;
- the manual check list below.

## Manual check list for James

Only things the editor does today:

1. Open a process and switch the Prolog/Metadata/Data/Epilog tabs. Edit, then undo and redo.
2. Open the regions menu and jump to a region. Toggle the minimap and fold a section.
3. Edit a parameter and the datasource. Open Variables.
4. Preview each datasource type you have: a cube view, a subset, an ASCII file (on v11 the
   message should now name v12) and ODBC.
5. Run with parameters. Open the `__RUN_LOG`, then the TM1 error log after a failing run.
6. Save and check you get the reference warnings toast if there are any. Use Save As to a new
   name. Create a new process.
7. Edit the same process in two tabs, save one, and check the conflict banner and its diff.
8. Debug: add a watch, set a capture point on a line, set a capture-when condition, run, then
   jump from a captured event to its line.
9. Press Check and click an issue to jump to it. Open the snippets, history and help panels.
