# WFP Position recalculation — open questions

1. **Full-run time** is about 113–118 s on the full model. Decide whether that is acceptable for the
   rare shared-driver run, or split the version run into phases to measure where it goes.
2. **Assertions** for the transfer and two-Position cases are not added yet.
3. **Immediate recalc on other Lenses.** Only `WFP-Positions` runs `WFP Recalculate Position` after
   a save. The other Workforce Lenses rely on the 5-minute chore for their Position marks.
4. **Change set** `62c387fb-8d39-40a3-9625-97ccca857710` is open and linked to DEV commit `46bc5e2b`;
   close and review it before releasing.
