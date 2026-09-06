# Workforce Planning model — build plan

A position-based FP&A workforce model, built in TM1 through the MCP server,
in phases. Modelled on how Pigment / Anaplan enterprise workforce apps work.

- **Position-based**: the grain is the *position* (a seat / req). An employee is
  assigned to a position; a position can be vacant. Vacancies carry budgeted
  cost. The hiring plan is just the list of unfilled positions.
- **Phased**: each phase is one change set we build, assert, and deploy before
  the next.
- Built and verified against `read_cells` per `BUILDING_MODELS.md`.

Naming: every object is prefixed `WFP ` so the model is self-contained on a
shared server.

---

## Phase roadmap

| Phase | Delivers | Key patterns |
|---|---|---|
| **1** | Roster + base compensation engine | position grain, band vs actual by status, start/end proration, on-cost fan-out, feeder chain, 3 entities / 11 cost centres / 3 currencies (local), period-builder TI |
| 2 | Time intelligence | YTD/QTD roll-forward, run-rate, average headcount, phasing |
| 3 | Comp cycles & step changes | merit effective-date, promotions, bonus accrual, commission ramp, equity amortisation, one-time costs |
| 4 | Hiring plan & movements | demand vs supply gap, TBH positions + lead time, attrition, backfill, headcount bridge |
| 5 | Allocation & financials | position→cost-centre split, shared-services allocation, GL mapping, P&L cube, capitalised labour |
| 6 | Multi-currency | FX rates cube, local→reported translation, constant currency, `Group` total becomes meaningful |
| 7 | Scenarios & analytics | Budget/Forecast/Actual, payroll actuals load, rate/FTE/mix variance, cost per FTE, sensitivity |
| 8 | Contractors & stretch | contractor cube, recruiting funnel, productivity ramp, rolling forecast |

Later phases source the incumbent / actual salary from a `WFP Employee` dimension
+ assignment. Phase 1 keeps them as Position attributes so nothing is rebuilt
when Employee arrives. The dimension set (Position grain, Entity, Cost Centre,
Period, Currency) is fixed from Phase 1.

---

# Phase 1 — Roster & base compensation

## Dimensions

| Dimension | Members |
|---|---|
| `WFP Scenario` | flat: `Budget`, `Forecast` (Actual → Phase 7) |
| `WFP Grade` | flat: `G1`..`G5` |
| `WFP Location` | flat: `London`, `New York`, `Auckland` |
| `WFP Currency` | flat: `GBP`, `USD`, `NZD` |
| `WFP Entity` | `Group` (C) → `UK Ltd`, `US Inc`, `NZ Ltd` |
| `WFP Rate Item` | flat: `Salary Min`, `Salary Mid`, `Salary Max`, `Employer Tax Pct`, `Pension Pct`, `Benefits Annual` |
| `WFP Input Item` | flat: `FTE`, `Actual Salary`, `Headcount` |
| `WFP Pay Component` | `Total Cost` (C) → `Base`, `Employer Tax`, `Pension`, `Benefits`; standalone helper leaves `_In Window`, `_Start Frac`, `_End Frac`, `_Active Fraction`, `_Annual Salary`, `_Monthly Base Full` |

### `WFP Cost Centre`
```
Total Cost Centre (C)
├── R&D (C)  → CC-ENG-PLT, CC-ENG-APP, CC-PROD
├── S&M (C)  → CC-SALES, CC-SALESOPS, CC-MKT, CC-CS
└── G&A (C)  → CC-FIN, CC-PPL, CC-ITOPS, CC-EXEC
```
Standalone functional dimension — **not** baked into entity or position names.
Attributes: `Function` (S — R&D / S&M / G&A), `CC Name` (S).

### `WFP Entity` — attributes
`Local Currency` (S — must match a `WFP Currency` element), `Primary Location` (S).
`UK Ltd`→GBP/London, `US Inc`→USD/New York, `NZ Ltd`→NZD/Auckland.

### `WFP Period`  *(built by TI — `WFP Build Period Dim`, param `pYear`)*
- Leaves `2026-01`…`2026-12`; consolidations `2026-Q1`..`Q4` (3 months), `2026-H1`,`2026-H2`, `FY2026`
- Attributes: `Period Index` (N, 1..12), `Days In Month` (N), `Prior Period` (S — `2026-01`→``), `FY` (S)

