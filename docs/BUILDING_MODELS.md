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

### Fixed house dimension order

Every cube uses the **same dimension order**, deliberately *not* re-tuned per cube
for sparsity. There is a sparsity-optimal order for any given cube; we don't chase
it. A predictable order across every cube is worth more — views and subsets line
up, cross-cube reading is easier, and rules are easier to follow.

```text
Period, Version, Company, Cost Centre, Account, Type, <cube-specific dims>, Measure
```

- Use whichever of the leading dimensions the cube actually has, in that order.
- Any dimensions unique to this cube go after `Type` and before the measure
  dimension.
- The measure dimension is always last (see below).

### Every cube has a measure dimension, and it goes last

No exceptions. The last dimension of every cube is its measures, named
`<Prefix> <Cube distinctive name> Measure`:

- `WFP Workforce Cost` → `WFP Workforce Cost Measure`
- `WFP Headcount` → `WFP Headcount Measure`
- Reference-data cubes too: `WFP FX Rates` → `WFP FX Rates Measure` (with a
  `Rate` element); `WFP Tax Bands` → `WFP Tax Bands Measure` (`From`, `To`,
  `Rate`, …).

A dedicated per-cube measure dimension (not a shared one) keeps each cube's
measures self-documenting, keeps rules unambiguous about which measure they
target, and gives every cube an obvious axis for its default view.
`build_cube` refuses a cube whose last dimension name doesn't end in
`Measure`/`Measures`.

**Default element format is `#,##0.00`** — numeric, thousands separator, 2 dp.
Every measure dimension gets a `Format` element attribute and `build_dimension`
sets each numeric element to `#,##0.00` automatically. Override per element where
that's wrong: `0.00%` for ratios/percentages, `#,##0` for headcount/counts, more
decimals for FX and unit rates. Pass the override as a `Format` attribute value
in the same `build_dimension` call.

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

### Version dimension — calculating vs static

A version has one of two roles at any time, carried on a `Version Type` string
attribute:

| `Version Type` | Behaviour | Members |
|---|---|---|
| `Calculated` | live, fully rule-driven, carries **its own complete set of assumptions** | `Budget` (while being built), `Forecast` (the working current model), scenarios (`Downside`, …) |
| `Static` | fixed; carries no rule; holds only what a snapshot process wrote | `Actual`, budget snapshots (`Budget FINAL`), monthly forecast snapshots (`FCST 2026-01`, …) |

The static members sit under one consolidation parent (`Non-Calculating`) so a
single rule guard can hold them — see the non-calculating landmine below.

Rules:

- **A snapshot is a new Version member** — not a separate dimension or cube. Every
  existing view, subset and report then works on it unchanged, and analysis stays
  in the same cube. At month-end close, a TI copies all `Forecast` leaf cells into
  a new static member; `Forecast` itself rolls forward.
- **Assumption encapsulation** — no `Calculated` version's rules read another
  version's assumptions or drivers. The **only** permitted cross-version read is
  **prior-period `Actual`** (closed-month values, or a driver keyed on actual
  history), and it comes in as a rule (`['Forecast'] = N: IF(closed, DB(…Actual…),
  STET)`), never a copy.
- **Cube rules target `Calculated` members**, so `Static` members are never
  overwritten by a recalculation. Either scope the rule area to those members
  explicitly, or guard on the `Non-Calculating` parent (see the landmine below).
- Cross-version coupling (e.g. "`Forecast` open months = the `Working` version")
  causes feeder traps and version-agnostic reference bugs, and makes a version
  impossible to reason about alone. Don't.

### Variance as version members

- **Variance is a version member, not a new cube or dimension.** Add a calculating
  `Variance` folder (weight-0 edges so its total is inert) with members like
  `Act vs Bud` = `DB(…,'Actual',…) − DB(…,'Budget',…)`, `Fcst vs Bud`,
  `Var FX` / `Var Operational`. Every existing view/report then does variance by
  picking the member — zero rework.
- **Gate the actuals-only variance** (`Act vs Bud`) to closed periods — a
  `WFP Period` "Actuals Closed" numeric attr set by the actuals load. Otherwise
  open months read `0 − Budget` as a huge favourable swing, and it's wrong at FY.
  Use `Fcst vs Bud` for the full-year outlook (Forecast already carries Actual in
  closed months).
