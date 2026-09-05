# Building TM1 models through the MCP

Read this before building a model from a requirements document. It is the method,
not the API reference — for the tool list see `MCP_SERVER.md`.

Accretive: every model built adds to the "What each build taught us" log at the
bottom. Learnings get sorted into one of three homes:

- **enforceable rule** → a check in `core/rules-lint.js` or `core/ti-lint.js` (the
  agent can't bypass it)
- **per-call nudge** → the `description` string of the relevant tool in
  `tools/tm1mcp/server.js` (seen on every call)
- **method / judgement** → this file

---

## The one principle

There are two questions about any model, and they need different answers:

1. **Is it written correctly?** — syntax, argument counts, section order. The
   linters and TM1's own `CheckRules` answer this. Cheap, automatic.
2. **Does it compute the right number?** — only a human plus `read_cells` against
   a known-good figure answers this. TM1 will happily return a confident wrong
   number with no error.

**So: for every worked example in the requirements document, add an assertion and
verify it with `read_cells` before closing the change set.** A build that passes
the linters and returns numbers is not a build that is correct.

---

## Get the dimensionality right first

Before any `build_cube`, settle the dimensions. Wrong dimensionality is the one
mistake you cannot lint your way out of and cannot cheaply fix later.

Signs you have a dimension missing and are about to encode it wrong:

- **Element names with a suffix that encodes a second attribute** — `Benefits
  North`, `Benefits South`; `Rent UK`, `Rent USA`. The suffix is a dimension.
  Model it as `Account × Entity`, not as `Account` with the entity baked into
  the name.
- **Parallel measures that are one measure times a type** — `Direct Input`,
  `Allocation`, `Fully Loaded` as three measure elements is usually one `Amount`
  measure and a missing `Method` / `Layer` dimension (or just rules).
- **A cube whose rules constantly parse the element name** (`SUBST`, `SCAN` on
  `!dim`) — the thing being parsed out wants to be its own dimension.

If the design needs another dimension, **create it — even if cubes must be
dropped and rebuilt.** Do not let build friction (an existing cube, a change-set
already open) push you into adding elements to the wrong dimension. Rebuilding a
cube is a 5-minute cost; a wrong grain is a rebuild of the whole model.

---

## Dimensions

- **Small and hand-listed in the doc** → `build_dimension` (elements, edges,
  attributes in one call).
- **Large, or sourced from a system** → a TI process (`build_process`) that loads
  from a datasource. Don't enumerate hundreds of elements as tool arguments.
- Element attributes: on v11 the rule/TI functions are 4-arg
  (`ElementAttrN(dim, hier, elem, attr)`) — the linters enforce this. The 3-arg
  legacy `ATTRN`/`ATTRS` also work and are simpler for single-hierarchy dims.
- You cannot create an element attribute on a zero-element dimension. Insert
  elements first.

---

## Rules and TI

- The linters catch argument counts, 3-arg `ElementAttrN`, `IF` nested past 2
  deep, TI attribute writes ordered before the element insert commits. They do
  **not** catch wrong logic. Reading numbers back does.
- Flatten `IF` past two levels into helper measures — three-deep silently returns
  blank on this engine.
- In TI, structure goes in Prolog; attribute *values* go in the Epilog (Prolog
  inserts aren't committed until the Prolog ends).
- Feeders: don't feed a `DB()` whose target element is read from an attribute
  that might be blank — it feeds a non-existent element and fails at load.

---

## Views

- **Native for anything a human opens in the IDE** — input templates, standard
  reports, P&L layouts. The IDE's MDX-view axis parser is fragile with
  CROSSJOIN / ranges / filters; native views always render.
- **MDX only where the view genuinely needs set logic** native can't express, and
  you'll consume it via `execute_view` / the API rather than the IDE grid.
- Native axis entries take `subset:"Name"`, `members:[...]`,
  `memberSet:"leaf"|"root"`, or `customExpr:"<MDX set>"`.

## Subsets

- **Static `elements` list** when the membership is fixed and small.
- **`expression` (MDX set)** when it's rule-based — all leaves, top N, filter by
  attribute.

---

## Workflow

```
seed_baseline                     first — so the diff shows only what you build
start_change_set  "AI: <model>"
  … build dimensions, cubes, rules, processes, views …
  add_assertion   per worked example in the doc, AS YOU GO
run_assertions                    self-check before closing
close_change_set                  runs the assertions again, reports pass/fail
package_change_set                build the deployable
check_deploy_risk / check_target_drift   against a target
                                  → a human does the actual deploy
```

Narrate each step. Don't go dark for twenty tool calls — report what was built
and what the numbers came back as.

---

## v11 landmines (most are lint-enforced)

See `MCP_SERVER.md` → "Notes & limits" for the full list. The ones that cost real
iterations:

- 3-arg `ElementAttrN`/`ElementAttrS` — parses fine, returns blank at runtime
- `AttrInsert` is 4 args, not 3
- TI Prolog element insert + attribute write in the same section
- 3-deep nested `IF()` returns blank
- element rename is not supported (`restructure_dimension` reports this honestly)

---

## What each build taught us

### OPX Allocations (Sep 2026) — first end-to-end MCP build

- **Wrong dimensionality.** Cost centres were built as `Benefits North Src` /
  `Benefits South Src` — subsidiary baked into the element name instead of a
  `Subsidiary` (or `Entity`) dimension. Also `Direct Input` / `Allocation` /
  `Fully Loaded` as separate measure elements where one `Amount` measure would
  do. This is a modelling competence failure, not a TM1 quirk — hence the
  "Get the dimensionality right first" section above. Likely cause: building
  cube-by-cube against an already-open change set made "add elements to the
  existing dimension" the path of least resistance over "introduce a new
  dimension and rebuild the cubes."
- 3-arg `ElementAttrN` returned blank for ~2 iterations → became a lint rule.
- TI built month elements in Prolog then wrote attributes on them in Prolog →
  "element not found" at runtime → became a lint rule; fix is attributes in
  Epilog.
- 3-deep `IF()` in the Direct Expense rule returned 0 with all inputs correct →
  flattened into helper measures.
- MDX views wouldn't render in the IDE → rebuilt as native. Native is now the
  default recommendation.
- ~175 tool calls, ~89 `read_cells` verifications. Checking was half the work and
  stayed manual.
