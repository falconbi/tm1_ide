# Workforce Planning model — build plan

A position-based FP&A workforce model, built in TM1 through the MCP server,
in phases. Modelled on how Pigment / Anaplan enterprise workforce apps work.

- **Position-based**: the grain is the *position* (a seat / req). An employee is
  assigned to a position; a position can be vacant. Vacancies carry budgeted
  cost. The hiring plan is just the list of unfilled positions.
- **Phased**: each phase is one change set we build, assert, and (optionally)
  deploy before the next.
- Built and verified against `read_cells` per `BUILDING_MODELS.md`.

Naming: every object is prefixed `WFP ` (dimensions, cubes) or `WFP ` (processes)
so the model is self-contained on a shared server.

---

## Phase roadmap

| Phase | Delivers | Key patterns |
|---|---|---|
| **1** | Roster + base compensation engine | position grain, band vs actual by status, start/end proration, on-cost fan-out, feeder chain, period-builder TI |
| 2 | Time intelligence | YTD/QTD roll-forward, run-rate, average headcount, phasing |
| 3 | Comp cycles & step changes | merit effective-date, promotions, bonus accrual, commission ramp, equity amortisation, one-time costs |
| 4 | Hiring plan & movements | demand vs supply gap, TBH positions + lead time, attrition, backfill, headcount bridge |
| 5 | Allocation & financials | position→cost-centre (1:1 and split), shared-services allocation, GL mapping, P&L cube, capitalised labour |
| 6 | Multi-currency | local comp, FX rates cube, reported translation, constant currency |
| 7 | Scenarios & analytics | Budget/Forecast/Actual, payroll actuals load, rate/FTE/mix variance, cost per FTE, sensitivity |
| 8 | Contractors & stretch | contractor cube, recruiting funnel, productivity ramp, rolling forecast |

Later phases source the incumbent / actual-salary from an `WFP Employee`
dimension + assignment (attribute link first, assignment cube if job-share or
mid-year moves are needed). Phase 1 keeps them as Position attributes so nothing
is rebuilt when Employee arrives.

---

# Phase 1 — Roster & base compensation

## Dimensions

### `WFP Scenario`
Flat. `Budget`, `Forecast`. (Actual → Phase 7.)

### `WFP Grade`
Flat. `G1`, `G2`, `G3`, `G4`, `G5`.

### `WFP Location`
Flat. `London`, `New York`.

### `WFP Entity`
`Total Company` (C) → `UK Ltd`, `US Inc`.

### `WFP Pay Component`
- `Total Cost` (C) → `Base`, `Employer Tax`, `Pension`, `Benefits`
- Standalone helper leaves (not under `Total Cost`): `_In Window`, `_Start Frac`,
  `_End Frac`, `_Active Fraction`, `_Annual Salary`, `_Monthly Base Full`

### `WFP Rate Item`
Flat. `Salary Min`, `Salary Mid`, `Salary Max`, `Employer Tax Pct`,
`Pension Pct`, `Benefits Annual`.

### `WFP Input Item`
Flat. `FTE`, `Actual Salary`, `Headcount`.

### `WFP Period`  *(built by TI — `WFP Build Period Dim`, param `pYear`)*
- Leaves: `2026-01` … `2026-12`
- Consolidations: `2026-Q1`..`2026-Q4` (3 months each), `2026-H1`,`2026-H2`, `FY2026`
- Attributes:
  - `Period Index` (N) — 1..12 on months
  - `Days In Month` (N) — 31,28,31,30,…
  - `Prior Period` (S) — `2026-02`→`2026-01`; `2026-01`→`` (blank)
  - `FY` (S) — `FY2026`

### `WFP Position`  *(structure by `build_dimension`, leaves + attribute values by TI — `WFP Load Positions`)*
- Consolidations: `Total Positions` (C) → `Engineering`, `Sales`, `G&A`
- Leaves loaded by TI under their department
- Attributes:

| Attr | Type | Notes |
|---|---|---|
| `Department` | S | |
| `Cost Centre` | S | `CC-ENG` / `CC-SLS` / `CC-GA` |
| `Location` | S | must match a `WFP Location` element |
| `Grade` | S | must match a `WFP Grade` element |
| `Job Family` | S | |
| `FTE` | N | default 1.0 (seeds the input cube) |
| `Position Status` | S | `Filled` / `Vacant` / `Open Req` / `Frozen` |
| `Start Period` | S | `WFP Period` element, e.g. `2026-01`; TI defaults to `2026-01` |
| `Start Day` | N | 1–31; default 1 |
| `End Period` | S | `WFP Period` element or `` (open-ended) |
| `End Day` | N | 1–31; default 0 |
| `Incumbent Name` | S | informational |
| `Actual Annual Salary` | N | 0 for vacant/open |
| `Home Entity` | S | must match a `WFP Entity` leaf; TI defaults to `UK Ltd`, rejects unknown |

