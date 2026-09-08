# Workforce Planning model — build plan

A position-based FP&A workforce model, built in TM1 through the MCP server,
in phases. Modelled on how Pigment / Anaplan enterprise workforce apps work.

- **Position-based**: the grain is the *position* (a seat / req). An employee is
  assigned to a position; a position can be vacant. Vacancies carry budgeted cost.
- **Phased**: each phase is one change set — build, assert, deploy — before the next.
- Built and verified against `read_cells` per `BUILDING_MODELS.md`.

Naming: every object is prefixed `WFP `.

> **Status (2026-09-06):** a first Phase 1 was built on `TM1_Test_DEV` and passed
> 16/16 assertions, then a design review found foundational gaps (see below). That
> build is **superseded** — Phase 1 is being re-specified and rebuilt on DEV
> before anything reaches PROD. Nothing has been deployed.

---

## Design review — 2026-09-06

Findings from reviewing the first build. Items 1–7 are dimensionality / grain —
they can't be cheaply retrofitted, so they go into Phase 1.

### Foundational — into Phase 1

1. **Version, not Scenario.** One generic `WFP Version` dimension. A "scenario" is
   just a version you add and name. Each version is either **calculating**
   (rule-driven, e.g. Forecast = Actual for closed months + Working for open) or a
   **fixed snapshot** (frozen copy). Needs: `Version Type` attribute
   (`Input` / `Calculated` / `Snapshot`); a `WFP Copy Version` process; a
   `Last Actuals Period` assumption for calculating versions.

2. **Currency is foundational, not Phase 6.**
   - Cost computed in each position's **salary currency** (defaults to the
     entity's local currency; `Salary Currency` attribute on Position).
   - `WFP FX Rates` cube — Currency × Period × Version × Rate Type
     (`Average` for P&L flows, `Closing` for balances).
   - Reporting-currency translation to the Group currency → the `Group` total.

3. **Headcount & FTE are outputs, not just cost.** The primary workforce metrics.
   The engine must output Headcount (filled positions), FTE, and open-position
   count alongside the cost components.

4. **Salary lives in the input cube, by Version × Period** — not a static Position
   attribute. Budget-version salary ≠ Actual-version salary; salary steps mid-year
   (merit, promotion). The Position attribute is a seed/default only.

5. **Employment Type** on Position — `Permanent` / `Fixed-term` / `Contractor` /
   `Intern`. Gates whether employer tax / pension / benefits apply at all.

6. **Multi-year Period.** Current + plan years, not FY2026 only. Requires the
   TI period-builder to work (blocked on `STR()` — see BUILDING_MODELS.md; use
   `NumberToString`).

7. **Progressive / banded taxation.** Flat `base × rate` is wrong.
   - UK Employer NI: 0% below the Secondary Threshold, 13.8% above.
   - US Employer SS: 6.2% up to the annual wage-base cap, then 0%; Medicare 1.45%
     uncapped; FUTA on the first band; state SUTA varies.
   - NZ ESCT banded by income; ACC capped.
   - Needs a `WFP Tax Bands` cube (Jurisdiction × Tax Component × Band ×
     {From, To, Rate}) and a `WFP Jurisdiction` dimension (tax jurisdiction ≠
     office location — country, sometimes US state).
   - **Progressive calc**: `tax += MAX(0, MIN(earnings, band_to) − band_from) × rate`.
   - **Annual caps make employer tax YTD-aware** — full rate until cumulative pay
     hits the cap, then zero. This pulls the roll-forward pattern (planned for
     Phase 2) into Phase 1 for the tax line. Pension (annual allowance / match
     tiers) likely the same.

### Open decisions — need James's call before rebuild

| # | Question | Options |
|---|---|---|
| A | Pay Rates keyed by Grade × Location — **also Job Family?** | A G3 Engineer and G3 Salesperson usually sit in different bands |
| B | **Annualisation convention** | `/12` flat, or working-days-in-month ÷ working-days-in-year. (Proration currently uses calendar days — should be consistent.) |
| C | **Employee dimension** — still deferred (incumbent = Position attribute), or build `WFP Employee` + assignment now? | |
| D | **Cost Centre** — 1:1 with Position via attribute for now (splits Phase 5)? | |
| E | **Jurisdiction** — new dimension, or a Location attribute? | Tax rules by jurisdiction; a UK-office role could be under a different tax regime |

### Correctly deferred to later phases

Merit / promotion / bonus / commission / equity / one-time (P3); hiring plan,
TBH positions, recruiting lead time, attrition, backfill, headcount bridge (P4);
GL account mapping, P&L cube, split allocation, shared-services allocation,
capitalised labour (P5); constant-currency view (P6); payroll actuals load,
rate/FTE/mix variance, cost per FTE, sensitivity (P7); contractor day-rate cube,
recruiting funnel, productivity ramp, rolling forecast (P8); manager / org
hierarchy on Position; validation cube; rounding convention.

---

## Phase 2 — Versions & Assumptions

Phase 1 built `WFP Version` but nothing uses it — `Budget` / `Working` /
`Actual` / `Forecast` are empty parallel copies. Phase 2 makes versions
mean something, and gives the model a home for planning drivers. One change
set. Merit / bonus stay P3; a scenario walkthrough is a demo, not a build goal.