### `WFP Position`  *(consolidation structure by `build_dimension`; leaves + attribute values by TI — `WFP Load Positions`)*
```
Total Positions (C)
├── R&D (C)  → Engineering (C), Product (C)
├── S&M (C)  → Sales (C), Sales Ops (C), Marketing (C), Customer Success (C)
└── G&A (C)  → Finance (C), People (C), IT & Ops (C), Executive (C)
```
Leaves loaded under their department consolidation.

Attributes: `Department` (S), `Cost Centre` (S — a `WFP Cost Centre` leaf),
`Location` (S), `Grade` (S), `Job Family` (S), `FTE` (N, default 1.0),
`Position Status` (S — `Filled`/`Vacant`/`Open Req`/`Frozen`),
`Start Period` (S — `WFP Period` element, TI default `2026-01`), `Start Day` (N, default 1),
`End Period` (S — element or ``), `End Day` (N, default 0),
`Incumbent Name` (S), `Actual Annual Salary` (N, 0 for vacant),
`Home Entity` (S — a `WFP Entity` leaf; TI defaults `UK Ltd`, rejects unknown).

## Cubes

| Cube | Dimensions | Content |
|---|---|---|
| `WFP Pay Rates` | Grade × Location × Period × Scenario × Rate Item | seeded by TI, no rules |
| `WFP Workforce Input` | Position × Period × Scenario × Input Item | seeded by TI, user-overridable; feeder only |
| `WFP Workforce Cost` | Position × Period × Scenario × **Entity × Cost Centre** × Pay Component | the engine — all rules |

## `WFP Pay Rates` — seed values

Local currency per location. Seeded for **every** month and **both** scenarios.

**London (GBP)**

| Grade | Sal Min | Sal Mid | Sal Max | Emp Tax Pct | Pension Pct | Benefits Annual |
|---|---|---|---|---|---|---|
| G1 | 28000 | 32000 | 36000 | 0.138 | 0.05 | 2400 |
| G2 | 42000 | 50000 | 58000 | 0.138 | 0.05 | 2400 |
| G3 | 66000 | 80000 | 94000 | 0.138 | 0.05 | 2400 |
| G4 | 100000 | 120000 | 140000 | 0.138 | 0.05 | 3600 |
| G5 | 160000 | 195000 | 235000 | 0.138 | 0.05 | 4800 |

**New York (USD)**

| Grade | Sal Min | Sal Mid | Sal Max | Emp Tax Pct | Pension Pct | Benefits Annual |
|---|---|---|---|---|---|---|
| G1 | 40000 | 46000 | 52000 | 0.10 | 0.06 | 6000 |
| G2 | 60000 | 72000 | 84000 | 0.10 | 0.06 | 6000 |
| G3 | 100000 | 122000 | 145000 | 0.10 | 0.06 | 6000 |
| G4 | 150000 | 180000 | 215000 | 0.10 | 0.06 | 9000 |
| G5 | 230000 | 285000 | 345000 | 0.10 | 0.06 | 12000 |

**Auckland (NZD)**

| Grade | Sal Min | Sal Mid | Sal Max | Emp Tax Pct | Pension Pct | Benefits Annual |
|---|---|---|---|---|---|---|
| G1 | 55000 | 62000 | 70000 | 0.014 | 0.03 | 3000 |
| G2 | 82000 | 95000 | 110000 | 0.014 | 0.03 | 3000 |
| G3 | 120000 | 140000 | 165000 | 0.014 | 0.03 | 3000 |
| G4 | 180000 | 210000 | 250000 | 0.014 | 0.03 | 4500 |
| G5 | 270000 | 320000 | 390000 | 0.014 | 0.03 | 6000 |

## `WFP Position` — seed roster (18)