## Cubes

| Cube | Dimensions | Content |
|---|---|---|
| `WFP Pay Rates` | Grade × Location × Period × Scenario × Rate Item | seeded by TI, no rules |
| `WFP Workforce Input` | Position × Period × Scenario × Input Item | seeded by TI (FTE, Actual Salary per active month), user-overridable; feeder only |
| `WFP Workforce Cost` | Position × Period × Scenario × Entity × Pay Component | the engine — all rules |

## `WFP Pay Rates` — seed values

Phase 1 treats all amounts as one currency unit (multi-currency is Phase 6).
Seeded for **every** month `2026-01`..`2026-12` and **both** scenarios.

| Grade | Location | Salary Min | Salary Mid | Salary Max | Employer Tax Pct | Pension Pct | Benefits Annual |
|---|---|---|---|---|---|---|---|
| G1 | London | 28000 | 32000 | 36000 | 0.138 | 0.05 | 2400 |
| G2 | London | 40000 | 48000 | 56000 | 0.138 | 0.05 | 2400 |
| G3 | London | 62000 | 75000 | 88000 | 0.138 | 0.05 | 2400 |
| G4 | London | 95000 | 115000 | 135000 | 0.138 | 0.05 | 2400 |
| G5 | London | 150000 | 180000 | 220000 | 0.138 | 0.05 | 2400 |
| G1 | New York | 38000 | 44000 | 50000 | 0.10 | 0.06 | 6000 |
| G2 | New York | 55000 | 66000 | 78000 | 0.10 | 0.06 | 6000 |
| G3 | New York | 90000 | 110000 | 130000 | 0.10 | 0.06 | 6000 |
| G4 | New York | 140000 | 170000 | 200000 | 0.10 | 0.06 | 6000 |
| G5 | New York | 210000 | 260000 | 320000 | 0.10 | 0.06 | 6000 |

## `WFP Position` — seed roster

| Position | Dept | Cost Centre | Location | Grade | Job Family | FTE | Status | Start | S.Day | End | E.Day | Incumbent | Actual Salary | Entity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ENG-001 | Engineering | CC-ENG | London | G4 | Engineering | 1.0 | Filled | 2026-01 | 1 | | 0 | Alice Chen | 120000 | UK Ltd |
| ENG-002 | Engineering | CC-ENG | London | G3 | Engineering | 1.0 | Filled | 2026-01 | 1 | | 0 | Ben Ortiz | 78000 | UK Ltd |
| ENG-003 | Engineering | CC-ENG | New York | G3 | Engineering | 1.0 | Filled | 2026-01 | 1 | | 0 | Carla Reyes | 115000 | US Inc |
| ENG-004 | Engineering | CC-ENG | London | G2 | Engineering | 1.0 | Filled | 2026-03 | 10 | | 0 | Dan Webb | 50000 | UK Ltd |
| ENG-005 | Engineering | CC-ENG | London | G2 | Engineering | 1.0 | Open Req | 2026-05 | 1 | | 0 | | 0 | UK Ltd |
| SLS-001 | Sales | CC-SLS | London | G4 | Sales | 1.0 | Filled | 2026-01 | 1 | | 0 | Erin Fox | 110000 | UK Ltd |
| SLS-002 | Sales | CC-SLS | New York | G3 | Sales | 1.0 | Filled | 2026-01 | 1 | | 0 | Frank Lee | 105000 | US Inc |
| SLS-003 | Sales | CC-SLS | New York | G3 | Sales | 1.0 | Open Req | 2026-07 | 1 | | 0 | | 0 | US Inc |
| SLS-004 | Sales | CC-SLS | London | G2 | Sales | 0.5 | Filled | 2026-01 | 1 | 2026-09 | 30 | Gina Park | 44000 | UK Ltd |
| GA-001 | G&A | CC-GA | London | G5 | Leadership | 1.0 | Filled | 2026-01 | 1 | | 0 | Henry Ford | 175000 | UK Ltd |
| GA-002 | G&A | CC-GA | London | G2 | Finance | 1.0 | Filled | 2026-01 | 1 | | 0 | Iris Kwan | 47000 | UK Ltd |
| GA-003 | G&A | CC-GA | London | G1 | Admin | 1.0 | Filled | 2026-01 | 1 | | 0 | Jack Moss | 31000 | UK Ltd |

