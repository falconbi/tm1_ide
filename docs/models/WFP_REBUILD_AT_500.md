# Rebuilding the Workforce test model at a smaller size

Runbook for resetting `TM1_Test_DEV` (and then `TM1_Test_PROD`) to a **deterministic, fully
seeded** model — for example 500 positions instead of 3,000 — so the tests can be re-baselined
honestly instead of chasing data that no longer exists.

Use it when the model's stored data has drifted from what the assertions expect and cannot be
reconstructed (missing actuals load, missing snapshot versions, damage from a structural change).

---

## 1. What lives where — decide what you are willing to lose

| Thing | Stored in | Carried by Git / a deploy? |
|---|---|---|
| Cubes, dimensions, processes, chores | the model **and** the Git export | **Yes** |
| **Tests / assertions** | `Applications/Governance/Tests` in the model | **No** |
| **Change sets, approvals, deploy state, baseline** | `Applications/Governance/…` | **No** |
| **Lenses** | `Applications/Governance/Lenses/<name>.json` | **No** |
| Subsets, views | the model (and Git, as files) | Yes |

Consequences that matter here:

- A **Lens survives a model rebuild** unless the `Applications` tree is deleted, or the cubes it
  reads/writes are renamed or removed. Lenses address cubes by name at runtime
  (`config.writes`, `config.processes`, and the cube names inside the Lens HTML).
- A **catch-up to PROD does not carry** tests, approvals, deploy state or Lenses — they stay on
  the server they were written on. PROD keeps its own.
- The **assertions you are re-baselining live on DEV** and are not overwritten by the catch-up.

## 2. Preconditions

1. **Back up both data directories** (`TM1_Test_DEV`, `TM1_Test_PROD`) before anything else.
   This is the only way back if the rebuild goes wrong; nothing in the IDE can restore it.
2. Tell whoever is using the model. The rebuild wipes cube data and may delete dimensions.
3. Record the current state so you can tell what changed:
   - `Deploy → Drift` for PROD (expect 0),
   - `Deploy → Model health` counts on DEV,
   - export the **tests** and the **Lenses** (`Applications/Governance/Lenses/*.json`) as files
     if you have any doubt about keeping them.

## 3. Decide the assertion set first — this is the real work

A smaller roster invalidates every total, so classify the existing assertions **before** running
anything:

| Kind | Keep? | Why |
|---|---|---|
| One position's number (e.g. `ENG-002 cost to company = 98,560.20`) | **keep as a literal** | depends on that position, not on the roster size |
| An invariant (`group = sum of children`, `headcount = count of positions`, `FTE = sum of FTE`) | **keep, rewrite as an invariant** | true at any scale, which is what a deploy check should be |
| Group totals for a fixed roster (`Group Cost to Company FY2026 = 222,404,706.79`) | **rewrite or drop** | only meaningful at the old scale |
| Anything needing a **snapshot version** (`FCST 2026-02/03`, variance versions) | keep only if you will reproduce the snapshots | otherwise they fail forever |
| Anything needing **loaded actuals** | keep only if the load file still exists | actuals are not seeded |

Set severity deliberately:

- **block** (stops a change set closing) — invariants and per-position financial checks;
- **warn** — model-data expectations you are still shaking out.

Do not set everything to `warn` to make a rebuild pass: a control check that is always yellow
stops being a check.

## 4. Rebuild DEV

Follow `docs/models/BUILDING_MODELS.md` for the model itself. The data sequence is in
`docs/models/workforce-setup/README.md`, and `tools/reseed-workforce.cjs` runs it:

1. Rebuild the model's cubes and dimensions as the build doc describes (or clear the cubes and
   delete the generated roster, whichever the build doc says for your case).
2. Keep the **hand-typed roster** (`ENG-*`, `EXEC-*`, `SALES-*` positions). The generator adds to
   it; it does not replace it.
3. Seed the data. **`Generate Positions` with `pCount = 500`** and the original `pSeed`
   (20261020) — the same seed keeps the roster deterministic, the count keeps it small:

   ```bash
   # edit PARAMS in tools/reseed-workforce.cjs: pCount 500
   node tools/reseed-workforce.cjs TM1_Test_DEV --run
   ```

4. **Snapshots** (optional, only if you keep the assertions that need them): run
   `Generate Hiring Plan` with `pStage=feb`, then `WFP Snapshot`, then `pStage=now`.
5. **Actuals** (optional): `WFP Load Actuals` if its file is still available. Without it, every
   `Actual` assertion must go or be rewritten.
6. Recalculate. Use the direct REST call — the IDE route gives up at 120 s while TM1 keeps
   working, and a client disconnect can cancel the run:

   ```bash
   curl -u admin:apple -X POST \
     "http://<host>:<port>/api/v1/Processes('WFP%20Recalculate%20If%20Needed')/tm1.ExecuteWithReturn" \
     -H 'Content-Type: application/json' -d '{"Parameters":[{"Name":"pForce","Value":"1"}]}'
   ```

   Wait for `CompletedSuccessfully` (minutes on this model). Then remove the nine seed processes
   with `node tools/reseed-workforce.cjs TM1_Test_DEV --cleanup`.

## 5. Re-baseline the assertions

`Deploy → Model health` (or the tests panel):

1. Run them and read the failures against the classification in §3.
2. Rewrite the group-total expectations **as invariants** where possible; delete the rest.
3. Keep per-position literals only for positions that still exist and whose inputs did not change.
4. Leave the count as it is — a smaller model with 15 real checks beats 60 borrowed numbers.
5. Close the model's tests as a normal change, so the set has a history from here on.

## 6. Ship the new model to PROD

DEV and PROD must move together, or drift blocks every deploy:

1. `Deploy → Catch up a server…`, target `TM1_Test_PROD`. A catch-up ships **everything that
   differs**, not one change set — that is the intended path for a whole-model reset.
2. Approve and deploy. It will ask for the backup confirmation and Save Data, as usual.
3. `Deploy → Drift` → expect **0**. If not, do not ship anything else until it is.
4. Re-enable the PROD guard (`readOnlyServers`) if you lifted it for any step.

## 7. Check the Lenses

Lenses are not in Git and are not carried by the catch-up, so:

- **On DEV:** they are still under `Applications/Governance/Lenses/`. Open each one from the
  Lenses tab. A Lens fails only if it names a cube or process that the rebuild removed or renamed
  — the bridge reports `Cube "X" not found (or no access) on this server`.
- **On PROD:** they are whatever PROD already had. A rebuild of DEV does not add, change or
  remove them there. If you want a Lens on PROD, use **Deploy → Lenses**, which is its own
  governed ship.
- If you deleted the `Applications` tree as part of the rebuild, restore the Lens JSON files from
  the backup taken in §2.

## 8. Verify

- [ ] Assertions: the new set passes on DEV (and the blocking ones are genuinely blocking).
- [ ] PROD drift **0** after the catch-up.
- [ ] PROD guard on; no `readOnly` left off after a direct edit.
- [ ] The nine seed processes are gone again.
- [ ] DEV chores are **off** (they must never run at production times).
- [ ] Every Lens opens; `Deploy → Lenses` shows what PROD has.
- [ ] A trivial change set can still be closed, released and deployed end to end.

## 9. Rollback

Stop TM1, restore the data directories from §2, start TM1 **without saving**, and confirm with the
drift check. Do not run Save Data over a bad state — it makes the rollback point worse.