| Position | Department | Cost Centre | Location | Grade | Job Family | FTE | Status | Start | S.Day | End | E.Day | Incumbent | Actual Salary | Entity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EXEC-001 | Executive | CC-EXEC | London | G5 | Leadership | 1.0 | Filled | 2026-01 | 1 | | 0 | Henry Ford | 210000 | UK Ltd |
| ENG-001 | Engineering | CC-ENG-PLT | London | G4 | Engineering | 1.0 | Filled | 2026-01 | 1 | | 0 | Alice Chen | 125000 | UK Ltd |
| ENG-002 | Engineering | CC-ENG-PLT | London | G3 | Engineering | 1.0 | Filled | 2026-01 | 1 | | 0 | Ben Ortiz | 82000 | UK Ltd |
| ENG-003 | Engineering | CC-ENG-APP | London | G2 | Engineering | 1.0 | Filled | 2026-03 | 10 | | 0 | Dan Webb | 55000 | UK Ltd |
| PRD-001 | Product | CC-PROD | London | G3 | Product | 1.0 | Filled | 2026-01 | 1 | | 0 | Priya Shah | 88000 | UK Ltd |
| SLS-001 | Sales | CC-SALES | London | G4 | Sales | 1.0 | Filled | 2026-01 | 1 | | 0 | Erin Fox | 115000 | UK Ltd |
| MKT-001 | Marketing | CC-MKT | London | G3 | Marketing | 1.0 | Filled | 2026-01 | 1 | | 0 | Mia Long | 72000 | UK Ltd |
| FIN-001 | Finance | CC-FIN | London | G2 | Finance | 1.0 | Filled | 2026-01 | 1 | | 0 | Iris Kwan | 50000 | UK Ltd |
| ENG-004 | Engineering | CC-ENG-APP | New York | G3 | Engineering | 1.0 | Filled | 2026-01 | 1 | | 0 | Carla Reyes | 140000 | US Inc |
| ENG-005 | Engineering | CC-ENG-APP | New York | G2 | Engineering | 1.0 | Open Req | 2026-05 | 1 | | 0 | | 0 | US Inc |
| SLS-002 | Sales | CC-SALES | New York | G3 | Sales | 1.0 | Filled | 2026-01 | 1 | | 0 | Frank Lee | 130000 | US Inc |
| SLS-003 | Sales | CC-SALES | New York | G3 | Sales | 1.0 | Open Req | 2026-07 | 1 | | 0 | | 0 | US Inc |
| SOP-001 | Sales Ops | CC-SALESOPS | New York | G2 | Sales | 1.0 | Filled | 2026-01 | 1 | | 0 | Nora Diaz | 78000 | US Inc |
| CS-001 | Customer Success | CC-CS | New York | G2 | Customer Success | 1.0 | Filled | 2026-02 | 1 | | 0 | Omar Haddad | 82000 | US Inc |
| PPL-001 | People | CC-PPL | New York | G3 | People | 1.0 | Filled | 2026-01 | 1 | | 0 | Rachel Kim | 105000 | US Inc |
| ENG-006 | Engineering | CC-ENG-PLT | Auckland | G3 | Engineering | 1.0 | Filled | 2026-01 | 1 | | 0 | Sam Tane | 135000 | NZ Ltd |
| CS-002 | Customer Success | CC-CS | Auckland | G2 | Customer Success | 0.5 | Filled | 2026-01 | 1 | 2026-09 | 30 | Tara Wells | 70000 | NZ Ltd |
| ITO-001 | IT & Ops | CC-ITOPS | Auckland | G2 | IT | 1.0 | Filled | 2026-01 | 1 | | 0 | Uma Patel | 90000 | NZ Ltd |

Coverage: ENG-003 mid-month start (10 Mar); ENG-005 / SLS-003 open reqs → band;
CS-001 clean mid-year start (1 Feb); CS-002 0.5 FTE + end 30 Sep; 3 entities,
3 currencies, 3 locations, grades G2–G5.

## `WFP Workforce Cost` — rules

Dimension order: `WFP Position`, `WFP Period`, `WFP Scenario`, `WFP Entity`, `WFP Cost Centre`, `WFP Pay Component`.

