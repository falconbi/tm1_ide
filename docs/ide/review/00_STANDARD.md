# Code review 2026 — the standard

The IDE and the MCP server are a starting point for other TM1 developers to fork and build their
own. A reference codebase is read far more than it is run. So the test for every file is:

**Would a TM1 developer learn the right habits by copying this?**

That puts these first, in this order:

1. **One obvious way to do each job.** Add a route, add a TM1 call, add an editor, add a hook, add
   an MCP tool. Where two patterns exist, say which is right and where the other is used.
2. **Nothing half-built.** A smaller codebase that all works beats a bigger one with experiments
   left in. Name anything that only works on one lab server, is unreachable from the UI, or is
   superseded.
3. **Readable in an evening.** File size, function size, naming, comments that tell the truth.
4. **Honest docs and tests that teach.** Docs match the code. A newcomer can read a test and see how
   that part is meant to behave.
5. **Features last.** Judged by "what would make a developer want to fork this", not by count.

## How each area is reviewed

- One area per OpenCode run. Read-only: no code changes, no server restarts, no TM1 server other
  than TM1_Test_DEV, never TM1_CONSOL.
- Findings go in `docs/ide/review/<nn>_<AREA>_FINDINGS.md`. Plain English. One section per task in
  the brief. Each finding: **what**, **where** (`file:line`), **why it matters to a forker**,
  **suggested fix**, **effort** (small / medium / large). Worst first within a section. Say when you
  checked something and found nothing.
- Claude checks each findings file against the code, then the fixes are briefed separately.
  James decides what gets done.

## House rules to check against

`CLAUDE.md` (constraints, conventions, TI naming, the function catalog as the one source),
`docs/ide/FEATURES.md`, `docs/ide/SETUP.md`, `docs/deploy/DEPLOY_LIFECYCLE.md`,
`docs/ide/MCP_SERVER.md`, `SECURITY.md`.

## Decided at the start (16 Nov 2026)

- v11 is what matters now; v12 only gets a note where something is clearly v12-only.
- Security gets its own review, run by James, not part of these areas.
- `CLAUDE.md` is to be committed and shared, not gitignored.
- Playwright is not used and is to be removed.

## Areas

| # | Area | Status |
|---|---|---|
| 01 | Front door: README, CLAUDE.md, layout, setup, docs index | done — round 1 (5 commits, checked) |
| 02 | `server.js` and `core/` | done — round 1 + route split + core rename/logic move |
| 03 | Explorer and the editors (`client/src/components`, `hooks`, `store`) | round 1 + 2 done; ViewEditor, Cube Map, ProcessEditor, DimensionEditor and RulesEditor splits done; EditorPane is the dispatcher |
| 04 | Shared pivot (`shared/pivot`) and the grid | done — verdict + fixes round 1 (9 commits, checked) |
| 05 | Validators, formatter, function catalog, autocomplete (`client/src/lib`, `core/*-lint.js`) | done — round 1 (9 commits) + shared CJS/ESM convention settled (17 Nov) |
| 06 | Understanding the model: Cube Map, Runbook, trace, search | round 1 done (9 commits) + Cube Map split (6 commits); full scanner-index unification later |
| 07 | Change sets, assertions, deploy (`core/git-*`, `core/change*`, deploy components) | round 1 done (10 commits, checked); 7 live checks for James in 07_DEPLOY_FIXES_DONE.md; round 2 (model-owned discovery + first-pull analysis) to design |
| 08 | Admin: monitoring, server admin, users, catalog admin | done — round 1 (7 commits, checked); one admin rule (`core/admin_gate.js`), session/job list GETs left ungated by design |
| 09 | MCP server (`tools/tm1mcp`) | done — round 1 (8 commits, checked); 67 tools, inventory generated and tested |
| 10 | Lenses: kit, editor, app, patterns | done — round 1 (9 commits) + patterns round 2 (4 commits, checked); Workforce content moved to the model repo |
| 11 | Build, tests, lint, CI, docs | done — round 1 (7 commits) + backend lint burn-down (0 findings); CI matrix + static check proven on first push |