- **Put the variance rules ABOVE the currency-translation rule.** The variance
  members have no FX rate of their own, so the P5-style `['Reporting'] = Σ ccy ×
  DB(FX, !Version, …)` returns 0 for them. First-match-wins → the variance rule
  must be earlier so it computes `Actual/Reporting − Budget/Reporting` directly.
- **FX vs operational split:** `Var FX` = Actual at actual rate − Actual at Budget
  rate; `Var Operational` = Actual − Budget both at Budget FX. They sum to the
  total variance because Budget's two currency views are equal by definition.
- **Closed-month = Actual creates "zombies"** when the forecast roster isn't kept
  current: someone who left shows present (actual) → gone (actual) → back (stale
  plan for open months). That's realistic and exactly what the variance layer is
  for — flag it, don't paper over it in the actuals load.
- **Stock measures (Headcount, FTE) sum over YTD / quarter / FY rollups** — a YTD
  headcount is headcount-months, not period-end. The *variance* is still correct
  (−1 vs −1); the absolute needs a period-end aggregation rule if it matters.

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
- **A ratio KPI at a consolidation (cost per FTE, etc.) is painful under
  SKIPCHECK.** The rule computes `Amount / FTE` at every level, but a rule cell
  that *overrides* a consolidation needs that consolidated cell explicitly fed —
  feeding the leaves doesn't help (and their sum is the wrong number anyway). An
  over-feed for every entity/CC/department combo isn't worth it. Compute the ratio
  in the view / reporting layer instead, or accept it only at leaf level.
