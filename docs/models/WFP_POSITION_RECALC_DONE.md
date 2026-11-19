# WFP Position recalculation — done (partial)

Date: 20 Nov 2026 · Model: WFP on `TM1_Test_DEV`

## What changed

- **`WFP Recalc Queue`** (new): Version × Position × measures `Out Of Date`, `Requested At`,
  `Requested By`, `Updated At`, `Rebuild Location`. Default view.
- **`WFP Control`** gained `Recalc Locked`, `Recalc Lock At`, `Recalc Lock By`.
- **`WFP Request Recalculation(pVersion, pPosition, pRebuildLocation)`**: empty Position marks the
  whole version as before; a Position marks only that row with a request timestamp.
- **`WFP Recalc Scope` / `WFP Recalc Scope Positions`** (new): build the affected people and
  Positions. Planned Hire is deliberately not treated as a person linking all planned Positions.
- **`WFP Recalculate Position(pVersion, pPosition, pRebuildLocation)`** (new): takes the version
  lock, runs the scope, Base, tax and (only when asked) the By Location rebuild, clears the queue
  token it started, releases the lock. If anything fails the mark stays.
- **`WFP Assignment Base`**: optional `pPositionSubset` / `pEmployeeSubset`. Clears only the scoped
  staging/Earnings and Base in Cost, pushes Base for the scoped Positions, then calls Tax with the
  same scope. Empty scope = full run. The pay maths is still one Data section.
- **`WFP Tax Run`**: optional position/people scope. Clears only affected Person Tax and per-
  assignment tax, computes people from the scoped subset, posts with the same scope.
- **`WFP Tax Run Post`**: optional position/people scope. Clears tax lines only for the scoped
  Positions and posts from the scoped view.
- **`WFP Rebuild Location Hierarchy`**: optional `pPosition`; the Position path rebuilds only that
  Position when its queue says location changed.
- **`WFP Recalculate If Needed`**: full marks run as before under the version lock; Position marks
  run `WFP Recalculate Position`. A failed full run re-marks the version. A full run clears only
  position marks requested before it started.
- **11 action processes** now pass `pPosition`. Version-wide on purpose: Create TBH Position, End
  Assignment, Record Absence, Transfer Person, Match TBH, Unmatch TBH.
- **`WFP-Positions`** Lens (v14): marks the changed Position and runs the Position recalculation
  immediately for up to 10 Positions.
- **`WFP-Hire-Approvals`** Lens (v22): added the missing **Reopen** button on an approved hire.
- **`WFP-Positions`** runs the Position recalculation immediately for a changed row (up to 10), then the chore handles the rest.

## Proof

Measured on the full `WFP` model, `TM1_Test_DEV`:

| Case | Result |
|---|---|
| ENG-001 start month changed | Position run **0.4 s**; partial vs full **0 differences** (214 cost cells) |
| ENG-001 cost-centre moved for 2026-01 | old `CC-ENG-PLT` cost cleared, new `CC-ENG-APP` cost present; restore recalc matched baseline (0 differences) |
| ENG-001 end of assignment at 2026-06 | June cost present, July zero; restore recalc matched baseline (0 differences) |
| Full Forecast run | ≈ **115 s** |
| Planned hire (ENG-007) hire month | mark/recalc completed, but the old and new cost snapshots were empty — inconclusive |

The start-month test was restored and re-run; the cost-centre and end tests were also restored. ENG-007's approval and hire month were restored.

## Not done

- **Two-Position YTD case:** no current person holds two Positions in Forecast, so it was not
  exercised. (Planned Hire is per Position and was handled explicitly.)
- **Full-version clear gap:** the scoped path clears the affected Position across every Entity /
  Cost Centre / Currency. The *full* run still clears only the default Entity / Cost Centre, so a
  full run after a move can leave stale cost in the old cost centre. This is the pre-existing gap;
  partial is correct.
- **Full-run speed:** ≈115 s, not the ~40 s stated in the brief.
- **Change set:** the changes were made directly through the TM1 API, not through an IDE change set.
- **Assertions** for the transfer and two-Position cases are not added.
