# 03 — Split ProcessEditor (editor split 3 of 5)

Completed 17 Nov 2026. One commit per step. Behaviour is unchanged except the ASCII preview
error message fixed in Step 4. Effect order and dependencies are kept; see the note on the two
independent effects below.

| Step | Commit | Tests |
|---|---|---|
| 1 — Pure helpers and tests out | `83e060d` | 539 (538 pass, 1 skip) |
| 2 — Panels, dialogs and DebugPanel out | `5bcf44d` | 539 (538 pass, 1 skip) |
| 3 — Toolbar and run output out | `21fa98c` | 539 (538 pass, 1 skip) |
| 4 — Calls into factories/hooks; ASCII message fixed | `a668b94` | 539 (538 pass, 1 skip) |
| 5 — State into the six hooks | `1b3b32c` | 539 (538 pass, 1 skip) |
| 6 — Shell under 400 lines + docs | this commit | 539 (538 pass, 1 skip) |

Final: **539 tests, 538 pass, 1 skipped, 0 fail**. Client lint **118 → 116**; backend lint **0**.
`process-editor/ProcessEditor.jsx` is **354 lines**. Largest file is `useProcessMonaco.js` at 285
lines; no file needed the 600-line exception.

## Files

| File | Lines | What |
|---|---:|---|
| `process-editor/ProcessEditor.jsx` | 354 | shell: hooks, conflict banner, dialogs, sections, run output, Monaco, side panels |
| `process-editor/ProcessToolbar.jsx` | 214 | section tabs and the action row |
| `process-editor/RunOutputPanel.jsx` | 103 | run result, `__RUN_LOG`, TM1 error log |
| `process-editor/DebugPanel.jsx` | 217 | watches, capture-when, captured events |
| `process-editor/panels/ParamsPanel.jsx` | 70 | editable parameters |
| `process-editor/panels/DatasourcePanel.jsx` | 129 | datasource editor and CSV upload |
| `process-editor/panels/DatasourcePreview.jsx` | 135 | view/subset/ASCII/ODBC preview |
| `process-editor/panels/VariablesPanel.jsx` | 27 | variables table |
| `process-editor/panels/CollapsibleSection.jsx` | 19 | collapsible metadata section |
| `process-editor/dialogs/RunDialog.jsx` | 65 | run/capture parameter dialog |
| `process-editor/dialogs/SaveAsDialog.jsx` | 36 | Save As |
| `lib/process-editor/constants.js` | 23 | code tabs, labels, capture help, parameter type helpers |
| `lib/process-editor/sections.js` | 18 | sections from edits+data, run parameter array |
| `lib/process-editor/ascii-preview.js` | 24 | ASCII lines → columns/rows; v12 error message |
| `lib/process-editor/debug-result.js` | 17 | debug response → issues; unknown-watch check |
| `tests/process-editor-split.test.mjs` | 105 | 13 plain-object tests for the pure helpers |

## Hooks

| Hook | Lines | Owns |
|---|---:|---|
| `useProcessEdits.js` | 43 | edits, paramEdits, dsEdits, active section, `value`, markDirty, watch variables |
| `useProcessMonaco.js` | 285 | mount and one-time completions, decorations/capture glyphs, regions, minimap, undo/redo, jump |
| `useProcessRun.js` | 86 | run dialog/result, `__RUN_LOG`, error-log load |
| `useProcessSave.js` | 148 | save, Save As, create, conflict banner/diff, check-references |
| `useProcessDebug.js` | 96 | watches, breakpoints, capture-when, debug run/events |
| `useProcessCheck.js` | 50 | Check button, Issues panel results, Monaco markers |

`useProcessDebug` receives `edits` from `useProcessEdits` and builds the current sections with
`sectionsFromEdits`; there is no second copy of the edits state. The scroll-to-line effect and the
breakpoint-decoration effect stay in `useProcessMonaco` so their ordering against the mount and
breakpoint state is unchanged. The Ctrl+S listener lives in `useProcessSave`, which is called after
`useProcessMonaco`, so it now runs after the decoration effect rather than before it; the two
effects are independent (no effect reads the other's work), so behaviour is the same.

## Direct calls moved

| Old call | New owner |
|---|---|
| `POST /api/view/preview-records` | `viewPreviewRecordsQuery` + `queryClient.fetchQuery({ … , staleTime: 0 })` in `DatasourcePreview` |
| `GET /api/subset/elements` | `subsetElementsQuery` + `queryClient.fetchQuery({ … , staleTime: 0 })` in `DatasourcePreview` |
| `request /api/files/content` | `fileContentQuery` (returns text) + `queryClient.fetchQuery({ … , staleTime: 0 })` in `DatasourcePreview` |
| `GET /api/process/errorlog/content` | `errorLogContentQuery` + `queryClient.fetchQuery({ … , staleTime: 0 })` in `useProcessRun` |
| `POST /api/process/check-references` | `useCheckReferences()` mutation in `useProcessSave` (non-blocking, swallows its own failure) |
| `request /api/files/upload` (extra) | `useUploadFile()` mutation in `DatasourcePanel`; needed so no `request` import remains under `process-editor/` |

`useSubsetElements` and `useViewPreviewRecords` now use the same factories and keys as before. No
`get`/`post`/`request`/`apiFetch` import remains anywhere under `components/process-editor/`.

## Not done / notes

- All six steps are complete.
- No file needed the “over 600 lines” exception.
- The extra upload call is the only move outside the brief's five-call table; keeping it in the
  component would have left a `request` import under `process-editor/`.
- The empty-ASCII-file edge bug found while moving is recorded in
  `03_PROCESSEDITOR_SPLIT_QUESTIONS.md`, not fixed here (behaviour preserved).
- The ASCII preview fix is the only intentional behaviour change: on v11 it now names Planning
  Analytics v12 instead of showing a bare server error. Recorded in `docs/ide/BUG_FIXES.md`.

## Manual check list for James

1. Open a process and switch the Prolog/Metadata/Data/Epilog tabs. Edit, then undo and redo.
2. Open the regions menu and jump to a region. Toggle the minimap and fold a section.
3. Edit a parameter and the datasource. Open Variables.
4. Preview each datasource type you have: a cube view, a subset, an ASCII file (on v11 the message
   should now name v12) and ODBC.
5. Run with parameters. Open the `__RUN_LOG`, then the TM1 error log after a failing run.
6. Save and check you get the reference warnings toast if there are any. Use Save As to a new name.
   Create a new process.
7. Edit the same process in two tabs, save one, and check the conflict banner and its diff.
8. Debug: add a watch, set a capture point on a line, set a capture-when condition, run, then jump
   from a captured event to its line.
9. Press Check and click an issue to jump to it. Open the snippets, history and help panels.