- **A one-off payment in a month with no base pay** (severance the month after a
  leaver's last month) is missed if `One-Time` cost is fed only from the salary
  driver (`_Monthly Base Full`, which is 0 that month). Feed the `One-Time` cost
  cell directly from the `One-Time Amount` input.

### House rules (from the Cubewise best-practice papers, still current)

- **Update a dimension, never Recreate.** Recreate drops any element missing from
  the new load *and its historical cube data*, silently and unlogged. Incremental
  `add_elements` / `restructure_dimension` are Update-style — keep it that way; a
  full rebuild only from a datasource that is authoritative for every element.
- **Zero the target region before an accumulating write.** A load that adds to
  the existing cell (`CellGetN` + add, or datasource "accumulate") double-counts
  on re-run. Our seeds write absolute values, so this only bites if a process
  ever switches to accumulate — clear the slice first (view + `ViewZeroOut`-style)
  in the Prolog.
- **Cube logging off during a bulk write must be guaranteed to come back on.**
  `CubeSetLogChanges(cube, 0)` is the speed lever, but if a fatal error in Data
  skips the Epilog the cube is left unlogged (crash = silent data loss until
  someone notices). Restore in the Epilog *and* either run it as a 3-step chore
  (off / load / on) or add a startup check that re-enables logging.
- **TI data sources are process-specific temp views/subsets, built in the Prolog
  and destroyed in the Epilog.** Never point a process at `Default` or a
  reporting subset — someone will change it and the process silently reads the
  wrong slice.

### Bespoke vs library (Bedrock)

- **Model logic ships bespoke.** Snapshot / version copy / close / allocations /
  recalc chains — anything scheduled, assertion-backed, or part of what the model
  produces — is a short purpose-built process shaped to *this* model's known
  cubes. It has to be reviewable in a change set, lintable, and testable. A
  generic library process (Bedrock `}bedrock.cube.data.copy` is ~2,200 lines, 35
  params, 27 dims hand-unrolled, and ships with a real copy-paste bug on the
  `v24` line) is none of those things.
- **Bedrock is a dev/admin toolbox**, not application code: ad-hoc region clears,
  one-off copies, view→file exports, dimension surgery while building. Fine to
  keep on the server; don't wire it into a chore.
- **The reusable technique from Bedrock's copy:** a **cube-view datasource** for
  the read (never nested `DIMNM`/`CellGetN` loops — those walk every empty
  intersection) plus **`CubeSetLogChanges(cube, 0)` around the write** (restore in
  Epilog). That combination is the speed, not the ASCII round-trip — exporting to
  a flat file and re-importing only pays off for cross-server copies or
  file-split parallelism. A view datasource also hands you `NValue` **and**
  `SValue`, so numeric and string cells copy in one pass.

---

## Views

- **Every cube gets a default view. Every dimension gets a default subset.** No
  exceptions — a cube or dimension with nothing to open is not finished. Name
  them `Default` (or set the cube's default view). Dimension default subset is
  usually all leaves, or all members if the consolidations matter.
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

Each model gets its own server (e.g. `DEV_A`). Baselines are per-server
(`.tm1baseline/<server>.json`), so builds on different servers don't interfere.
Seed once at the start; re-seed only after a deploy, when starting the next version.

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
- **static subset save APPENDS.** `PATCH .../Subsets('X')` with
  `Elements@odata.bind` adds to the existing members, it doesn't replace them —
  re-running a subset seed accumulates duplicates. Rebuild with
  `SubsetDeleteAllElements` then `SubsetElementInsert` in a TI.
- `SubsetCreatebyMDX` silently no-ops — use `SubsetCreate` + a
  `SubsetElementInsert` loop.
- `CubeProcessFeeders` is the only feeder-recalc that works — `tm1.CheckFeeders*`
  / `tm1.CheckFeedersOfCell` (Architect "Check Feeders") 404 on this build.
- **Stopping calc for a group of versions (non-calculating / static).** A bare
  `['<consolidation>'] = N: STET;` does **not** hold — the calc rules below still
  fire. The guard that works, first after `SKIPCHECK`:
  `[] = N: IF(ELPAR('<Version dim>', !<Version dim>, 1) @= '<non-calc parent>', STET, CONTINUE);`
  A rule *area* can't test a parent/attribute — only the RHS can. `CONTINUE` is a
  valid keyword. Put the non-calc versions under one consolidation parent.
- **`DimensionElementComponentAdd` in a TI Prolog is not committed until the
  Prolog ends** (the non-`Direct` form). A process that creates a member, parents
  it with `DimensionElementComponentAdd`, then writes its cells (where the
  parent's rule guard should permit the write) must do the writes in the
  **Epilog**. Or use `DimensionElementComponentAddDirect` (v11 has it — see
  `WFP Load Positions`), which commits immediately, same as
  `DimensionElementInsertDirect`.
- **A parse-a-delimited-string loop (`WHILE(SCAN('~', v) > 1)`) skips the LAST
  record** if it has no trailing `~`. Always end the string with the delimiter.
  `WFP Load Positions` silently dropped its final roster row for months this way.
- **First matching rule wins, not last.** When two rule areas overlap on a cell,
  TM1 uses the one defined *earlier* in the file. So a broad component rule
  (`['Base'] = N: …`, area = one Pay Component element, every measure) beats a
  later measure rule (`['Amount Capex'] = N: …`, area = one Measure element, every
  pay component) on the cell they share — the new measure just inherits the
  component value. Fix: put the narrower/override rule **above** the broad one,
  and have it `CONTINUE` for the cells it doesn't own. Verify by reading one
  overlapping cell back — the symptom is "every measure returns the same number".
- **A measure-only rule area (`['<measure>'] = N:`) fires at consolidated cells of
  the *other* dimensions too**, silently replacing their natural roll-up. A
  per-leaf calc (capex = amount × a cost-centre rate) must gate on
  `ELLEV('<dim>', !<dim>) = 0` for every other dimension and `CONTINUE` otherwise,
  or the consolidated totals come back wrong (e.g. capitalised only at the leaf,
  zero at every parent).

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

### Workforce Planning — Phase 1 (Sep 2026) — second MCP build

- **Clean first pass — 16/16 assertions on the first `run_assertions`.** No
  wrong-number iterations. Differences from OPX: dimensionality agreed and
  written up in full (`WORKFORCE_MODEL_PLAN.md`) before any `build_cube`;
  helper measures for the proration logic kept every rule ≤1 IF deep; guards
  written as one compound `IF(cond1 & cond2, expr, 0)` not nested.
- **`STR()` in TI fails on this engine** — `vYr = TRIM( STR( nYear, 12, 0 ) );`
  → "invalid numeric expression". `STR` is a *rules* function; TI wants
  `NumberToString` / `NumberToStringEx`. Worked around by building the small
  fixed period dimension declaratively. → candidate ti-lint rule: flag `STR(`
  in TI code.
- **Parse-a-delimited-string-in-TI** works well for loading a roster / rate
  table without a datasource file: `~`-delimited records, `;`-delimited fields,
  repeated `SCAN`/`SUBST`. `DimensionElementInsertDirect` + immediate `AttrPutS`
  in the Prolog (Direct commits, so no Prolog-timing problem).
- The attribute-fed-feeder lint warning fired on
  `['FTE'] => DB(..., ATTRS(pos,'Home Entity'), ATTRS(pos,'Cost Centre'), ...)`
  — acceptable here because the loader `ItemReject`s any position whose
  entity/CC don't resolve, so the attributes are never blank.

### Workforce Planning — Phase 1 rev B (Sep 2026) — design review + rebuild

- **First build passed 16/16 assertions but was still wrong.** A design review
  found 7 foundational gaps (Version not Scenario, currency + FX, headcount as an
  output, salary as input not attribute, employment type, multi-year period,
  **progressive banded taxation**). Passing assertions ≠ a correct model — the
  assertions only check what you thought to check. The reviewer (domain expert)
  caught what the build missed.
- **`Group` is ambiguous when it's a member of two dimensions** — Entity *and*
  Currency both had `Group`. `['Group', 'Base'] = ...` → "Element name ambiguous".
  Rules can't disambiguate by dimension in the area. Fix: rename one (currency
  member → `Reporting`). → worth a lint check: flag an element name that exists
  in more than one dimension used by the same cube.
- **Progressive tax needs a YTD roll-forward even in "Phase 1".** Annual
  thresholds/caps mean `tax[month] = f(cumulative_YTD) - f(cumulative_prior)`.
  The 4-band walk is `Σ MAX(0, MIN(ytd, To_b) - From_b) * Rate_b` — flat, no IF
  nesting, unused bands (To=From=Rate=0) contribute 0. YTD resets at the FY
  boundary via `SUBST(!period, 6, 2) @= '01'`.
- **Reporting-currency translation as a rule area**: `['Reporting', 'Base'] = N:
  Σ DB(self, <ccy>, 'Base') * DB('FX Rates', <ccy>, ...)`. Place it *before* the
  local-currency `['Base']` rule so the more-specific area wins.
- Rebuild cost: ~70 objects, one change set, ~2 hours. Deleting + recreating was
  cleaner than surgical edits given Period, Pay Component, and all cubes changed.

### Workforce Planning — Phase 1 rev C (Sep 2026) — employee income tax / gross-to-net

- **Recreating a cube breaks the feeders from other cubes into it.** After
  `delete_object` + `build_cube` on `WFP Workforce Cost`, every leaf computed
  fine on a direct read but all consolidations returned 0 — the
  `WFP Workforce Input ['FTE'] => DB(WFP Workforce Cost, …)` feeder was dead.
  Re-applying the source cube's rules did **not** fix it. Fix: a TI running
  `CubeProcessFeeders('WFP Workforce Cost')`. **Always run CubeProcessFeeders on
  any cube you recreate, and on cubes that feed into it.** Keep a
  `<prefix> Reprocess Feeders` process in the model.
- **Progressive tax generalises cleanly**: one `WFP Tax Type` axis on the bands
  cube (`Employer Payroll Tax` / `Employee Income Tax`), the same 7-band YTD walk
  with the type as a parameter. Employee income tax verified against real
  NZ/UK brackets to the cent.
- Pay Component split into `Cost to Company` (C) and `Employee Deductions` (C),
  with `Gross Pay` and `Net Pay` as computed leaves
  (`Net Pay = Gross Pay − Employee Deductions`, referencing the consolidation
  directly in the rule).
- Contractor gate extends: no employer on-costs AND no employee PAYE / pension
  (a contractor invoices gross), so Net = Gross for them.
- **Default subset / view compliance** — a TI loops the model dimensions and
  builds a `Default` subset (all members) on each; a `Default` native view on
  each cube. `SubsetCreatebyMDX` silently no-opped on this engine — use
  `SubsetCreate` + a `SubsetElementInsert` loop.

### Workforce Planning — Phase 1 rev D (Sep 2026) — house conventions retrofit

Retrofit of three model-wide conventions onto a finished, assertion-green model:
per-cube measure dimension last, fixed house dimension order, default `#,##0.00`
element format. All six cubes dropped and rebuilt.

- **A coordinate-only rewrite is safe if you keep every element name identical.**
  Renaming the four "item" dims to `<Cube> Measure`, adding two new measure dims,
  and reordering cube dimensions touched ~40 `DB()` calls and ~25 rule areas —
  but because element names never changed, rule *areas* (`['Reporting', 'Base']`)
  needed no edits at all; only positional `DB()` argument lists were remapped.
  19/19 assertions green on the first `run_assertions` after the rewrite.
- **Rule areas are matched by element name, not dimension position** — so a
  single-element measure dim (`WFP Workforce Cost Measure` = just `Amount`) costs
  nothing in the calc rules; every `['Base'] = N: …` still resolves to Base ×
  Amount. Only `DB()` self-references have to carry the `'Amount'` coordinate.
- **YTD prior-period self-references survive a dimension reorder** provided the
  `ATTRS('WFP Period', !period, 'Prior Period')` term lands in the new Period
  slot. Verified with a *sum-of-12-months = FY* assertion, which catches a
  mis-placed self-ref coordinate that a single-period check would miss.
- **Every cube gets a measures dimension, last — no exceptions.** This is
  standard TM1 practice. A cube with one measure today (`WFP Workforce Cost
  Measure` = `Amount`) still gets the dimension: it is the extension point for
  the next measure, it keeps every cube's shape uniform, it gives the default
  view an obvious axis, and `build_cube` enforces it. Don't skip it just because
  the account dimension already carries the line structure.
- Seed-TI rewrite is the fiddly part: every `CellPutN` argument list is
  positional and has to be re-ordered to the new cube shape. Dims whose position
  didn't change (Tax Bands: Jurisdiction, Tax Type, Band, Measure) needed no
  edit.
- Rebuild cost: 39 change-set objects (92 in the release package), one change
  set, ~1 hour — cheaper than rev B because the logic was already correct and
  only coordinates moved.

### Workforce Planning — Phase 2 (Sep 2026) — versions & assumptions

- **A calculating version needs its downstream cells fed explicitly.** A
  `['Forecast'] = N: IF(cutoff, Actual, Working)` rule computes fine on a direct
  leaf read, but every consolidation over it read 0. `!WFP Version` feeders
  (`['FTE'] => DB(cube, !WFP Version, …)`) only ever fire for versions that have
  an *input* FTE cell — Forecast never does. Fix: feed the Forecast targets from
  a version that is always populated — `['Working', 'FTE'] => DB(cube, 'Forecast',
  …)` — a literal target, not `!WFP Version`.
- **Reference cubes that carry a `Version` dimension but hold version-agnostic
  data are a trap.** `WFP FX Rates` and `WFP Pay Rates` are keyed by Version; the
  engine reads them at `!WFP Version`. A new version (`Forecast`, a scenario)
  reads blank there until the seed is re-run for it — and the symptom is a
  silently-short consolidation, not an error. Either drop `Version` from the
  cube, or read at a fixed version in the rules, or (stopgap) loop **all** leaf
  versions in the seed (`DIMNM('<Version dim>', n)` not a hard-coded
  `'Budget|Working|'`).
- **Can't `CellPutN` to a consolidation.** `WFP Entity` has `Group` (C); seeding
  assumptions looped `Group` → "Cell type is consolidated". Write leaf entities
  only; rules read at a leaf (the position's Home Entity).
- **Neither `tm1.CheckFeedersForRules` nor `tm1.CheckFeedersOfCell` exists on
  this v11** — `check_feeders` / `trace_feeders` both fail. Only
  `CubeProcessFeeders` (the TI function) works. Diagnose under-feeding by reading
  the consolidation one level at a time (single position → position total →
  entity total) to find where it drops to 0.
