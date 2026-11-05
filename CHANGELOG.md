# Changelog

A human-readable monthly summary of user-visible changes. For the complete,
dated bug-fix history, see [docs/ide/BUG_FIXES.md](docs/ide/BUG_FIXES.md).

## October 2026 — “From IDE to published app”

October is when Lenses moved from an idea to a working publishing layer. The
theme was deliberate: the IDE is where the model is built; Lenses are where it
is used. By the end of the month the same repository contained the model, the
editor, the Lens runtime and the deployment path.

### What changed

- **A real Lens app** — separate server, sign-in as the signed-in TM1 user,
  sandboxed viewer, model-owned Lens documents and a home page organised by
  business process.
- **A Lens toolkit** — `Lens` components for KPIs, trends, waterfalls, bars,
  grids, flow diagrams and more, bundled locally rather than loaded from the
  internet.
- **Write-back and control** — editable grids, checked writes, data reservations,
  end-of-session handback, run-process buttons and plain-English TM1 refusals.
- **Working together** — presence, live cursors, meeting mode, shared history,
  cell notes and a “Why this number?” story for any cell.
- **Lens configuration and access** — per-Lens config, themes, user/group access
  and a clean distinction between what a viewer sees and what a builder edits.
- **One shared pivot** — the View Editor and Lens pivot now use the same engine:
  drill-down, member picker, ALT H support and grid behaviour.
- **Line-item approval** — a reusable line form with cards, approve/reopen,
  calculated-field handling and a model-backed approval flow.
- **The Workforce model** — assignments, handover, position lifecycle, pay and
  FTE history, payroll tax, cost, headcount and matching built as a real model,
  not a mock. The 14 Workforce Lenses were rebuilt around that workflow.
- **MCP became real** — an external agent could build dimensions, cubes, rules
  and processes inside change sets; reads now run as the user, reads are masked
  where required, and write answers are auditable.
- **Governance** — change sets, assertions, releases, approval tied to a commit,
  deploy verification, drift checks and deploy history.
- **Quality** — Node 22 compatibility, a lint ratchet, more tests, and a dated
  bug-fix schedule.

### The outcome

A model can now be built in the IDE, published as Lenses, and released through
a governed path. The Workforce model is the proof, not a mock-up. Lenses remain
in development, but October established the shape of the product.

## November 2026 — “Trust the Editor” (in progress)

### Week of 1–6 November

November is deliberately a reliability month: the goal is that a TM1 developer
trusts what the IDE says. That means correct checks, readable traces, safe
source views and a debugger that explains failures instead of going quiet.

#### Cube Map

- Drill-down now behaves like browser history; revisiting a cube no longer
  truncates the trail.
- Back navigation no longer moves the map under the pointer and swallows clicks.
- Added **Simple mode** to hide the deploy process per server.

#### Rules editor

- Undo/redo via `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`, toolbar buttons and
  the keyboard-shortcuts panel.
- Fixed a false “missing semicolon” caused by an apostrophe in a comment inside
  a multi-line rule.
- Unclosed strings now report the line that actually broke, not a later quote.
- Static warnings are amber, not red; only errors fail Check.
- Fixed a race where an older Check response could restore an old squiggle.
- Added the new shortcuts to the help panel.

#### Trace

- Readable cell Trace: guards folded onto one line, the rule formatted, and the
  IF branch that applies marked.
- `DB()` coordinates resolved through nested `IF`, `DB` and `ATTRS` calls.
- Only coordinates that differ are shown; values to two decimal places.
- Added the worked calculation (Base × rate = result).
- Clicking a lookup follows it to its source; a stored input says it is the source.

#### TI editor and debugger

- Datasource preview for every source type: ODBC, ASCII, subsets and cube views.
- Cube-view preview reads the first records as the process sees them.
- Debug runs keep the datasource and variables, so Data sections actually run.
- A Data-section breakpoint is capped at 50 captures instead of stalling a large run.
- Debug works when the Prolog starts with `#Region` or a comment.
- Aborted runs surface the TM1 error log instead of returning nothing.
- Unknown watch variables are refused rather than silently aborting the run.
- Watches include parameters, datasource variables and variables assigned in code.
- Selecting a watch adds it immediately with its real type; Arrow keys and Enter work.
- Removed the misleading “Insert datasource block” toolbar button.

#### TI completion

- Snippet picker now honours Monaco tab stops.
- `CellPutN`/`CellGetN` cube completion no longer closes the call early.
- Cube selection fills dimensions from matching TI variables (`vVersion`,
  `vPosition`, `vEmployee`) or leaves placeholders when no variable exists.
- Element completion uses the correct cube argument and offers measures after
  the cube.
- Function-picker casing follows the Naming Dictionary (`CellPutN`, not
  `CELLPUTN`); `CellGetN`/`CellGetS` are CamelCase.

#### Views and source views

- Views over 5,000 rows now ask before drawing instead of freezing the browser.
- Views used as TI datasources are detected from the cached process scan.
- `WFP Assignment Base Src` opens as a read-only source preview with the first
  records, total row count and the processes using it.
- The full grid remains available behind an explicit confirmation.
- Temporary debug processes are excluded from source-view detection.

#### Quality

- Fixed Node 22 test discovery.
- Restored the lint ratchet to 133.
- Rebuilt static assets; CI and the Pages deployment are green.
- Updated the dated bug-fix schedule.
