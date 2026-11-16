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
| 01 | Front door: README, CLAUDE.md, layout, setup, docs index | findings written (Claude) |
| 02 | `server.js` and `core/` | verdict written; fixes round 1 done (5 commits, checked); routes split + core rename + logic move still to brief |
| 03 | Explorer and the editors (`client/src/components`, `hooks`, `store`) | round 1 done (9 commits, checked); editors split still to brief; ~100 direct fetches left for a later round |
| 04 | Shared pivot (`shared/pivot`) and the grid | done — verdict + fixes round 1 (9 commits, checked) |
| 05 | Validators, formatter, function catalog, autocomplete (`client/src/lib`, `core/*-lint.js`) | round 1 done (9 commits, checked); shared-module CJS/ESM convention open (see 05 QUESTIONS) |
| 06 | Understanding the model: Cube Map, Runbook, trace, search | |
| 07 | Change sets, assertions, deploy (`core/git-*`, `core/change*`, deploy components) | |
| 08 | Admin: monitoring, server admin, users, catalog admin | |
| 09 | MCP server (`tools/tm1mcp`) | |
| 10 | Lenses: kit, editor, app, Workforce pages | |
| 11 | Build, tests, lint, CI, docs | |