```
SKIPCHECK;

#Region Helpers

# Rate: incumbent actual salary if the seat is filled and a salary is recorded,
# else the grade/location band midpoint.
['_Annual Salary'] = N:
  IF( ATTRS('WFP Position', !WFP Position, 'Position Status') @= 'Filled'
      & DB('WFP Workforce Input', !WFP Position, !WFP Period, !WFP Scenario, 'Actual Salary') > 0,
      DB('WFP Workforce Input', !WFP Position, !WFP Period, !WFP Scenario, 'Actual Salary'),
      DB('WFP Pay Rates',
         ATTRS('WFP Position', !WFP Position, 'Grade'),
         ATTRS('WFP Position', !WFP Position, 'Location'),
         !WFP Period, !WFP Scenario, 'Salary Mid') );

['_In Window'] = N:
  IF( ATTRN('WFP Period', !WFP Period, 'Period Index')
        >= ATTRN('WFP Period', ATTRS('WFP Position', !WFP Position, 'Start Period'), 'Period Index')
      & ATTRN('WFP Period', !WFP Period, 'Period Index')
        <= IF( ATTRS('WFP Position', !WFP Position, 'End Period') @= '', 12,
               ATTRN('WFP Period', ATTRS('WFP Position', !WFP Position, 'End Period'), 'Period Index') ),
      1, 0 );

['_Start Frac'] = N:
  IF( ATTRN('WFP Period', !WFP Period, 'Period Index')
        = ATTRN('WFP Period', ATTRS('WFP Position', !WFP Position, 'Start Period'), 'Period Index'),
      ( ATTRN('WFP Period', !WFP Period, 'Days In Month')
        - ATTRN('WFP Position', !WFP Position, 'Start Day') + 1 )
        \ ATTRN('WFP Period', !WFP Period, 'Days In Month'),
      1 );

['_End Frac'] = N:
  IF( ATTRS('WFP Position', !WFP Position, 'End Period') @<> ''
      & ATTRN('WFP Period', !WFP Period, 'Period Index')
        = ATTRN('WFP Period', ATTRS('WFP Position', !WFP Position, 'End Period'), 'Period Index'),
      ATTRN('WFP Position', !WFP Position, 'End Day')
        \ ATTRN('WFP Period', !WFP Period, 'Days In Month'),
      1 );

['_Active Fraction'] = N: ['_In Window'] * ['_Start Frac'] * ['_End Frac'];

# Full-month base, only in the position's home entity + cost centre.
['_Monthly Base Full'] = N:
  IF( !WFP Entity @<> ATTRS('WFP Position', !WFP Position, 'Home Entity'), 0,
  IF( !WFP Cost Centre @<> ATTRS('WFP Position', !WFP Position, 'Cost Centre'), 0,
      ['_Annual Salary'] \ 12
      * DB('WFP Workforce Input', !WFP Position, !WFP Period, !WFP Scenario, 'FTE') ) );

#Region Cost components

['Base'] = N: ['_Monthly Base Full'] * ['_Active Fraction'];

['Employer Tax'] = N:
  ['Base'] * DB('WFP Pay Rates',
    ATTRS('WFP Position', !WFP Position, 'Grade'),
    ATTRS('WFP Position', !WFP Position, 'Location'),
    !WFP Period, !WFP Scenario, 'Employer Tax Pct');

['Pension'] = N:
  ['Base'] * DB('WFP Pay Rates',
    ATTRS('WFP Position', !WFP Position, 'Grade'),
    ATTRS('WFP Position', !WFP Position, 'Location'),
    !WFP Period, !WFP Scenario, 'Pension Pct');

['Benefits'] = N:
  IF( ['_Monthly Base Full'] = 0, 0,
      DB('WFP Pay Rates',
        ATTRS('WFP Position', !WFP Position, 'Grade'),
        ATTRS('WFP Position', !WFP Position, 'Location'),
        !WFP Period, !WFP Scenario, 'Benefits Annual') \ 12
      * DB('WFP Workforce Input', !WFP Position, !WFP Period, !WFP Scenario, 'FTE')
      * ['_Active Fraction'] );

FEEDERS;

['_Monthly Base Full'] => ['Base'], ['Benefits'];
['Base'] => ['Employer Tax'], ['Pension'];
```

- `_Monthly Base Full` zeros outside the position's home entity **and** cost
  centre; `Base`/`Benefits` inherit; `Employer Tax`/`Pension` inherit via `Base`.
- Benefits guards on `_Monthly Base Full = 0` (covers wrong entity/CC and inactive months).
- `\` = float division — verify the lint tokenises it as an operator; fall back to `/`.

## `WFP Workforce Input` — rules (feeder only)

```
SKIPCHECK;
FEEDERS;
['FTE'] => DB('WFP Workforce Cost', !WFP Position, !WFP Period, !WFP Scenario,
              ATTRS('WFP Position', !WFP Position, 'Home Entity'),
              ATTRS('WFP Position', !WFP Position, 'Cost Centre'), '_Monthly Base Full');
