# Repeatable tests — defining the set

**26 Nov 2026.** Source: the 60 assertions held on `TM1_Test_DEV` (model-owned), plus
`docs/TEST_STRATEGY.md` (adopted 22 Nov) and `docs/deploy/ASSERTIONS.md`.

## The rule we are enforcing

> A gate must be true for **any** data. Assert a **relationship**, never a literal that
> depends on today's shared cube values.

Today: **54 `behaviour` (literal) + 6 `control`**. 25 are red; the only `block` failure
(`P6 headcount variance = −1`) is a data comparison — it should never gate.

## Three contracts

| Contract | Assertion | Runs | Gates? |
|---|---|---|---|
| **Structure** | a difference/identity: `A − B = 0`, count = 0, object exists | close + target | **yes** |
| **Calculation** | exact number on a fixture the test creates (`setup` → reserved `Test` version) | close (DEV) | **yes** |
| **Quality** | threshold/range/actual-vs-budget | Model health | **no** |

## A. Structure — keep the 6 controls, rewrite the identities

These are already data-independent and should stay as gates:

| id | assertion |
|---|---|
| `2f51fe74` | no Position holds more people than its FTE → 0 |
| `3e2fd259` | no person is over 1.0 FTE across Positions → 0 |
| `41ff77d7` | nobody assigned to a Position in a month it does not exist → 0 |
| `0afe792f` | no assignment ends before it starts → 0 |
| `3e505f4d` | every Position has a location → 0 *(currently warn; make block)* |
| `9f80fdc6` | ENG-002 ER tax Apr = 0 — move to **calculation** (it needs a known salary) |

Rewrite these literals as identities (both sides computed from the model):

| current | assert instead |
|---|---|
| `e747e00a` ENG-002 income tax FY = 20,232 | income tax FY − Σ(monthly income tax) = 0 |
| `322bbcea` ENG-002 net pay = 57,668 | net pay − (gross − income tax − pension) = 0 |
| `eb707c` ITO-001 net = 120,000 | contractor net pay − gross = 0 |
| `8a77a60c` ENG-002 cost to company = 98,560.20 | cost to company − (base + ER tax + ER pension + benefits) = 0 |
| `ee3f0f40` ENG-006 income tax FY = 34,427.50 | FY tax − Σ(12 monthly values) = 0 |
| `d951f572` ENG-004 Reporting base = 9,216.67 | Reporting base − (USD base × FX) = 0 |
| `c6604eed` Budget base = 82,000 | Budget base − seed Budget base = 0 (merit never applied) |
| `7dfe7593` Forecast base = 85,280 | Forecast base − Budget base × (1 + merit + promo) = 0 |
| `78be451b` Bonus = 710.67 | Bonus − post-merit base × pool rate = 0 |
| `149b27e0` Contractor bonus = 0 | contractor Bonus = 0 (rule) |
| `947e1c22` One-Time = 15,000 | Σ One-Time over months − entered amount = 0, and 0 in every other month |
| `fbfc76a2` Forecast closed month = 18,333.33 | Forecast − Actual = 0 for every month ≤ Actuals Cutoff |
| `fc7149a8` Forecast open month = 18,200 | Forecast base − seed × (1 + merit) / 12 = 0 |
| `f84e00b5` Total comp = 9,353.39 | Total Comp − (cost + bonus + one-time) = 0 |
| `1efd04a7` severance visible = 5,640 | Forecast One-Time (R&D) − recorded severance = 0 (feeder proof) |
| `2d2856c4` Capex + Opex = 18.7M | Capex + Opex − Amount = 0 |
| `4376e32a` Var FX + Var Op = Act vs Bud | Var FX + Var Operational − Act vs Bud = 0 |
| `9e351a47` Downside rate = 222,600 | Downside base − its own rate × … (scenario identity), Forecast ≠ Downside |

Each becomes "changed / failed" only when the logic breaks, not when a roster moves.

## B. Calculation — needs a fixture (`Test` version)

These are worked examples tied to one person's seeded salary/rate. Repeatable only if the
test writes its own input (`setup` TI) and asserts inside the reserved `Test` version.

