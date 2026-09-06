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
