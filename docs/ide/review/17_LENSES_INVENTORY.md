# 17 — Lenses: what we already have, before we design anything new

Brief for OpenCode. Date: 25 Nov 2026. Area: Lenses.
**When:** this is the next project after Deploy (briefs 14–16) is finished. Do not start it before
then.
**Design it feeds:** `docs/lenses/LENS_FRAMEWORK_IMPROVEMENT.md`, which is still a proposal.
Read sections 4.5, 5.4, 7 and open decision 8 first. They were added on 25 Nov: the AI assembles
Lens applications from a manifest, a two-tier service catalog, the UI follows what the user can
do, and plain input grids.
**Earlier review:** `10_LENSES_VERDICT.md` and its fix briefs. Say which of those findings are now
fixed and which are still open.

Rules for this brief: **reading only.** No code changes, no Lens saved, nothing written to TM1.
Plain English in the report. Ask James before anything that isn't written here. Nothing is pushed
to GitHub. Never restart the server.

---

## Why

The next Lens work hardens what we have and moves it towards the framework: services first, then a
manifest built around the existing patterns, then manifest checks, then the AI building pages from
manifests, with Workforce rebuilt as the proof case. Before anything new is defined, we need an
exact picture of what exists, so the design reuses it rather than building a second copy. This
follows the golden rule: reuse data, not silos.

## What to read

- `shared/lens-patterns/*.json` and `*.html`: the 10 page patterns
- `shared/lens-kit/` (`components.js`, `rows.js`, `index.js`): the components pages use today
- `shared/pivot/`: the shared pivot (`Lens.pivot`)
- `shared/lens-bridge.js`, `core/lens-bridge.js` and `lens-server.js`: what a page can call and
  what the server checks
- `core/lens-store.js`, `core/lens-deploy.js`, `core/lens-live.js`, `core/lens_patterns.js`,
  `core/lens-prefs.js` and `core/lens-activity-log.js`
- `routes/lenses.js` and `client/src/components/LensEditor.jsx`
- `tools/tm1mcp/tools/lenses.js`: what the AI can do with Lenses today
- the Workforce Lenses saved on TM1_Test_DEV, read through `list_lenses` / `get_lens`
  (read only), not the old copies in `tmp/`

## What to report

Write `docs/ide/review/17_LENSES_INVENTORY_FINDINGS.md` with these sections. For each claim, give
the file and line.

1. **Bridge calls.** Every call a page can make (for example `execMDX`, `writeCells`, `Lens.run`,
   `Lens.save`, meta, hierarchies, element tree), what it does, and what the server checks on
   each one: Lens access, groups, status, declared cubes and TM1 security.
2. **Services that exist under another name.** Which of the planned built-in services (section
   4.5: members for a picker, hierarchy under an element, attributes, default member) already
   exist as bridge calls or kit helpers. Note anything that could already serve as an app service.
3. **Components.** Every kit component and what settings it takes. Which ones have something like
   a contract today, and which take free-form options.
4. **Patterns as contracts.** For each of the 10 patterns: do `settings` and `sample` fully
   describe what the HTML actually reads? List any setting the HTML uses that the JSON does not
   declare, and the reverse.
5. **Workforce.** Count the pages. For each page, how many raw MDX strings and direct writes it
   has, and which business rules live in JS. Where do two pages answer the same question
   differently? This is the "17 pages" claim in the design: confirm it or correct it.
6. **Writes today.** Every way a Lens writes: cell writes, `Lens.save`, processes, comments. Which
   are plain input (open decision 8) and which carry business logic.
7. **Show vs can-do.** Does any page already hide a button or input based on the user's rights?
   How? (Section 7, 25 Nov point.)
8. **Validation today.** What is checked when a Lens is saved and when it is deployed, especially
   the missing-reference check.
9. **The 10_LENSES findings.** For each one: fixed, still open, or changed.
10. **Gaps against the design.** A short table with these columns: design item (by section
    number), what exists, the gap, and a rough size (small / medium / large). No proposals beyond
    one line each. James decides what is built.

Keep the report factual. Where something is unclear, say so. Do not guess.

## Done when

- The findings file exists with all ten sections, each claim with a file:line reference.
- Nothing in the repo or on TM1 has changed (`git status` shows only the new findings file).
- Claude checks the findings against the code and writes `17_LENSES_INVENTORY_VERDICT.md` before
  anything is designed or built.