**Task 0 — pipeline: package + replay element attribute values.** *(done —
commit `dab54a9`.)* The packager now captures `}ElementAttributes_<dim>` cells
and the deployer replays them greenfield-only. Needed because the
`WFP Assumptions Measure` `Format` values are declarative and wouldn't otherwise
deploy — the same gap Phase 1 hit with `WFP Period` / `WFP Job Family`.

### 1. `WFP Assumptions` cube

`WFP Period × WFP Version × WFP Entity × WFP Assumptions Measure` (house order).
Entity so a driver can be set at `Group` and overridden per entity.

| Measure element | Format | Use |
|---|---|---|
| `Merit Increase %` | `0.00%` | annual salary uplift at the review month (consumed in P3) |
| `Promotion Budget %` | `0.00%` | extra comp pool (P3) |
| `Inflation %` | `0.00%` | benefits / allowance escalation |
| `Actuals Cutoff Index` | `#,##0` | period index; `≤` this = Actual, `>` = Working (the Forecast blend) |
| `Vacancy Allowance %` | `0.00%` | haircut on open-req cost for expected slippage |
| `Standard FTE Hours` | `#,##0.00` | hours base for utilisation / hourly cost |
| `Bonus Pool %` | `0.00%` | % of base for the bonus accrual (P3) |
| `Employer Oncost Fallback %` | `0.00%` | used when a jurisdiction has no `WFP Tax Bands` row |

Seeded by **`WFP Seed Assumptions`** (delimited table, like the other seeds).

### 2. Forecast = calculating version

A rule area on `['Forecast']` in `WFP Workforce Input` (and it flows through the
engine): read the `Actual` version where
`ATTRN('WFP Period', !period, 'Period Index') <= DB('WFP Assumptions', !period,
'Forecast', <entity>, 'Actuals Cutoff Index')`, else read `Working`. Cutoff
comes from the assumptions cube so it can differ by entity (different close
calendars). `Actual` and `Working` stay plain input versions.

### 3. `WFP Copy Version` process

Parameters `pSource`, `pTarget` (+ optional `pFromPeriod` / `pToPeriod`).
Copies `WFP Workforce Input` (FTE + Base Salary) from source to target version.
Use it to freeze `Working → Budget`, or spin a named scenario off `Actual`.
Guard: refuse if `pTarget` `Version Type` is `Calculated` (don't overwrite a
rule-driven version).

### Assertions

- Forecast at the cutoff boundary month = Actual; the month after = Working.
- `WFP Copy Version` `Working → a scratch version` reproduces a spot FTE + salary.
- Assumption read-through: an entity override beats the `Group` value.

---

## Phase 3.5 — Version model correction

