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
| Cost-centre move, then **full** run | full run clears every stored Base/tax cell for the version; old centre zero, new centre present (118 s) |
| Two Positions (E10002 on ENG-001 + temporary ENG-002, March) | full run **113 s**; partial vs full **0 differences**; temporary assignment removed and full restore checked |
| Full Forecast run | ≈ **113–118 s** |

The start-month test was restored and re-run; the cost-centre and end tests were also restored. ENG-007's approval and hire month were restored.

## Not done

- **Two-Position YTD case:** proven with a temporary second assignment for E10002; data removed
  and the full run restored.
- **Full-version clear gap — fixed:** `WFP Clear Cost Version` clears stored Base/tax for the
  version before a full run, using a saved view with `ViewExtractSkipZeroesSet` and a Version
  title. Proven with a cost-centre move then full rebuild.
- **Full-run speed:** ≈113–118 s, not the ~40 s stated in the brief.
- **Assertions** for the transfer and two-Position cases are not added.

## Change set and commit

- Change set: `WFP position-level recalculation` (`62c387fb-8d39-40a3-9625-97ccca857710`),
  server `TM1_Test_DEV`, open for review/close.
- DEV Git branch `dev` commit: `46bc5e2b` (`WFP position-level recalculation`).
- The Workforce Lenses (`WFP-Positions` v14, `WFP-Hire-Approvals` v22) are model documents, not Git:
  ship them with **Deploy → Lenses**, not the Git release.