Coverage: full-year filled, mid-month start (ENG-004), two open reqs costed at
band (ENG-005, SLS-003), part-FTE with a mid-year end (SLS-004), two entities,
two locations.

## `WFP Workforce Cost` — rules

Dimension order: `WFP Position`, `WFP Period`, `WFP Scenario`, `WFP Entity`, `WFP Pay Component`.

```
SKIPCHECK;

#Region Helpers

# Rate to use: the incumbent's actual salary if the seat is filled and a salary
# is recorded, otherwise the grade/location band midpoint.
['_Annual Salary'] = N:
  IF( ATTRS('WFP Position', !WFP Position, 'Position Status') @= 'Filled'
      & DB('WFP Workforce Input', !WFP Position, !WFP Period, !WFP Scenario, 'Actual Salary') > 0,
      DB('WFP Workforce Input', !WFP Position, !WFP Period, !WFP Scenario, 'Actual Salary'),
      DB('WFP Pay Rates',
         ATTRS('WFP Position', !WFP Position, 'Grade'),
         ATTRS('WFP Position', !WFP Position, 'Location'),
         !WFP Period, !WFP Scenario, 'Salary Mid') );

# 1 if the position is active in this period, else 0.
['_In Window'] = N:
  IF( ATTRN('WFP Period', !WFP Period, 'Period Index')
        >= ATTRN('WFP Period', ATTRS('WFP Position', !WFP Position, 'Start Period'), 'Period Index')
      & ATTRN('WFP Period', !WFP Period, 'Period Index')
        <= IF( ATTRS('WFP Position', !WFP Position, 'End Period') @= '', 12,
               ATTRN('WFP Period', ATTRS('WFP Position', !WFP Position, 'End Period'), 'Period Index') ),
      1, 0 );

# Fraction of the month worked if this is the starting month, else 1.
['_Start Frac'] = N:
  IF( ATTRN('WFP Period', !WFP Period, 'Period Index')
        = ATTRN('WFP Period', ATTRS('WFP Position', !WFP Position, 'Start Period'), 'Period Index'),
      ( ATTRN('WFP Period', !WFP Period, 'Days In Month')
        - ATTRN('WFP Position', !WFP Position, 'Start Day') + 1 )
        \ ATTRN('WFP Period', !WFP Period, 'Days In Month'),
      1 );

# Fraction of the month worked if this is the ending month (and an end is set), else 1.
['_End Frac'] = N:
  IF( ATTRS('WFP Position', !WFP Position, 'End Period') @<> ''
      & ATTRN('WFP Period', !WFP Period, 'Period Index')
        = ATTRN('WFP Period', ATTRS('WFP Position', !WFP Position, 'End Period'), 'Period Index'),
      ATTRN('WFP Position', !WFP Position, 'End Day')
        \ ATTRN('WFP Period', !WFP Period, 'Days In Month'),
      1 );

['_Active Fraction'] = N: ['_In Window'] * ['_Start Frac'] * ['_End Frac'];

# Full-month base pay before proration, in the position's home entity only.
['_Monthly Base Full'] = N:
  IF( !WFP Entity @<> ATTRS('WFP Position', !WFP Position, 'Home Entity'), 0,
      ['_Annual Salary'] \ 12
      * DB('WFP Workforce Input', !WFP Position, !WFP Period, !WFP Scenario, 'FTE') );

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
  IF( !WFP Entity @<> ATTRS('WFP Position', !WFP Position, 'Home Entity'), 0,
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

`\` is float division here — verify it tokenises as an operator (see the
validator note in `CLAUDE.md`); if the lint miscounts, switch to `/`.

Entity guard: `Base` and `Benefits` zero out where `!WFP Entity` ≠ the
position's home entity; `Employer Tax` / `Pension` inherit it via `['Base']`.
Helpers are unguarded except `_Monthly Base Full`.

## `WFP Workforce Input` — rules (feeder only)

```
SKIPCHECK;
FEEDERS;
['FTE'] => DB('WFP Workforce Cost', !WFP Position, !WFP Period, !WFP Scenario,
              ATTRS('WFP Position', !WFP Position, 'Home Entity'), '_Monthly Base Full');