**Why now:** the version design James uses on every model is *encapsulated*
versions — each calculating version carries its own complete assumption set and
reads no other version except prior-period `Actual`. WFP currently violates this:
`Forecast` is a rule blending `Actual` + the **`Working`** version, which is what
caused every Phase 2 feeder trap (the `['Working','FTE'] =>` cross-feeds, the
version-agnostic reference-cube bug). Phase 4 adds a lot of new driver logic;
doing it on the blend structure means redoing it. Fix the version model first.
(Standing convention now in `BUILDING_MODELS.md` → "Version dimension —
calculating vs frozen".)

### Target `WFP Version`

| Member | `Version Type` | Role |
|---|---|---|
| `Actual` | `Frozen`¹ | loaded actuals (modelled until the Phase 7 payroll feed) |
| `Budget` | `Calculated` | built from **its own** assumptions; snapshot at lock |
| `Forecast` | `Calculated` | the working current model; closed months = `Actual` via rule, open months calc from **its own** assumptions |
| `Downside` | `Calculated` | a self-contained scenario — own assumptions, own input seed (not a copy of another version) |
| `Budget FINAL` | `Frozen` | snapshot of `Budget` at lock |
| `FCST 2026-01`, … | `Frozen` | monthly snapshot of `Forecast` at close |

`Working` is **removed** — `Forecast` takes its role. `Version Type` values change
from `Input`/`Calculated`/`Snapshot` to **`Calculated`/`Frozen`**.

¹ *Decision D1 — see below. Interim option: keep `Actual` `Calculated` until Phase 7.*

### Changes

1. **`WFP Workforce Input` rule.** Replace the `['Forecast'] = N: … Working …`
   blend with a **closed-month-only** override:

   ```tm1
   ['Forecast'] = N:
     IF( ATTRN('WFP Period', !WFP Period, 'Period Index')
           <= DB('WFP Assumptions', !WFP Period, 'Forecast',
                  ATTRS('WFP Position', !WFP Position, 'Home Entity'), 'Actuals Cutoff Index'),
         DB('WFP Workforce Input', !WFP Period, 'Actual', !WFP Position, !WFP Workforce Input Measure),
         STET );
   ```

   Open months fall through to `Forecast`'s **seeded** input (see 3).

2. **Feeders simplify.** The `['Working','FTE'] => … 'Forecast' …` cross-feeds go
   away. Each `Calculated` version feeds its own downstream cells from its own
   `FTE`; `Forecast` open-month `FTE` is now a real seeded input so `!WFP Version`
   feeding works normally. Closed-month `Forecast` still needs a feeder from
   `['Actual','FTE']`.

3. **`WFP Seed Workforce Input`** loops **every `Calculated` version**, each
   reading *that version's* `Merit Review Index` / `Merit Increase %` /
   `Promotion Budget %` / `One-Time Amount` from `WFP Assumptions`. Today it only
   writes `Working`. `Budget` seed stays flat (its assumptions are all zero), so
   every Budget-scoped Phase 1/2/3 assertion is unchanged.

4. **`WFP Assumptions`** gets a full independent row set per `Calculated` version
   (`Budget` all-zero-uplift, `Forecast` = today's `Working` assumptions,
   `Downside` = stress set). `WFP Seed Assumptions` extended accordingly.

5. **No cube-rule guard needed.** *(built differently)* Rather than guard the
   `WFP Workforce Cost` / `WFP Headcount` rules against `Frozen` versions, the
   snapshot copies the **input layer** (see 6); Cost + Headcount then recalculate
   for the frozen member to exactly the source picture and hold it while those
   inputs are untouched. A snapshot moves only if a *rule* changes — which is a
   governed change and shows as drift. Simpler, no ~25 rule edits.

6. **New `WFP Snapshot Version`** TI — params `pSource` (`Forecast`|`Budget`),
   `pTarget`. Refuses a non-`Calculated` source; creates `pTarget` (via
   `DimensionElementInsertDirect`) as a `Frozen` member; copies all leaf cells of
   `WFP Workforce Input` + `WFP Assumptions` + `WFP FX Rates` + `WFP Pay Rates`
   for `pSource` → `pTarget`. Run at close (`Forecast`) or budget lock (`Budget`).

7. **`WFP Copy Version`** kept for spinning a scenario off a base; its
   `Calculated`-target guard stays (snapshots go through `WFP Snapshot Version`,
   which sets the type *after* copying).

8. **Reference cubes keep `Version` (Decision D3 — resolved: keep).** `WFP FX
   Rates` / `WFP Pay Rates` are legitimately version-specific — Budget uses
   budget-rate assumptions, Forecast the latest spot/forward, Actual the realised
   rates; salary bands likewise differ Budget vs Forecast. The engine reading
   them at `!WFP Version` is correct. Consequence: `WFP Seed FX Rates` and
   `WFP Seed Pay Rates` must seed **every `Calculated` version**, and
   `WFP Snapshot Version` copies these two cubes too (freeze the rates the
   snapshot used). No structural change.

### Decisions needed

| # | Decision | Options |
|---|---|---|
| **D1** | *(resolved 2026-09-08 — DEFER to P7)* `Actual` stays `Calculated` (a modelled actual) until the Phase 7 payroll load, which loads real actuals at `Entity × Cost Centre × Pay Component` grain + position-grain FTE, derives effective-rate actuals into `WFP Assumptions[Actual]`, and calc-guards the cost rules for `Actual`. | — |
| **D2** | *(resolved 2026-09-08 — INPUT LAYER)* `WFP Snapshot Version` copies the input layer (`WFP Workforce Input` + `WFP Assumptions` + `WFP FX Rates` + `WFP Pay Rates`); Cost + Headcount recalculate for the frozen member from those and hold. Avoids ~25 cube-rule guards. Trade-off: a *rule* change moves old snapshots (governed, shows as drift). | — |
| **D3** | *(resolved 2026-09-08 — KEEP `Version`)* Reference cubes are legitimately version-specific; seeds populate every `Calculated` version, snapshot copies them. | — |
| **D4** | *(resolved 2026-09-08)* `FCST YYYY-MM` monthly forecast snapshots; `Budget FINAL` for the budget lock. | — |

### Assertions

- **Budget-scoped (≈19)** — unchanged; `Budget` stays `Calculated` with flat
  assumptions.
- **`Working`-scoped (`c33d544f`, `30d59fd0`, `314caff7`, `9d970581`, `339b190a`,
  `100f1252`)** — re-point to `Forecast`.
- **`Forecast`-scoped (`44897784`, `ab2b4816`, `6e0e7232`, `1c052eb7`)** — rebase:
  closed-month still = `Actual`; open-month now = `Forecast`'s own calc (same
  numbers if `Forecast` assumptions == old `Working` assumptions).
- **`100f1252` (copy fidelity)** — replace with a `Downside` self-contained-scenario
  check (a stressed assumption produces the expected flexed number).
- **New:** `WFP Snapshot Version Forecast → FCST 2026-XX` reproduces a spot
  `Forecast` Cost-to-Company, and that value does **not** move after a
  subsequent assumption change.

### Deploy

One change set. Fresh-target run order gains `WFP Snapshot Version` (only run at
close, not on a fresh build). Then deploy DEV → PROD through the pipeline as with
Phase 2/3.

---

## Decisions (2026-09-06)

