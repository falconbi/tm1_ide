# Test strategy — TM1 models (WFP as the worked example)

Status: adopted 22 Nov 2026, TM1 only for now. The engine change (setup process) is deliberately
scheduled **after** the DEV refresh, so the two are not mixed up.

## 1. The problem this fixes

The WFP model had 60 tests, all written as *"this MDX returns this exact number"*, all reading the
shared DEV dataset. When the data changed — a rebuild, a reseed, a structural accident — 25 went
red and nobody could tell **"the model is wrong"** from **"the data changed"**. Both looked
identical, and the only quick fix was to overwrite the expected numbers, which quietly turns a test
into a tautology.

The fix is not better numbers. It is **three kinds of check with three different contracts**.

## 2. The three kinds

| Kind | Input | Expected value | Runs | Gates a release? |
|---|---|---|---|---|
| **Structure** | any data | a relationship: `A − sum(children) = 0`, `count = count`, an object exists | every close, and **after every deploy on the target** | **yes** |
| **Calculation** | data the test creates (its own fixture) | an exact number or a composition identity, derived by hand | close, on DEV | **yes** |
| **Quality** | whatever is in the model | a threshold, a range, a freshness rule | scheduled, in **Model health** | **no** — warns the data owner |

The rule that keeps them apart:

> **If you cannot state it without a number that depends on today's data, it is not a gate.**

Corollary: a **structure** check must survive a reseed; a **calculation** check must own its input;
a **quality** check must never block anyone.

## 3. Assertion format (v2)

One assertion is still one record in the model's `Applications/Governance/Tests`, with one addition:

```json
{
  "description": "ENG-002 cost to company = base + ER tax + ER pension + benefits",
  "kind": "calculation",
  "setup": { "process": "WFP Test Setup ENG002", "params": {} },
  "mdx": "SELECT {[WFP Workforce Cost Measure].[Cost to Company]} ON 0, {[WFP Period].[2026-06]} * {[WFP Version].[Test]} * {[WFP Position].[Position].[ENG-002]} ON 1 FROM [WFP Workforce Cost]",
  "expected": 98560.20,
  "tolerance": 0.01,
  "tags": ["seed:20261020", "chain:uk-employee"],
  "severity": "block"
}
```

The engine does, per assertion: **run `setup` (if present) → run the MDX → compare**. That is the
whole engine change — not a new framework. `setup` is optional: structure and quality checks have
none.

Rules for `setup`:

- **Idempotent** — it rewrites its inputs every run, so there is no teardown to get wrong.
- **Scoped to the fixture** — it writes only the reserved `Test` version and its own positions.
- **A setup failure is an assertion error**, reported as such, never a silent pass.
- It is a TI process, named in the assertion, so the AI writing tests can generate both halves from
  one description.

## 4. The reserved `Test` version — the fixture

TM1 has no schemas or transactions, so isolation is a **reserved version**:

| Requirement | How |
|---|---|
| Hidden from users | a `}ElementAttributes_WFP Version` flag (e.g. `Test Version = Y`) and a `}Test` subset excluded from every picker; not in a Default subset |
| Never in reports or views | it is not a leaf under the reporting consolidations; no shipped view uses it |
| Never deployed with data | versions are model metadata; its **data** is written by the setup TI on the server that runs the test, never shipped. A release carries the *definition*, not the values |
| Static | `Version Type = Static`, so nothing recalculates it except when the test asks |
| Small and quick | its setup writes a handful of positions, so "act" is seconds |

**The act step is per version**, which is why this fits WFP: `WFP Assignment Base` takes
`pVersion`, `pPositionSubset`, `pEmployeeSubset`, so a scenario recalculates only `Test` and only
its own positions. **Do not** route the act step through `WFP Recalculate If Needed`: that process
deliberately knows only Budget, Forecast, Downside and Actual, and adding a test version to it would
put test concerns inside production behaviour.

## 5. Wiring into the deploy

| Stage | Runs | Effect |
|---|---|---|
| **Close a change set** | structure + calculation | a block-severity failure refuses the close (as today) |
| **Safety checks after a deploy** (`controlOk`) | **structure only** | a failure says "deployed, but the model no longer computes correctly" |
| **Model health** | structure + quality (on demand) | quality failures are reported to the data owner, never blocking |

