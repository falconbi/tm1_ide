# 07 — Deploy round 4: questions and out-of-scope notes

Found while building round 4. None of these blocked the work; they are recorded
rather than fixed.

1. **The change-set list still reads only the local log on a model-owned server.**
   `GET /api/sessions` calls `cl.getSessions(server)`. Round 2 made the model the
   truth for a closed record and `change-set-service` now writes won't-deploy and
   covered fields into it, but the list does not read
   `Applications/Governance/ChangeSets`. A fresh IDE on a model-owned server would
   list nothing. Pre-existing, not caused by round 4.

2. **`ownerOf` still keys a subset by dimension, not hierarchy.**
   `objectKey('subset', name, parent)` uses the dimension. `Default` on
   `WFP Position` and on `WFP Position › By Location` are the same key. Round 3
   recorded this; round 4's won't-deploy and covered skips inherit the limit.

3. **Unpushed DEV is inferred from GitStatus fields that need a live check.**
   `sourcePushedCommit` uses `LocalCommit.ID` (the field `execute` already reads
   from the source) and treats `HasLocalChanges`, `UnpushedChanges`, `Changes` or
   `LocalChanges` as pending work. TM1py's `GitStatus` model exposes
   `DeployedCommit`/`Remote`, not these; if this v11 build reports none of the
   pending flags and keeps a `LocalCommit`, a dirty DEV with an older pushed
   commit could pass. Check on TM1_Test_DEV before relying on the refusal.

4. **Catch-up target-only objects are cubes, dimensions, processes and chores
   only.** `targetOnlyObjects` compares those four lists with the repo at DEV's
   commit. Target-only views and subsets are also left behind by TM1 Git; they
   are not listed. Extend the helper if that matters.

5. **`deployed` and `covered_by` are independent signals.** `GET /api/sessions`
   still computes `deployed` from the baseline's `last_entry_id`; covered sets
   are a separate field. A covered set can also appear deployed. The UI shows the
   covered badge first and hides both together, so the duplication is invisible.

6. **The catch-up entry is on the Deploy Center rail, not the top Deploy menu.**
   It is rendered per eligible target as `Catch up <target> with <source>…` and
   only for a TM1 admin. The server refuses a non-admin too.