| # | Decision |
|---|---|
| A | **Job Family is on the bands.** `WFP Pay Rates` = Grade × Job Family × Location × Period × Version × Rate Item. Seeded: grade/location base × per-family index (Engineering 1.10, Product 1.08, Sales 1.05, Marketing 1.00, Customer Success 0.98, Finance 1.00, People 0.98, IT 1.00, Admin 0.92, Leadership 1.15). |
| B | **`/12` flat base; partial months prorated by active calendar days ÷ days in month.** |
| C | **Employee dimension deferred.** Incumbent stays a Position attribute; a country move = reassign to a position in that country. |
| D | **Cost Centre 1:1 via Position attribute.** Entity + Cost Centre stay as dims on the engine cube (computed from attributes, guarded). Splits = Phase 5. |
| E | **`WFP Jurisdiction` is a small dimension**, an axis on `WFP Tax Bands` only. Position carries a `Tax Jurisdiction` attribute. Phase 1 members: `UK`, `US-NY`, `NZ`. |
| — | **Employer tax = one blended rate per jurisdiction, up to 4 bands, YTD-aware.** Separate SS / Medicare / FUTA / SUTA lines are a later refinement. |

## Cubes (Phase 1 rev D — house conventions)

House dimension order on every cube: **Period, Version, Entity, Cost Centre,
Account, Type, `<cube-specific>`, Measure** — measure dimension always last, named
`<Cube> Measure`. (See `BUILDING_MODELS.md`.)

| Cube | Dimensions (in order) |
|---|---|
| `WFP Pay Rates` | Period × Version × Grade × Job Family × Location × **WFP Pay Rates Measure** |
| `WFP Tax Bands` | Jurisdiction × Tax Type × Tax Band × **WFP Tax Bands Measure** |
| `WFP FX Rates` | Period × Version × Currency × FX Rate Type × **WFP FX Rates Measure** |
| `WFP Workforce Input` | Period × Version × Position × **WFP Workforce Input Measure** |
| `WFP Workforce Cost` | Period × Version × Entity × Cost Centre × Pay Component × Currency × Position × **WFP Workforce Cost Measure** *(engine)* |
| `WFP Headcount` | Period × Version × Entity × Cost Centre × Position × **WFP Headcount Measure** |

`WFP Workforce Cost Measure` holds a single element `Amount` for now — the cube's
line structure is `WFP Pay Component`, and the measures dimension is the standard
last dimension every cube gets, ready for the next measure.

- Engine computes in the position's **Salary Currency** (guard: `Currency = Salary
  Currency & Entity = Home Entity & Cost Centre = Cost Centre`).
- `Currency` member `Group` = translation: `[GBP]·fx + [USD]·fx + [NZD]·fx` (average rate).
- Entity `Group` + Currency `Group` is the consolidated reporting number.
- No separate reporting cube in Phase 1 — Entity/CC reporting is the engine's
  own consolidations. Phase 5 adds `WFP Personnel Cost` for split allocation.

## Dimensions (Phase 1 rev B)

| Dimension | Members |
|---|---|
| `WFP Version` | `Actual`, `Budget`, `Forecast`, `Working`; attr `Version Type` (`Input`/`Calculated`/`Snapshot`) |
| `WFP Period` | 2025 + 2026 + 2027, months → Q → H → FY; attrs `Period Index` (global 1..N), `Days In Month`, `Prior Period`, `FY` |
| `WFP Position` | consolidation Total → R&D/S&M/G&A → Department → leaves. Attrs: Department, Cost Centre, Location, Grade, Job Family, **Employment Type** (`Permanent`/`Fixed-term`/`Contractor`/`Intern`), **Salary Currency**, Home Entity, **Tax Jurisdiction**, Position Status, Start/End Period+Day, Incumbent Name, `Seed FTE`, `Seed Base Salary` |
| `WFP Entity` | `Group` (C) → UK Ltd, US Inc, NZ Ltd; attrs `Local Currency`, `Primary Location`, `Reporting Currency` (GBP) |
| `WFP Cost Centre` | `Total Cost Centre` → R&D / S&M / G&A → 11 leaves; attrs `Function`, `CC Name` |
| `WFP Currency` | `GBP`, `USD`, `NZD`, `Group` |
| `WFP Grade` | G1–G5 |
| `WFP Job Family` | Engineering, Product, Sales, Marketing, Customer Success, Finance, People, IT, Admin, Leadership; attr `Pay Index` |
| `WFP Location` | London, New York, Auckland |
| `WFP Jurisdiction` | UK, US-NY, NZ |
| `WFP Tax Band` | Band 1, Band 2, Band 3, Band 4 |
| `WFP Pay Component` | `Cost to Company` (C), `Employee Deductions` (C); leaves Base, Employer Payroll Tax, Employer Pension, Benefits, Gross Pay, Employee Income Tax, Employee Pension, Net Pay; engine helper leaves `_Start Index _End Index _In Window _Start Frac _End Frac _Active Fraction _Annual Salary _Monthly Base Full _Earnings YTD _Employer Tax YTD _Prior Employer Tax YTD _Employee Tax YTD _Prior Employee Tax YTD` |
| `WFP FX Rate Type` | Average, Closing |
| **`WFP Tax Bands Measure`** *(rev D, was `WFP Band Item`)* | Threshold From, Threshold To, Rate |
| **`WFP Pay Rates Measure`** *(rev D, was `WFP Rate Item`)* | Salary Min, Salary Mid, Salary Max, Pension Pct, Benefits Annual, Employee Pension Pct |
| **`WFP FX Rates Measure`** *(rev D, new)* | Rate |
| **`WFP Workforce Input Measure`** *(rev D, was `WFP Input Item`)* | FTE, Base Salary |
| **`WFP Workforce Cost Measure`** *(rev D, new)* | Amount |
| **`WFP Headcount Measure`** *(rev D, was `WFP HC Measure`)* | Headcount, FTE, Open Positions, `_End Idx`, `_Active` |

All measure dimensions carry a `Format` element attribute — default `#,##0.00`
(`0.00%` for Pct/Rate elements, `#,##0` for headcount counts).

