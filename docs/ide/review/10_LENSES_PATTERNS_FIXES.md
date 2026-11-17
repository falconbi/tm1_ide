# 10 — Lenses round 2: patterns, and model content out of the IDE repo

Build brief for OpenCode. Agreed by James 17 Nov 2026.

**The decision:** the Lenses in `shared/lens-examples` are **patterns**: worked demonstrations of
how a kind of screen is built from the toolkit, for the AI and a developer to learn from. They are
not templates (dropped 20 Oct: "every client has a unique process") and not examples to copy.
Never call them "examples", "templates" or "frames" anywhere: code, UI, docs, MCP tool names or
descriptions. `lenses/workforce` is content for the Workforce model, not part of the IDE.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), root and client lint at or below their baselines,
  `cd client && npm run build` and commit `static/` when `client/src` or `shared/` changed.
- Do not push. Do not restart any server. Do not touch TM1.
- Questions go in `docs/ide/review/10_LENSES_PATTERNS_QUESTIONS.md`, never into guesses.

## Step 1 — Rename examples to patterns

- `shared/lens-examples/` → `shared/lens-patterns/` (`git mv`, keeps history).
- `core/lens_examples.js` → `core/lens_patterns.js`: `listPatterns()`, `readPattern(name)`.
- Routes: `/api/lens-examples` → `/api/lens-patterns` (and `/:name`). No alias for the old path.
- MCP: `list_lens_examples` → `list_lens_patterns`. Its description: "List the Lens patterns —
  worked demonstrations of how each kind of screen is built from the toolkit (…). Pass name to
  read one pattern's code. Learn from them; never copy one: build each Lens for the client's own
  process from the toolkit components." Update `guard.js` `READ_TOOLS`, the generated tool table
  (`node tools/tm1mcp/tool-table.js --write`), `MCP_SERVER.md` and every test that names it.
- Each pattern's JSON: the `example` key becomes `sample` ("a sample config, shown against
  24Retail") — update every reader.
- Tests: rename `tests/lens-examples-*.test.js` to `lens-patterns-*` and fix what they load.
- Grep the whole repo (excluding `node_modules`, `static/`, `docs/ide/review/`) for
  `lens-examples`, `lens_examples`, `listExamples`, `readExample`, `example Lens`, `Lens example`
  and fix every hit.

## Step 2 — The IDE stops copying patterns

`client/src/components/LensEditor.jsx` start page:
- Remove "Copy an example" and the `example:` branch of `startFrom` (and `meta.example` config
  copying).
- A new Lens starts **blank** (the existing default Lens), or **from one of your own Lenses**
  (keep that section, retitled "Start from one of your Lenses").
- Add a quiet "Patterns" section that opens a pattern **read-only** (a viewer tab or a modal with
  its code and description, plus a live preview if that already works without saving). It has no
  button that copies it into the model. One line of text under the heading: "How each kind of
  screen is built. Ask the AI to build yours from them."
- Keep the cancelled-request guard that stops a pattern's requests racing the real Lens.

## Step 3 — Workforce Lenses leave the IDE repo

- `git rm -r lenses/workforce` (the Lenses stay in TM1_Test_DEV, where they already live).
- Before deleting, copy the folder to `../wfp-lenses/` next to the repo (outside git, so James can
  move it into the Workforce model's own repo). Say the exact path in the DONE file.
- Remove every reference: `docs/lenses/` (the "worked example" paragraph area 10 step 9 added),
  README, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `.gitignore`, tests, CI. Replace the docs paragraph
  with one sentence: "A model's Lenses are model content: they live in the model, and their history
  belongs with the model, not in this repo."
- If `lenses/` is then empty, remove it.

## Step 4 — Docs say "pattern" and "Lens"

- `docs/lenses/*.md`, `README.md`, `docs/ide/FEATURES.md`, `CLAUDE.md`: "examples" → "patterns"
  wherever it means these files; "page" → "Lens" wherever it means a Lens. Leave historical
  decision text (dated paragraphs) as written, but add "(now called patterns)" the first time
  each historical paragraph says "examples".
- `CLAUDE.md` key-files tree: add `shared/lens-patterns/` with one line.

## When finished

`docs/ide/review/10_LENSES_PATTERNS_FIXES_DONE.md`: one line per step, commit hash, tests before
and after, lint counts, the path where the Workforce Lenses were copied, anything not done and why.