Reasoning: only structure checks are meaningful on a target whose data is not the test fixture.
Calculation checks on PROD would compare the fixture's number with production data — meaningless.

## 6. Dataset identity — the governance piece

The model's demo data has an identity: `{ seed, pSeed, pCount, seededAt }`, recorded with the tests
(a governance document, or tags on each calculation check: `seed:20261020`). Then:

- a **reseed is a deliberate event**: it lists the calculation checks pinned to the old dataset, and
  each re-derivation is recorded — from → to, who, when, why;
- a red test is always **"the model changed"** or **"the dataset changed"**, and the record says which;
- nobody re-baselines to silence a failure, because re-baselining is a recorded decision with a
  reason attached.

## 7. Worked examples (WFP)

**Structure — totals tie (runs everywhere, including PROD)**

```
[WFP Headcount: Total Cost Centre, 2026-06, Group] − SUM(children of Total Cost Centre) = 0
```
Survives any roster; fails only if a consolidation or feeder breaks.

**Structure — completeness (the class of bug that started this)**

```
cubes without a view named Default = 0
dimensions without a subset named Default = 0
cubes with rules but no SKIPCHECK; = 0      (report)
cubes with rules but no FEEDERS; = 0        (block — unfed rules read as empty)
```

**Calculation — a worked example on the fixture**

```
setup:  WFP Test Setup ENG002   → writes ENG-002 into Test: salary, grade, entity, pension %
act:    WFP Assignment Base (pVersion=Test, pPositionSubset=ZZ Test)
assert: Test version cost to company − (base + ER tax + ER pension + benefits) = 0
```
Expected `0`, so the check **names the missing component** instead of saying "the total is wrong".
A second calculation check pins the literal (98,560.20) when the *rate* itself is the thing under
test.

**Quality — belongs in Model health, never in the gate**

```
leavers this month ≤ headcount last month
open positions < 100
no salary above 500,000
```
A mass redundancy makes these wrong while the model is right — hence no gating.

## 8. Sorting the current 60

| Group | Count (approx.) | Becomes |
|---|---|---|
| Totals and counts tied to the roster | ~19 | **structure**, rewritten as differences and counts |
| Per-person worked examples (ENG-002, ENG-003, ENG-006, EXEC-001) | ~15 | **calculation**, moved onto the `Test` version, formula in the description |
| Actuals and snapshot versions (`Actual …`, `FCST 2026-02/03`, `Var FX`) | ~10 | drop unless the inputs are reproduced; otherwise re-home as calculation checks on the fixture |
| House standards (Default view/subset, SKIPCHECK, FEEDERS) | new | structure, from `model-health.houseStandards` |
| Plausibility (leavers, ranges, volumes) | new | quality, Model health only |

The three fixed deltas found during the rebuild (`ENG-002 −2,400 benefits`, `Total Comp −200 bonus`,
`ENG-006 severance 5,640 → 0`) are **calculation failures and real**: they were failing at 3,000
positions too. They get fixed or accepted deliberately — not re-baselined.

## 9. Anti-patterns (banned)

- A literal on shared, editable data.
- An aggregate as a calculation check (`Group total = 222M`) — it fails for 500 possible reasons.
- "It went red, update the expected value" with no derivation and no record.
- A quality threshold inside the release gate.
- Test data written into a version that also carries real data.
- A test that can only run on one server because it depends on that server's hand-edited state.

## 10. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| T1 | Name of the reserved version | `Test`, `Version Type = Static`, hidden by an attribute + a `}Test` subset |
| T2 | Does `setup` live on the assertion or in the test's own process? | **On the assertion** (one process name + params) — simplest for AI-authored tests |
| T3 | Are calculation checks tagged with the dataset identity? | **Yes** — `seed:<id>`; it is what makes a reseed auditable |
| T4 | Do quality checks ever block? | **No** — Model health only |
| T5 | When is the engine change made? | **After** the DEV refresh, so the two are not mixed |