### Employer tax — the YTD-aware progressive calc

```
_Taxable Earnings       = Base                                  (Phase 1: base only)
_Taxable Earnings YTD   = _Taxable Earnings + <prior period _Taxable Earnings YTD>
_Employer Tax YTD       = Σ over Band 1..4 of
                            MAX(0, MIN(_Taxable Earnings YTD, ThreshTo_b) - ThreshFrom_b) * Rate_b
                          where ThreshTo/From/Rate_b = DB('WFP Tax Bands', jurisdiction, Band b, ·)
_Prior Tax YTD          = IF(prior period = '', 0, <prior period _Employer Tax YTD>)
Employer Tax  (month)   = _Employer Tax YTD - _Prior Tax YTD
```

Tax band seed (Phase 1):

| Jurisdiction | Band 1 | Band 2 |
|---|---|---|
| UK | 0 → 9,100 @ 0.0 | 9,100 → 9,999,999 @ 0.138 |
| US-NY | 0 → 168,600 @ 0.09 | 168,600 → 9,999,999 @ 0.0145 |
| NZ | 0 → 139,384 @ 0.0139 | 139,384 → 9,999,999 @ 0.0 |

FX seed (all periods, Budget + Working) — rate = 1 unit of row currency in GBP:
GBP 1.0, USD 0.79, NZD 0.47, Group 1.0.

---

## Changelog

- *(2026-09-06)* Plan created; first Phase 1 spec (3 entities, 11 cost centres,
  18 positions).
- *(2026-09-06)* First Phase 1 built on `TM1_Test_DEV`, 16/16 assertions
  (change sets `e4970b57` + `371a8c0a`, engine + 6 views + 5 subsets).
- *(2026-09-06)* **Design review — first build superseded.** Version dimension,
  foundational currency + FX, headcount/FTE outputs, salary as input not
  attribute, employment type, multi-year period, progressive banded taxation
  (YTD-aware) all move into Phase 1. Cube structure split (engine at Position
  grain, separate `WFP Personnel Cost` reporting layer). Awaiting decisions A–E,
  then Phase 1 is re-specified and rebuilt on DEV.
- ti-lint: `STR()` in TI is now a lint error (Rules function, fails at run time).
- risk.js: no longer blocks a greenfield deploy on dimensions the package itself
  creates.
- *(2026-09-06)* **Phase 1 rev B built on `TM1_Test_DEV` and verified — 15/15
  assertions** (change set `48defb90`, 72 objects). 20 dimensions, 6 cubes,
  4 processes, engine + Headcount + FX-translation rules, 5 subsets, 8 views.
  Verified live:
  - **Progressive YTD-aware employer tax** — ENG-002 UK: £0 Jan (under the
    £9,100 Secondary Threshold), £630 Feb, £943/mo after; FY £10,060 vs £11,316
    flat. US-NY flat 9% below the SS cap. NZ ACC 1.39%.
  - **Contractor gate** — ITO-001 (Employment Type = Contractor): base only,
    zero employer tax / pension / benefits.
  - **Currency** — cost in each position's salary currency; `Reporting` member
    translates GBP·1 + USD·0.79 + NZD·0.47; Group Reporting FY2026 = £1,700,147
    (= UK £947,861 + US £614,833 + NZ £137,453).
  - **Job-family pay bands** — ENG-005 open req costs G2 NY × Engineering index
    1.10 = £6,600/mo.
  - **Headcount cube** — June: 16 filled, FTE 16.5 (incl. 1 open req), 1 open;
    Oct: 15 filled, 2 open.
  - `WFP Version` replaces Scenario; multi-year Period (2025–2027).
  - `Group` was ambiguous (member of both Entity and Currency) → the currency
    member is `Reporting`.
- *(2026-09-06)* **Phase 1 rev C — employee income tax + gross-to-net** (change
  set `e94be4be`, 23 objects, 17/17 assertions). `WFP Tax Type` dimension
  (`Employer Payroll Tax` / `Employee Income Tax`); `WFP Tax Bands` = Jurisdiction
  × Tax Type × Band (7) × Band Item; real progressive brackets (NZ 10.5/17.5/30/33/39,
  UK 0/20/40/45, US-NY blended). Pay Component split: `Cost to Company` (C) +
  `Employee Deductions` (C), `Gross Pay` and `Net Pay` leaves. `Employee Pension`
  (UK 5% / US 6% / NZ 3% KiwiSaver). Verified: ENG-002 UK net £57,668 on £82k;
  ENG-006 NZ income tax £34,427.50 (exact brackets); contractor net = gross.
  8 views + a `Default` view on every cube + a `Default` subset on every
  dimension. **`CubeProcessFeeders` must run after recreating a cube** — see
  BUILDING_MODELS.md.
