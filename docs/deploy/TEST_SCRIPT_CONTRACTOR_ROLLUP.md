# Test script — deploy one change: "Contractor rollup"

**What this tests.** Moving two employee elements out of `All Employees` into a new
consolidation is **one change** — one object, one dimension replacement — and it
reaches `TM1_Test_PROD` intact, with no other DEV work riding along.

| | |
|---|---|
| Source | `TM1_Test_DEV` |
| Target | `TM1_Test_PROD` |
| Dimension | `WFP Employee` (main hierarchy `WFP Employee`) |
| Change set | **Contractor rollup** (already open and recorded) |
| PROD test data | `ZZ_TEST_EMP_A`, `ZZ_TEST_EMP_B`, two attributes, subset `Test_New_Adds` (see §0b) |
| Time | ~15 minutes (plus the deploy's own run time) |
| Writes | The deploy step is the only part of this walkthrough that changes PROD. (The §0b test data was written directly, on purpose.) |

---

## 0. What changed (the change being deployed)

Already done on DEV. In the model it looks like this:

**DEV — before**

```
All Employees (C)
├── E10001 (N)
└── E10002 (N)
   … 487 more
```

**DEV — after**

```
All Employees (C)          Contractors (C)
├── … 487 more             ├── E10001 (N)
                           └── E10002 (N)
```

Nothing was deleted or renamed. `E10001` and `E10002` are still elements of the
dimension; only their parent edge moved. That is why the deploy does **not**
remove elements and their stored values survive.

The change set recorded five log rows, all on one object:

| Action | Object | Detail |
|---|---|---|
| `ELEMENT_ADDED` | dimension `WFP Employee` | `Contractors` (Consolidated) |
| `ELEMENT_LINKED` | dimension `WFP Employee` | `E10001` under `Contractors` |
| `ELEMENT_LINKED` | dimension `WFP Employee` | `E10002` under `Contractors` |
| `EDGE_REMOVED` | dimension `WFP Employee` | `All Employees` · removed `E10001` |
| `EDGE_REMOVED` | dimension `WFP Employee` | `All Employees` · removed `E10002` |

> Five rows, **one change**. A deploy ships objects, and this set owns one object:
> `WFP Employee`. The Release screen should say **included 1**.

---

## 0b. PROD-side test data (added on purpose)

While this change set was open, test data was written **directly to PROD** through the
REST API, the way a real load would:

| Object | Name | Detail |
|---|---|---|
| element | `ZZ_TEST_EMP_A` | Numeric, **root** (no parent — nothing rolls up) |
| element | `ZZ_TEST_EMP_B` | Numeric, root |
| attribute | `ZZ_TEST_TEXT` | String — `Prod test A` / `Prod test B` |
| attribute | `ZZ_TEST_NUMBER` | Numeric — `11` / `22` |
| subset | `Test_New_Adds` | static, holds both test elements |

This proves the release keeps the target's **own** load: those objects are not in the
change set, they sit in PROD's live state, and the deploy must leave them intact. The
subset is linked from PROD's hierarchy file, so the release must also carry its file
from live (a pull fails on a link to a file that is not in the release).

Remove it any time with:

```bash
node tmp/workforce/prod-test-adds.js --cleanup
```

---

## 0a. Before you start — confirm the starting state

Run this from the repository root:

```bash
node tmp/workforce/deploy-contractors-check.js
```

**Expect:** `16/16 passed`. It confirms DEV holds the change, PROD does not, the
change set is one object, and PROD's test data and subset are in place.

If it fails on "the change set touches exactly one object", stop — the set contains
something else and this script no longer applies.

Also confirm:

- [ ] The header reads **`Change set: Contractor rollup · 5 changes`** and the dot is
      green (the set is open, do not close it before the flow).
- [ ] `TM1_Test_PROD` is the only target you will use.

> No baseline trouble: PROD's last deploy is recorded, so the refresh step will
> recognise DEV's move as DEV's own work and will not offer to undo it.

---

## Part A — (Optional) Make the change again

Only if DEV does not already hold `Contractors`, or you want to repeat the test
from an empty set. **Start the change set first** or the edits are not recorded.

1. In the header, click **`Change sets`** (or `Change set: …`).
2. Click **`+ New`** in the Change Sets panel header.
3. In **Start Change Set**, type a name, e.g. `Contractor rollup 2`, click **`Start`**.
4. In the Explorer (left sidebar), open **Dimensions → WFP Employee** (double-click).
5. On the dimension toolbar, click **`Tree`**.
6. In the filter box, type **`All Employees`** and expand it.
7. Click the toolbar **`+ Add`**; in the inline row type **`Contractors`**, choose
   **`Consol`** in the type dropdown, click the **✓**.
   - The consolidation is added at the root; it has no children yet.
8. In the tree, drag **`E10001`** onto **`Contractors`**, then drag **`E10002`** onto
   **`Contractors`**.
   - Each drag removes the `All Employees` edge and adds the `Contractors` edge.
9. Confirm `All Employees` no longer lists them, and `Contractors` lists both.
10. Leave the change set **open** for Part B.

---

## Part B — Deploy the change

### B1. Open the deploy screen

1. Click the header's centre button: **`Change set: Contractor rollup · 5 changes`**.
2. In the **Change Sets** panel, click the **`🚀 Deploy`** button at the top right.
   - The **Deploy** tab opens on **Ready to deploy**.
3. At **Ready for**, select **`TM1_Test_PROD`**.
4. Under **In progress**, find **Contractor rollup** and click **`Continue…`**.
   - (If it were already closed it would sit under the normal list with a
     **`Deploy…`** button; both open the same flow.)

**The deploy dialog appears:** title **Deploy `Contractor rollup`**.

5. In **Send to**, select **`TM1_Test_PROD`** if it is not already chosen.
6. Click **`Start pre-deploy`**.

---

### B2. Pre-deploy 1 of 4 — Check PROD

**Do:** wait for the check to finish.

**Expect:**
- Green box: **`TM1_Test_PROD is idle`**
- `Chores due in the next 30 min: none`
- `Nobody signed in.` or only **this deployment's own connection**
- Green box: **`Pre-deploy check passed`**
- A box: **`TM1_Test_PROD has objects that TM1_Test_DEV does not have`**
  - **`They stay on TM1_Test_PROD. This deploy will not remove them.`**
  - **`Dimension WFP Employee — +2 elements: ZZ_TEST_EMP_A, ZZ_TEST_EMP_B`**
  - **`These elements are not in DEV: ZZ_TEST_EMP_A, ZZ_TEST_EMP_B.`**
  - **`Subset Test_New_Adds — 2 members: ZZ_TEST_EMP_A, ZZ_TEST_EMP_B`**
  - **`This subset is not in DEV.`**
  - *"Nothing is sent to TM1_Test_DEV. If TM1_Test_DEV needs them, copy them from
    TM1_Test_PROD with Sync DEV — a separate action."*

`These elements are not in DEV` simply means PROD has them and DEV does not. Only **PROD's additions**
are compared; an edge DEV deliberately removed — this change's own move out of `All Employees`,
for example — is not listed as missing.

That box is **information only** — there is no Sync button in this dialog. Sync is a separate
action in the Deploy tab, never part of a deploy.

Do not continue on a red box or an `N processes running` message.

- [ ] Idle and pre-deploy check passed
- [ ] The changes are listed **with the elements**, not just the dimension name
- [ ] The box offers no action
- [ ] Click **`Continue`**

---

### B2a. Pre-deploy 2 of 4 — Tests & close

Closing runs the model's tests, then files DEV into TM1 Git so a release can be built.

- **What runs:** the model's assertions on `TM1_Test_DEV` — *behaviour* tests
  (the numbers still produce the approved result) and *control* tests (the model
  is internally sound).
- **A block-severity failure stops here.** Nothing is committed and the change set
  stays open. The step lists the failing tests by name, with an **`Open tests`**
  button; fix it on DEV, or set that test's severity to *warn*, then reopen the
  change set's deploy and run **`Run tests and close`** again. A failed test is
  never skipped silently.
- **If they pass:** the set closes and TM1 writes DEV's objects into the `dev`
  branch (the **`DEV After Close`** commit); the IDE writes its attributes to
  `attrs-TM1_Test_DEV`. The results stay on this step — press **`Continue to Build release`**.

**Do:** click **`Run tests and close`**.

**Expect:**
- **`Tests: n/n passed`** with no `· N blocking`
- **`DEV After Close: <10-character commit>`**
- the step stays; click **`Continue to Build release`**

If a block test fails, expect the red **`N block-severity tests failed — the close stopped`**
panel listing each test, and the **`Open tests`** button. Fixing the test and rerunning is the
only way forward; the set cannot be closed around a block failure.

If the change set was already closed before you opened this flow (the normal
"Ready to deploy" entry), the step instead says **`This change set is already
closed`** with its commit and tests, and offers **`Continue to Build release`** —
there is no second close and no second DEV commit.

- [ ] Tests passed, or "already closed" with its commit shown
- [ ] Continue to Build release

---

### B3. Pre-deploy 3 of 4 — Build release

**Do:** click **`Build release`**.

**Expect:**
- **`Release <sha> · included 1`**
- one line: **`replaced · dimension WFP Employee`**

If a **`Changed on TM1_Test_DEV, NOT in this release`** panel appears, leave every
row unticked. This test ships one change only. (Ticking a row and pressing
**`Rebuild including these`** would deliberately widen the release.)

- [ ] `included 1`, and it is `WFP Employee`
- [ ] Click **`Continue to Review`**

---

### B4. Pre-deploy 4 of 4 — Review

**Expect:**
- **`On TM1_Test_PROD: 1 object changes`**
- **`— replace dimension WFP Employee`**
- a **`From TM1_Test_PROD`** box: **`WFP Employee: kept ZZ_TEST_EMP_A, ZZ_TEST_EMP_B — they were added on TM1_Test_PROD after the last deploy.`**
  — that is the test data being kept, not a third change

**Expect no red or amber gates:**
- no **`This deploy changes the type of N elements`**
- no **`This deploy removes N elements`**

A type or loss gate here means the release is doing more than the recorded move.

> The release also carries `Test_New_Adds` from PROD's live tree because the written
> hierarchy file links it. That is a dependency, not part of the change set; the Review
> still shows **1** object changing.

- [ ] 1 object changes, no red/amber gate
- [ ] `kept ZZ_TEST_EMP_A, ZZ_TEST_EMP_B — they were added on TM1_Test_PROD after the last deploy` is named
- [ ] Click **`Continue to Deploy`**

---

### B5. Deploy

1. Tick **`I approve sending Contractor rollup to TM1_Test_PROD.`**
2. The screen says **`Save Data, then }IDE.Backup zips TM1_Test_PROD's data folder beside it.`**
   There is no time to type: the backup is taken by the deploy, and if the archive
   fails nothing is sent.
3. Click **`Deploy to TM1_Test_PROD`**.

**Expect while it runs:** `Checking PROD is still idle…` → `Recording your
approval…` → `Saving data, then the backup…` → `Verifying…`.

**Expect when it finishes:**
- **`Done — TM1_Test_PROD is up to date`**
- `Checks x/x · data saved HH:MM · last backup HH:MM · no drift`
- **`Awaiting sign-off — test it on TM1_Test_PROD, then confirm in the report (Details).`**

- [ ] Done, and it says **no drift**
- [ ] Click **`Details`** (leave the report open for Part D), or **`Done`**

> **If it goes wrong:** the same screen names the restore point. Restore PROD's data
> folder from that backup outside the IDE, then use **Deploy → Drift →
> `TM1_Test_PROD restored from a backup…`** (admin only) to move its pointers back.

---

## Part C — Verify the change landed

### C1. Script check

```bash
node tmp/workforce/deploy-contractors-check.js --after
```

**Expect:** `18/18 passed` — PROD has `Contractors` with the same two children as
DEV, both elements are gone from `All Employees`, nothing DEV had went missing, the
two `ZZ_TEST_EMP_*` elements kept their attribute values, `Test_New_Adds` still holds
them, and the change log records the deploy.

### C2. By hand on PROD

1. Switch the active server to **`TM1_Test_PROD`**.
2. Explorer → **Dimensions → WFP Employee** (double-click).
3. Toolbar **`Tree`**, expand the roots.
4. **Expect:**
   - `Contractors` (consolidation) contains **`E10001`**, **`E10002`**
   - `All Employees` does **not** contain them
   - `ZZ_TEST_EMP_A` and `ZZ_TEST_EMP_B` are **still there**
   - no `Contractors` duplicate, no missing elements
5. Optional — values survived the move: open a cube view that shows `E10001`
   (`WFP Assignment`, `WFP Employee` on rows). Its numbers are unchanged; a move
   changes the hierarchy, not the cells.
6. Subsets: switch the dimension view to **`Subsets`** (or the Explorer's subset
   list) and open **`Test_New_Adds`** — it still holds `ZZ_TEST_EMP_A`,
   `ZZ_TEST_EMP_B`.
7. Attributes: switch the dimension toolbar to **`Attrs`**; `ZZ_TEST_TEXT` and
   `ZZ_TEST_NUMBER` still carry `Prod test A` / `11` and `Prod test B` / `22`.

- [ ] PROD tree matches DEV
- [ ] PROD's test elements, values and subset intact
- [ ] (Optional) values unchanged

---

## Part D — Sign off

Sign-off is the developer confirming they tested on the target by hand.

1. In the deploy report opened from the Done screen, find the amber card
   **`Awaiting sign-off`**.
2. Click **`I tested this on TM1_Test_PROD`**.
   - Or: **Deploy → History**, open the `Contractor rollup` record and use the same
     button. From the Change Sets panel, expanding the row shows it too.
3. **Expect:** the card turns green, **`Signed off`**, with `Tested on
   TM1_Test_PROD by <you> · <time>`.

- [ ] Signed off
- [ ] The Change Sets row now reads `deployed to TM1_Test_PROD · signed off by …`

---

## Part E — Confirm no drift

1. **Deploy → Drift**.
2. Select **`TM1_Test_PROD`**.
3. **Expect:** no drift — PROD matches the commit it was last given. A single
   `WFP Employee` line mentioning DEV-side differences that are not deployed is
   acceptable; anything else means something changed on PROD outside the deploy.

- [ ] No drift (or only the known DEV-side note)

---

## Checklist

| # | Checkpoint | Expected |
|---|---|---|
| 1 | Live pre-check script | `16/16 passed` |
| 2 | Change set | `Contractor rollup`, open, 5 rows on one object |
| 3 | Check PROD | idle · pre-deploy check passed |
| 4 | PROD changes named | elements listed; information only — nothing copied |
| 5 | Tests & close | tests n/n passed · DEV After Close commit (or "already closed") |
| 6 | Build release | included **1** · replaced dimension `WFP Employee` |
| 7 | Review | **1** object changes · 2 PROD-added elements kept · no type/loss gate |
| 8 | Deploy | `Done — TM1_Test_PROD is up to date` · no drift |
| 9 | Live post-check | `18/18 passed` with `--after` |
| 10 | PROD tree | `Contractors` = {E10001, E10002}; out of `All Employees` |
| 11 | PROD test data | `ZZ_TEST_EMP_*` values intact · `Test_New_Adds` still holds both |
| 12 | Sign-off | `Signed off` on the record |
| 13 | Drift | none |

---

## Troubleshooting

| What you see | What it means | Do |
|---|---|---|
| Header says `6 changes` or more | Something else was recorded in the set | Stop; inspect the set's log before deploying |
| The check names PROD changes | They are PROD's own; the deploy keeps them | Continue. Sync is a separate action in the Deploy tab, not part of this deploy |
| You ran `Sync DEV from PROD` from the Deploy tab | PROD's test elements/subset are copied onto DEV | The deploy itself is unaffected; undo the copy on DEV in its own set if you need to |
| Review shows `removes N elements` | The release is replacing the dimension with fewer members | Do not continue; check the baseline |
| Review does not name the 2 PROD-added elements | The release is built from a base without PROD's live state | Stop; check `live-TM1_Test_PROD` and the target's last deployed commit |
| `This change set is closed` at step 2 | You closed it before the flow | Click **`Reopen the change set`**, then refresh and close again |
| Deploy button greyed out | Not approved, or the backup time is empty | Tick the approval, fill `When was … last backed up?` |
| Done says `awaiting sign-off` | Normal — the deploy succeeded | Test on PROD, then sign off (Part D) |