```

Attribute-fed feeder target (`Home Entity`) — `WFP Load Positions` must set
`Home Entity` for every position and reject any that doesn't map to a
`WFP Entity` leaf.

## TI processes

| Process | Sections |
|---|---|
| `WFP Build Period Dim` | **param** `pYear` (N). **Prolog**: insert 12 months, 4 quarters, 2 halves, 1 FY; add edges. **Epilog**: `AttrPutN`/`AttrPutS` for Period Index, Days In Month, Prior Period, FY (element inserts aren't committed until Prolog ends). |
| `WFP Load Positions` | **Prolog**: `DimensionElementInsert` the 12 leaves under their department; add edges. **Epilog**: `AttrPutS`/`AttrPutN` all attributes from the hard-coded roster table; default `Start Period`→`2026-01`, `Start Day`→1, `FTE`→1, `Home Entity`→`UK Ltd`; `ItemReject` if Grade/Location/Entity don't resolve. |
| `WFP Seed Pay Rates` | **Data** or **Prolog**: loop the rate table × 12 periods × {Budget,Forecast}, `CellPutN` into `WFP Pay Rates`. |
| `WFP Seed Workforce Input` | **Prolog**: for each position, for each period from Start Period index to End Period index (or 12), `CellPutN` `FTE` (from attr) and `Actual Salary` (from attr) into `WFP Workforce Input` for Budget + Forecast. |

## Assertions

MDX summed over the returned cells; add via `add_assertion` as we build.

| # | Cell | Expected | Tests |
|---|---|---|---|
| 1 | ENG-002 · 2026-06 · Budget · UK Ltd · Base | **6500** | filled, full month, FTE 1.0 → 78000/12 |
| 2 | ENG-002 · 2026-06 · Budget · UK Ltd · Total Cost | **7922** | 6500 + 897 + 325 + 200 |
| 3 | ENG-002 · FY2026 · Budget · UK Ltd · Total Cost | **95064** | 7922 × 12 (period consolidation) |
| 4 | ENG-005 · 2026-06 · Budget · UK Ltd · Base | **4000** | open req → band mid G2 London 48000/12 |
| 5 | ENG-005 · 2026-04 · Budget · UK Ltd · Base | **0** | before Start Period (May) |
| 6 | ENG-004 · 2026-03 · Budget · UK Ltd · Base | **2956.99** | start 10 Mar, 22/31 × 50000/12 |
| 7 | ENG-004 · 2026-02 · Budget · UK Ltd · Base | **0** | before start |
| 8 | ENG-004 · 2026-04 · Budget · UK Ltd · Base | **4166.67** | full month after start |
| 9 | SLS-004 · 2026-06 · Budget · UK Ltd · Base | **1833.33** | 0.5 FTE → 44000/12 × 0.5 |
| 10 | SLS-004 · 2026-10 · Budget · UK Ltd · Base | **0** | after End Period (Sep) |
| 11 | ENG-003 · 2026-06 · Budget · US Inc · Employer Tax | **958.33** | New York rate 0.10 × (115000/12) |
| 12 | ENG-003 · 2026-06 · Budget · UK Ltd · Base | **0** | entity guard — home is US Inc |
| 13 | US Inc · 2026-06 · Budget · Total Positions · Total Cost | *(compute at build)* | entity roll-up = ENG-003 + SLS-002 |
| 14 | Total Company · FY2026 · Budget · Total Positions · Total Cost | *(compute at build)* | grand total |

## Build order (MCP)

```
seed_baseline
start_change_set "AI: Workforce Planning — Phase 1"

build_dimension  WFP Scenario, WFP Grade, WFP Location, WFP Entity,
                 WFP Pay Component, WFP Rate Item, WFP Input Item
build_dimension  WFP Position   (Total Positions > Engineering/Sales/G&A + attribute defs)

build_cube       WFP Pay Rates
build_cube       WFP Workforce Input
build_cube       WFP Workforce Cost   (no rules yet)

build_process    WFP Build Period Dim      → run_process (pYear = 2026)
build_process    WFP Load Positions        → run_process
build_process    WFP Seed Pay Rates        → run_process
build_process    WFP Seed Workforce Input  → run_process

update_cube_rules  WFP Workforce Input   (feeder)
update_cube_rules  WFP Workforce Cost    (engine)

add_assertion ×14  →  run_assertions  →  read_cells spot checks
close_change_set
package_change_set  →  check_deploy_risk / check_target_drift (TM1_Test_PROD)
```

## Phase 1 known simplifications

- Single currency (Phase 6 adds FX).
- No position starts **and** ends in the same month (the `_Start Frac × _End Frac`
  product would double-discount). None in the seed roster.
- FTE and Actual Salary are static (from attributes, seeded into the input cube).
  Mid-year FTE / salary changes come with the input cube being genuinely
  editable in later phases.
- `Actual` scenario and payroll actuals are Phase 7.

---

## Changelog

- *(2026-09-06)* Plan created. Phase 1 spec written, not yet built.