- *(2026-09-06)* **Phase 1 rev D — house conventions retrofit** (change set
  `6debf5e0`, 39 objects / 92 in the release package, 19/19 assertions). Three
  model-wide conventions applied: (1) every cube ends in a `<Cube> Measure`
  dimension — four "item" dims renamed by rebuild, `WFP FX Rates Measure` and
  `WFP Workforce Cost Measure` (single `Amount`) added; (2) fixed house dimension
  order `Period, Version, Entity, Cost Centre, Account, Type, <specific>,
  Measure` on all six cubes; (3) default `#,##0.00` element format on every
  measure dim. All six cubes dropped and rebuilt; rules and seed TIs remapped to
  the new coordinate order (element names unchanged, so rule *areas* were
  untouched — only positional `DB()` / `CellPutN` argument lists moved). New
  assertions: sum-of-12-months EIT = FY (YTD self-ref under reorder), monthly
  Reporting-ccy FX translation. Old dims removed: `WFP Input Item`,
  `WFP Rate Item`, `WFP Band Item`, `WFP HC Measure`. MCP `build_cube` /
  `build_dimension` updated to enforce these going forward — see
  `BUILDING_MODELS.md` and `MCP_SERVER.md`.
- *(2026-09-07)* **Deployed to `TM1_Test_PROD`** (release package via the IDE,
  after 9 `tools/tm1deploy` bug fixes — commit `fa3ec06`). 6 figures verified
  against DEV to the cent (Group CtC FY2026 Reporting = 1,700,305.85; ENG-002
  net £57,668; Group headcount 16). Two deploy gaps surfaced and were handled:
  the change log only recorded 1 of 6 `Default` views (created the other 5 on
  PROD by hand), and dimension attribute *values* aren't packaged. The latter
  is now fixed at the model level by **`WFP Seed Dimension Attributes`** — an
  idempotent process that sets `WFP Period` (Period Index / Days In Month /
  Prior Period / FY, computed in a loop), `WFP Job Family` Pay Index, and the
  `WFP Entity` / `WFP Version` / `WFP Cost Centre` label attributes. It replaces
  the declarative `build_dimension` attribute values that never survived a
  deploy. Run order on a fresh target: `WFP Load Positions`,
  `WFP Seed Dimension Attributes`, then the four cube seeds, then
  `WFP Reprocess Feeders`, `WFP Create Default Subsets`.