```

`WFP Load Positions` must set `Home Entity` and `Cost Centre` for every position
and `ItemReject` any that don't resolve to real elements (attribute-fed feeder).

## TI processes

| Process | Sections |
|---|---|
| `WFP Build Period Dim` | param `pYear` (N). **Prolog**: insert 12 months + 4 quarters + 2 halves + FY; edges. **Epilog**: `AttrPutN`/`AttrPutS` Period Index, Days In Month, Prior Period, FY. |
| `WFP Load Positions` | **Prolog**: `DimensionElementInsert` 18 leaves under their department; edges. **Epilog**: `AttrPutS`/`AttrPutN` all attributes from the hard-coded roster; defaults + `ItemReject` on unresolved Grade/Location/Entity/Cost Centre. |
| `WFP Seed Pay Rates` | loop rate table (3 locations × 5 grades × 6 items) × 12 periods × {Budget,Forecast}, `CellPutN` into `WFP Pay Rates`. |
| `WFP Seed Workforce Input` | per position, per period in its active window, `CellPutN` `FTE` and `Actual Salary` (from attributes) into `WFP Workforce Input` for Budget + Forecast. |

## Assertions

| # | Cell (Position · Period · Scenario · Entity · Cost Centre · Component) | Expected | Tests |
|---|---|---|---|
| 1 | ENG-002 · 2026-06 · Budget · UK Ltd · CC-ENG-PLT · Base | **6833.33** | 82000/12, filled full month |
| 2 | ENG-002 · 2026-06 · … · Total Cost | **8318.00** | 6833.33 + 943.00 + 341.67 + 200.00 |
| 3 | ENG-002 · FY2026 · … · Total Cost | **99816.00** | ×12 period consolidation |
| 4 | ENG-005 · 2026-06 · Budget · US Inc · CC-ENG-APP · Base | **6000.00** | open req → G2 NY mid 72000/12 |
| 5 | ENG-005 · 2026-04 · … · Base | **0** | before Start Period (May) |
| 6 | ENG-003 · 2026-03 · Budget · UK Ltd · CC-ENG-APP · Base | **3252.69** | start 10 Mar → 22/31 × 55000/12 |
| 7 | ENG-003 · 2026-02 · … · Base | **0** | before start |
| 8 | ENG-003 · 2026-04 · … · Base | **4583.33** | full month after start |
| 9 | CS-002 · 2026-06 · Budget · NZ Ltd · CC-CS · Base | **2916.67** | 0.5 FTE × 70000/12 |
| 10 | CS-002 · 2026-10 · … · Base | **0** | after End Period (Sep) |
| 11 | CS-002 · 2026-09 · … · Base | **2916.67** | ends day 30 of 30-day month → full |
| 12 | ENG-004 · 2026-06 · Budget · US Inc · CC-ENG-APP · Employer Tax | **1166.67** | NY rate 0.10 × (140000/12) |
| 13 | ENG-004 · 2026-06 · Budget · UK Ltd · CC-ENG-APP · Base | **0** | entity guard (home US Inc) |
| 14 | ENG-006 · 2026-06 · Budget · NZ Ltd · CC-ENG-PLT · Pension | **337.50** | NZ KiwiSaver 0.03 × (135000/12) |
| 15 | US Inc · 2026-06 · Budget · R&D · Total Cost | *(compute at build)* | entity + CC roll-up |
| 16 | UK Ltd · FY2026 · Budget · Total Cost Centre · Total Cost | *(compute at build)* | full UK cost |

`Group` totals are **not** asserted in Phase 1 (mixed currency — meaningless
until Phase 6 translation). Assert per entity.

## Build order (MCP)

```
seed_baseline
start_change_set "AI: Workforce Planning — Phase 1"

build_dimension  WFP Scenario, WFP Grade, WFP Location, WFP Currency, WFP Entity,
                 WFP Rate Item, WFP Input Item, WFP Pay Component, WFP Cost Centre
build_dimension  WFP Position   (consolidation tree + attribute defs)

build_cube       WFP Pay Rates
build_cube       WFP Workforce Input
build_cube       WFP Workforce Cost   (no rules yet)

build_process    WFP Build Period Dim      → run_process (pYear = 2026)
build_process    WFP Load Positions        → run_process
build_process    WFP Seed Pay Rates        → run_process
build_process    WFP Seed Workforce Input  → run_process

update_cube_rules  WFP Workforce Input   (feeder)
update_cube_rules  WFP Workforce Cost    (engine)

add_assertion ×16  →  run_assertions  →  read_cells spot checks
close_change_set
package_change_set  →  check_deploy_risk / check_target_drift (TM1_Test_PROD)
```

## Phase 1 known simplifications

- Cost is in each entity's **local currency**; no translation (Phase 6 adds FX,
  and only then is `Group` meaningful).
- No position starts **and** ends in the same month (`_Start Frac × _End Frac`
  would double-discount). None in the roster.
- FTE / Actual Salary are static, seeded from attributes into the input cube.
  Genuine mid-year changes come when the input cube is edited directly (Phase 3).
- Position → cost centre is 1:1 (attribute). Splits are Phase 5.
- `Actual` scenario and payroll actuals are Phase 7.

---

## Changelog

- *(2026-09-06)* Plan created. Phase 1 spec written (3 entities, 11 cost centres,
  3 currencies, 18 positions), not yet built.
