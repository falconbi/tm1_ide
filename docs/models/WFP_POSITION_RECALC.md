# WFP — recalculate cost for the changed Position only

Build brief for OpenCode. Date: 20 Nov 2026. Model: WFP on TM1_Test_DEV.

## Why

Found by the first Model Architecture Assessment and confirmed in the code.

Today, a change to **one** Position makes the next cost run rebuild **every** Position in that
version, about 3,000 of them:
- `WFP Request Recalculation(pVersion)` marks the whole version out of date
  (`WFP Control`, `Cost Out Of Date`). Every action process calls it, and so do Lenses after a save.
- The chore `WFP Recalculate Cost` runs `WFP Recalculate If Needed` every 5 minutes. For each
  marked version it:
  - runs `WFP Rebuild Location Hierarchy`;
  - runs `WFP Assignment Base(pVersion)`, which clears the version's `WFP Assignment Base` staging
    and `Earnings`, reads every assignment, pushes Base for every Position × period into
    `WFP Workforce Cost`, and then runs `WFP Tax Run(pVersion)` for every person.
- One version takes about 40 s on the lab VM. The planner then waits up to 5 minutes, plus the run
  time, to see the cost of their change.

James's call: "a glaring error". Changes should be tracked and recalculated at the grain they
happen, the way Pigment-style engines do, so the planner sees the cost of their change almost
straight away. The whole-version run stays, but only for changes that really affect every
Position.

## What to build

### 1. Track changes by Position

- `WFP Request Recalculation` gains an optional `pPosition` parameter.
  - **Given:** mark that Position out of date for that version.
  - **Empty:** mark the whole version, as today.
- Store the marks in a small control cube, e.g. `WFP Recalc Queue` (Version × Position × measures
  `Out Of Date`, `Requested At`, `Requested By`). Don't use attributes. Follow the house rules for
  a new cube: default view, measure dimension last, and so on.
- Every action process that changes one Position passes it in. Lens saves pass the Position(s)
  they wrote. Check each caller, and list any that legitimately stay version-wide.

### 2. A process that recalculates one Position

Create `WFP Recalculate Position(pVersion, pPosition)`.

**What has to be recalculated.** Tax is worked out **per person, year to date, across all their
assignments**. So a change to Position P affects:
- every person with an assignment on P in that version (any period), and
- **every Position those people hold or held** in the version, because their YTD tax changes too.

Work out that set first, then for that set only:
1. Clear its `WFP Assignment Base` staging and `Earnings` for the version.
2. **Clear its `WFP Workforce Cost` cells for the version across every entity and cost centre**,
   not just the current ones. A Position that moved cost centre must not leave stale cost under its
   old cost centre. (Check whether the full-version push has this gap today, and say so in the DONE
   file.)
3. Rebuild Base and Earnings using the same logic as `WFP Assignment Base`'s Data section. **Share
   the logic, don't copy it:**
   - either `WFP Assignment Base` takes an optional position scope and both paths use it;
   - or the per-assignment calculation moves into one process that both call.

   Two copies of the pay maths would drift.
4. Run tax for the affected people only. `WFP Tax Run` gains an optional person scope.
5. Run `WFP Rebuild Location Hierarchy` only if P's location changed.
6. Clear P's queue mark. Stamp `Cost Updated At` for the Position.

### 3. Run it straight away on save

- After an action process or a Lens save succeeds, run `WFP Recalculate Position` immediately for
  the Positions changed, so the planner sees the new cost within seconds.
- **If it fails**, or another run holds a lock, leave the Position marked. The chore picks it up.
  A planner's save must never fail because the recalculation did.
- Measure it: the time from save to cost updated, for one Position, on TM1_Test_DEV.

### 4. The chore becomes the safety net

`WFP Recalculate If Needed`:
- **Position marks:** run `WFP Recalculate Position` for each marked Position.
- **Version marks:** run the full `WFP Assignment Base(pVersion)` as today. These remain correct
  for changes that touch every Position: pay rates, tax bands, FX, assumptions, a year roll or a
  bulk load. List which actions set a version mark.
- `pForce = 1` still rebuilds every version.

## Proof (required before DEV)

1. **Same answer:**
   - On TM1_Test_DEV, take a version with real data (Downside, or a copied version, so Forecast
     isn't disturbed).
   - Change one Position (e.g. its hire month) and run the Position recalculation.
   - Copy every `WFP Workforce Cost` and `WFP Assignment Pay` value for that version.
   - Then run the full version rebuild and compare. **Every cell must match.**
   - Repeat for a transfer between cost centres, an end of assignment, and a person holding two
     Positions in a year (the YTD tax case).
2. **Timings:** save to cost updated, before and after, for one Position, and the full version run.
3. Add **assertions** for the transfer and two-Position cases, so this stays proven.

## Rules

- **Read the model from the server** (TM1 MCP tools or the IDE), never from `tmp/workforce/`. Those
  rule files are October snapshots. On TM1_Test_DEV, `WFP Workforce Cost` has **no** `['Base']`
  rule: Base is written by `WFP Assignment Base`, whose Epilog pushes its staging Base into Cost.
- **Build directly on TM1_Test_DEV. No lab step** (James, 20 Nov: the lab stage is behind us).
- **Open one change set before the first change,** and make every change through the MCP tools or
  the IDE so it's recorded. Script changes made outside them don't reach the change set. Apply
  house standards throughout: TI `p/v/n/s/c` prefixes, a
  default view on any new cube, no leftover temporary views or subsets, and a header comment in
  every new or changed process.
- Update `docs/models/WORKFORCE_MODEL.md` (the cost section) and add a short lesson to
  `docs/models/BUILDING_MODELS.md`: change tracking at the grain of the change, with a
  version-wide run only for shared drivers.
- Don't push. Don't restart servers. Don't touch TM1_Test_PROD.
- Anything else you find goes in `docs/models/WFP_POSITION_RECALC_QUESTIONS.md`.

## When finished

Write `docs/models/WFP_POSITION_RECALC_DONE.md` covering:
- what changed, process by process;
- the proof results: the cell-by-cell comparison for each case;
- before and after timings;
- the change set name;
- anything not done.