- *(2026-09-07)* **Phase 2 — versions & assumptions built + verified, 24/24
  assertions** (change sets `0f907c3a` + `5b284d3f`, 14 object changes on
  `TM1_Test_DEV`; deployed to `TM1_Test_PROD` 2026-09-07). Delivered:
  - **`WFP Assumptions` cube** (`Period × Version × Entity × WFP Assumptions
    Measure`) + `WFP Seed Assumptions` — Merit / Promotion Budget / Inflation /
    **Actuals Cutoff Index** / Vacancy Allowance / Standard FTE Hours / Bonus
    Pool / Employer Oncost Fallback. Written at leaf entities only (`Group` is a
    consolidation; rates don't sum) — rules read at the position's Home Entity.
  - **Forecast = calculating version** — `['Forecast'] = N:` rule on
    `WFP Workforce Input`: Actual where `Period Index ≤ Actuals Cutoff Index`
    (per Home Entity), else Working. Flows through the whole engine because it is
    parameterised on `!WFP Version`. Verified: EXEC-001 got a real Jan–Mar raise
    (Actual 220k vs Working 210k) → Forecast Feb base £18,333 (Actual side),
    Jun base £17,500 (Working side); Group Forecast FY2026 CtC £1,703,276 =
    Working £1,700,306 + the raise delta.
  - **`WFP Copy Version`** — parameterised source→target copy of Workforce Input
    (FTE + Base Salary), refuses a `Calculated` target. `Downside` scenario
    version added and populated by copy.
  - **Feeder fix (change set `5b284d3f`)** — Forecast consolidations read 0 until
    (a) `WFP Workforce Input` feeds the Forecast downstream cells explicitly from
    the always-present `['Working','FTE']`, and (b) `WFP Seed FX Rates` /
    `WFP Seed Pay Rates` seed **every** leaf version, not just Budget/Working —
    the engine reads those reference cubes at `!WFP Version`. *(The `['Working',
    'FTE']` cross-feed and the "Forecast = Working" blend are removed in Phase
    3.5. The `Version` dim on the reference cubes is **kept** — see Phase 3.5 D3:
    FX and pay rates are legitimately version-specific; seeds populate every
    `Calculated` version.)*

  Fresh-target run order now: `WFP Load Positions`, `WFP Seed Dimension
  Attributes`, `WFP Seed Tax Bands`, `WFP Seed FX Rates`, `WFP Seed Pay Rates`,
  `WFP Seed Assumptions`, `WFP Seed Workforce Input`, `WFP Reprocess Feeders`,
  `WFP Create Default Subsets`.
- *(2026-09-07)* **Phase 3 — compensation actions built + verified, 30/30
  assertions** (change set `07d03d7b`, 8 object changes on `TM1_Test_DEV`;
  deployed to `TM1_Test_PROD` 2026-09-07, 30/30 verified on PROD, DEV+PROD
  baselines advanced). Delivered:
  - **Merit + promotion uplift** — `WFP Seed Workforce Input` applies
    `Merit Increase %` + `Promotion Budget %` to the **Working** salary from
    `Merit Review Index` (a new Assumptions measure, seeded to 16 = 2026-04).
    **Budget stays flat** — it is the approved/frozen plan, so every Phase 1/2
    Budget-scoped assertion still holds. Verified: ENG-002 Working salary
    82,000 → 85,280 (×1.04) at 2026-04; Budget unchanged.
  - **Bonus accrual** — new `Bonus` pay component = `Base × Bonus Pool %`
    (contractor-gated), accrued monthly. Reads Assumptions at `!WFP Entity`.
  - **One-time payments** — new `One-Time Amount` input line on
    `WFP Workforce Input` and a `One-Time` pay component that reads it at the
    home intersection. Hits only the entered month (fed from `_Monthly Base
    Full`; a payment in a month with no base — e.g. post-termination severance
    — would be under-fed, noted for a later refinement). Sample: CS-001
    retention 15,000 in 2026-06.
  - **`Total Compensation` (C)** = `Cost to Company` + `Bonus` + `One-Time`.
    `Cost to Company` unchanged (run-rate employer cost); `Total Compensation`
    is the everything-in figure.
  - Two Phase 2 Forecast assertions re-based for post-merit Working
    (`ab2b4816`, `6e0e7232`); `Compensation Detail` view added.
  - Deferred: individual promotions (per-position promo data), commission plans
    (a plan-parameter cube), equity/RSU.
- *(2026-09-08)* **Phase 3.5 — version model correction built + verified, 32/32
  assertions** (change set `f26a4810`, 9 object changes on `TM1_Test_DEV`;
  deployed to `TM1_Test_PROD` 2026-09-08, PROD totals verified — Budget
  1,700,305.85 / Forecast 1,750,289.55 / Downside 1,773,796.40 / FCST 2026-06
  1,750,289.55; DEV+PROD baselines advanced). Encapsulated-version convention in
  `BUILDING_MODELS.md`. Delivered:
  - **`Working` removed.** `Forecast` is now the working current model. Its
    `WFP Workforce Input` rule shrank to a closed-month-only override:
    `IF(Period Index <= Forecast's own Actuals Cutoff Index, DB(Actual), STET)` —
    open months fall through to Forecast's own seeded input. Same for `Downside`.
  - **`WFP Seed Assumptions`** now writes a full independent set per calculated
    version: `Budget` flat (0 merit/promo/bonus, cutoff 0), `Forecast` = the
    old `Working` set (3%/1%/10%, cutoff 15), `Downside` = a cost-pressure
    scenario (5% merit, 4% inflation, 12% bonus, 5% vacancy, cutoff 15).
  - **`WFP Seed Workforce Input`** loops `Budget|Forecast|Downside`, each reading
    its own assumptions, and writes only each version's OPEN months (closed
    months are the rule's job — CellPutN to a ruled non-STET cell fails).
  - **Feeders simplified** — the `['Working','FTE'] =>` cross-feeds are gone;
    `['FTE'] => …!WFP Version…` feeds every version incl. snapshots, plus
    `['Actual','FTE'] =>` feeds the closed-month side of Forecast / Downside.
  - **`WFP Snapshot Version`** (new TI) — params `pSource` / `pTarget`; creates
    the target as a `Frozen` member and copies the input layer (Workforce Input +
    Assumptions + FX Rates + Pay Rates). Cost + Headcount then recalculate to the
    frozen picture and stay there while the inputs are untouched. Demo:
    `Forecast → FCST 2026-06`, Group CtC FY2026 1,750,289.55 (= Forecast).
  - **`Version Type`** vocabulary → `Calculated` / `Frozen` (was
    `Input`/`Calculated`/`Snapshot`). All four live versions `Calculated`;
    `Actual` flips to `Frozen` at Phase 7.
  - **Verified:** Forecast Group CtC FY2026 = 1,750,289.55 (reproduces the
    pre-3.5 blend exactly); Budget unchanged at 1,700,305.85; Downside
    1,773,796.40. 8 `Working`-scoped assertions re-pointed to `Forecast`, 1
    replaced with a `Downside` self-contained check, 2 new (Downside pressure,
    snapshot fidelity).
  - Fresh-target run order unchanged; `WFP Snapshot Version` runs only at close.
- *(2026-09-08)* **Phase 3.5b — static-version guard (deployed to `TM1_Test_PROD`,
  31/31 assertions).** The Phase 3.5 approach left `Actual` calculating and
  snapshots "static only while inputs untouched". This makes them genuinely
  static:
  - **`WFP Version`** gains a `Non-Calculating` (C) roll-up; `Actual` (and every
    snapshot) sits under it. `Calculated` versions (Budget/Forecast/Downside)
    have no such parent.
  - **Every cube rule file** (`WFP Workforce Cost`, `WFP Headcount`,
    `WFP Workforce Input`) opens with one guard line:
    `[] = N: IF(ELPAR('WFP Version', !WFP Version, 1) @= 'Non-Calculating', STET, CONTINUE);`
    — non-calculating versions keep their stored value and skip all calc;
    everything else falls through (`CONTINUE`) to the rules below.
  - **`Actual` is now blank** in `WFP Workforce Cost` / `WFP Headcount` — it holds
    only what is loaded (seeded `Base Salary` + `FTE` in `WFP Workforce Input`).
    Real actuals land at Phase 7. `Forecast` closed months still work — that rule
    reads `Actual`'s *input*, which is stored.
  - **`WFP Snapshot Version`** rewritten: copies the input cubes **and** the
    calculated output (`WFP Workforce Cost` leaf pay components + `WFP Headcount`,
    per position, own currency + Reporting); parents the new member under
    `Non-Calculating`; marks `Version Type = Static`. Copy runs in the **Epilog**
    (the Prolog's `DimensionElementComponentAdd` only commits at Prolog end, so
    the guard is not yet active for the new member during the Prolog).
  - **`Version Type`** vocabulary → `Calculated` / `Static` (was `Frozen`).
  - **`WFP Workforce Cost` Reporting rule** collapsed from 10 near-identical
    `['Reporting', <component>]` rules to one `['Reporting']` using
    `!WFP Pay Component`.
  - Tested: `WFP Snapshot Version Forecast -> zz_snaptest` reproduced Forecast
    Group CtC FY2026 1,750,289.55 and Total Compensation 1,903,457.08 exactly;
    throwaway member deleted. The `FCST 2026-06` demo snapshot + its assertion
    were removed (32 -> 31 assertions).
  - The `Calculating` (C) roll-up from an early draft did not survive a change-set
    collision (a second agent opened its own change set on the same server); it
    is not needed — the guard only tests for the `Non-Calculating` parent.
- *(2026-09-08)* **Phase 4 — hiring plan, attrition, headcount bridge, built +
  verified, 38/38 assertions** (change set `ca2942a5`, 18 object changes,
  21-object release package `release-2026-09-08-2026-09-08-6`; not yet deployed).
  Delivered:
  - **`WFP Hiring Plan` cube** — `Version × Position × WFP Hiring Plan Measure`
    (`Hire Month`, `Attrition Month`, period-index scalars; `Hire Month` already
    folds in recruiting lead time = approve month + lead). `Non-Calculating` guard.
    Seeded by **`WFP Seed Hiring Plan`**.
  - **4 TBH positions** — `ENG-007`, `SLS-004`, `FIN-002` (new hires) and
    `ENG-008` (Downside backfill of `ENG-002`). `Position Status = 'TBH'`,
    `Seed Base Salary = 0` (band from `WFP Pay Rates`). Added to `WFP Load
    Positions` — which also got a **trailing-`~` fix** (its record loop had always
    silently dropped the last roster row).
  - **Version-aware active window** — `WFP Headcount` and `WFP Workforce Cost`
    now build the window from `WFP Hiring Plan` Hire/Attrition Month for the
    version, falling back to `Start/End Period` attrs when the plan cell is 0.
    A TBH with no plan hire for a version is never active. Plan hires get a full
    first month (no day proration); attribute starts keep day proration.
  - **Headcount bridge** — `WFP Headcount Measure` gains `Hires`, `Leavers`,
    `Opening`, `Closing` (+ `_Start Idx` / `_Leave Idx` / `_Hire Idx` /
    `_Filled Now` helpers). `Opening = prior-period Headcount`,
    `Closing = Opening + Hires − Leavers`, reconciling to `Headcount`. A new
    `Next Period` attribute on `WFP Period` (mirror of `Prior Period`) feeds
    `Leavers`/`Closing` forward one month so the Group consolidation is right in
    the leave month.
  - **`WFP Seed Workforce Input`** — seeds FTE/Base Salary only inside each
    calculated version's plan window; `Actual` seeded on the attribute window,
    non-TBH only.
  - **`WFP Snapshot Version`** — also copies `WFP Hiring Plan` + the bridge
    measures.
  - **Numbers:** Budget unchanged (flat plan) — Group HC Jun 16, CtC FY26
    1,700,306. Forecast Group HC Jun 19 (3 hires from 2026-04), CtC FY26
    1,926,472. Downside Group HC Jun 15 / Jul 14 (attrition), CtC FY26 1,701,974
    (attrition net of backfill beats the steeper assumptions). 2 CtC assertions
    re-based; 6 new Phase 4 assertions (headcount, lead time, attrition, backfill,
    no-backfill, bridge, hires-in-month).
  - Fresh-target run order gains `WFP Seed Hiring Plan` (after `WFP Load
    Positions`, before `WFP Seed Workforce Input`).
