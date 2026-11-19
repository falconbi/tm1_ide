# WFP Position recalculation — open questions

1. **Full-version stale cost.** `WFP Assignment Base`/`Tax Run Post` still clear the default
   Entity / Cost Centre on a full run; only the scoped path clears every Entity / Cost Centre /
   Currency. A full run after a Position move can leave old-centre cost behind. Fix by either
   clearing the scoped set per Position in the full path (slow), or storing the Position's old
   Entity/Cost Centre so the full clear is targeted.
2. **Two-Position YTD proof.** The current Forecast has no named person with two Positions, so the
   case in the brief could not be run. Needs a scratch assignment (or an assertion fixture).
3. **Full-run time** is about 115 s on the full model. Decide whether that is acceptable for the
   rare shared-driver run, or split the version run into phases to measure where it goes.
4. **Change set.** The DEV changes were applied directly, not recorded in a change set. Do they need
   to be replayed through one for governance?
5. **Immediate recalc on other Lenses.** Only `WFP-Positions` runs `WFP Recalculate Position` after
   a save. The other Workforce Lenses rely on the 5-minute chore for their Position marks.