| id | what it pins |
|---|---|
| `b5148962` | ENG-002 ER tax = progressive UK NI brackets |
| `a152d5d2` | ENG-004 ER tax = US-NY 9% below the SS cap |
| `a3328331` | ENG-006 income tax = full NZ progressive |
| `e0301b21` | ENG-003 base = mid-month proration (22/31) |
| `37db5346` | CS-002 base = 0.5 FTE × salary / 12 |
| `2dc480ce` | CS-002 base = 0 after the position ends |
| `39aeacf8` | ENG-005 open-req base = band × index / 12 |
| `d3ca0639` | ITO-001 contractor ER tax = 0 (employment-type gate) |
| `9f80fdc6` | ENG-002 ER tax = 0 in the first tax month |
| `5c7d7365` | recruiting lead time: approve + 3 months → hire month |
| `7f49d5a3` | downside attrition month → headcount 0 |
| `a96807e4` | no-backfill attrition → headcount 0 |
| `3bef7b26` | unapproved planned hire → headcount 0 |
| `40`/`9e351a47` | downside is its own scenario (own rate) |

## C. Quality — PROD/TEST only, never a gate

These are data-quality checks. They run **on the target** — PROD's data, and TEST because it is
a clone of PROD — never on DEV, whose data is working data. They report to the data owner and
never stop a close or a deploy.

- `fbdbbc42` P6 headcount variance (the current block failure)
- `86bb7559`, `e1e1a6b2`, `7725e191`, `00f2199f`, `12ac7ed0`, `4376e32a` — variance checks
- `28fa5dc9`, `a7c0538a`, `ee5fed4f`, `bc2fd9dc`, `0cd4985d`, `f5236071` — headcount/FTE/openings
- `a213f5aa`, `20872ae1`, `3d8fbb63` — actuals and prior-forecast snapshots
- `3be21417`, `339fb28b`, `16cac65b`, `4ccc9da0`, `fecd21d3`, `5fb4b8c2`, `5b9f5a5c` — group totals / capex splits
- `fa394632`, `1c052eb7` — seeded actual values

## D. Drop

Anything that only reproduces a snapshot that no longer exists (`FCST 2026-02`, `Actual
YTD 2026-03` as a literal) and cannot be recreated from inputs. Their descriptions already
say *"to be dropped in the test re-sort"*.

## First actions

1. **Unblock:** `fbdbbc42` (P6 headcount variance) → `warn` / quality. It is a data
   comparison and rule 9 says it must never block.
2. **Rewrite A** (the identities) — no fixture engine needed; both sides are model
   measures, so they are repeatable today.
3. **Then B**: implement `setup` + the reserved `Test` version, and move the worked
   examples onto it.
4. **Then C/D**: sort the remaining tests to Model health on the target (PROD/TEST) / drop.

## Implemented — 26 Nov 2026

- **Scope + fixture on every assertion.** `scope: logic|quality`, `fixture: true`, optional
  `setup: { process, params }`. The close runs `logic`; the target runs `logic` **without a
  fixture**; Model health still sees everything.
- **Current split:** 24 `quality`, 37 `logic` (34 of them marked `fixture` until they are
  rewritten or moved onto the Test version).
- **Close:** 37 logic — **33 pass, 4 fail, 0 blocking**. The four are genuine model bugs:
  cost to company (benefits missing), total compensation (bonus missing), severance feeder,
  and the Var FX + Var Operational identity. They stay visible as `warn`.
- **Target:** 6 tests — the 5 structure controls plus the Capex + Opex identity — **6/6 pass**.
  That replaces the meaningless “18 of 60”.
- **Test version:** `Test` in `WFP Version`, `Version Type = Calculated`, `Test Version = Y`,
  hidden subset `}Test`. It is not under a reporting consolidation.
- **Setup:** `WFP Test Setup` writes a leaf employee (`ZZTEST-EMP`) into `Test`:
  Assignment Detail (Jan–Dec 2026, FTE 1, 82,000), Workforce Input, and the Position Map
  (Home Entity, Cost Centre, Grade, Location, Position FTE, State) from the position's own
  attributes; then runs `WFP Assignment Base` for `ZZ TEST` only.
- **Fixture assertion `ddbbc621`:** ENG-002 employer payroll tax in `Test` =
  `(20,500 − 9,100)×13.8% + (61,500 − 9,100)×13.8% = 8,804.40` — passes, and its setup runs
  on every close.
- **Model fix found by the fixture:** `WFP Tax Run` hard-codes the employee `Planned Hire`,
  which was missing; restored as a leaf (no data, no rollup).
- **UI:** the assertion editor shows and edits `scope`, `fixture` and the setup process.
- **Remaining:** the 33 fixture-marked literals still read DEV's live numbers; each needs its
  own identity rewrite or a `setup` on the Test version. The three known B1/B2/B3 bugs are
  model work, not test work.
