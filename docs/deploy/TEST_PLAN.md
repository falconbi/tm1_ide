# Deploy test plan — one change set per scenario

**Rule:** one small change set per scenario, named `T1 …`, closed and deployed on its own.
Record three things for each: the **Check PROD** message, the **Review** list, and the result.

Between scenarios, put PROD back to the state DEV is in (the helper below adds/removes the
same test objects), so the next test starts clean.

---

## T1 — DEV-only dimension change (happy path)

**DEV:** in a new change set, create a consolidation `ZZ TEST CONS` and put one existing
element under it (e.g. `E10004`).

| Stage | Expect |
|---|---|
| Check PROD | `PROD is idle`, `Pre-deploy check passed`, no “PROD has objects” box |
| Tests & close | `Tests: 33/36`, no blocking |
| Build | `included 1 · replaced · dimension WFP Employee` |
| Review | `1 object changes`, `Yes, remove these` only if you removed something |
| Deploy | Done, no drift |

**Pass:** PROD has `ZZ TEST CONS`, and DEV/PROD still match for the dimension.

---

## T2 — PROD has objects DEV does not (kept)

**PROD (out of band):** add two elements + a subset:
```bash
TEST_TARGET=TM1_Test_PROD node tmp/workforce/prod-test-adds.js
```
**DEV:** a new change set with a small unrelated change (e.g. T1's consolidation).

| Stage | Expect |
|---|---|
| Check PROD | Box: `TM1_Test_PROD has objects that TM1_Test_DEV does not have`; `These elements are not in DEV: ZZ_TEST_EMP_A, ZZ_TEST_EMP_B.` |
| Deploy | Succeeds; PROD **keeps** both elements and `Test_New_Adds` |

**Pass:** PROD still has the test objects; DEV does not. Clean up with
`TEST_TARGET=TM1_Test_PROD node tmp/workforce/prod-test-adds.js --cleanup`.

---

## T3 — PROD removed an element DEV still has (kept removed)

**PROD:** delete one element that DEV still has (e.g. `E10004`), directly.
**DEV:** a change set that does **not** touch that element.

**Expect:** Check PROD reports the removal. The deploy leaves it removed on PROD. It does
**not** put it back (only a change set recording a delete/add changes that).

**Pass:** PROD still lacks it; DEV still has it.

---

## T4 — PROD hand-edited a rule (carry-back)

**PROD:** edit a harmless comment in `WFP Workforce Cost` rules directly.
**DEV:** a change set for a process or dimension (anything else).

| Stage | Expect |
|---|---|
| Check PROD | **Stops**: `Cube … changed on PROD`; offer `Bring PROD's version onto DEV` |
| Carry-back | Creates a `carry-back` set, closes it, names it |
| Deploy | Proceeds; PROD keeps its rule |

**Pass:** DEV now has PROD's rule text; the deploy does not overwrite it.

---

## T5 — PROD changed a chore schedule (kept)

**PROD:** change a chore's StartTime directly.
**DEV:** any small change set.

**Expect:** Check PROD reports the chore; deploy keeps PROD's schedule. `Sync DEV` would
copy the schedule to DEV and switch the chore off.

**Pass:** PROD's schedule is unchanged by the deploy.

---

## T6 — dimension the change set does not touch

**PROD:** add an element to `WFP Position` (a dimension the set does not touch).
**DEV:** a change set for `WFP Employee`.

**Expect:** Check PROD reports the `WFP Position` change. The pull plan says `Skip` for it.

**Pass:** the deploy succeeds and PROD keeps its new element. *(This is the case where the
gate should ignore drift entirely; currently it may block — that is the next fix.)*

---

## T7 — both changed the same thing (conflict)

**DEV:** move `E10005` to a new consolidation in a change set.
**PROD:** move `E10005` under a different consolidation, directly.

**Expect:** Check PROD reports the dimension change; the release is built from PROD's live
plus the DEV record, so **DEV's move wins** and PROD's is overwritten. Review must show the
change; if elements are lost, it asks `Yes, remove these`.

**Pass:** PROD ends with DEV's parent. Whether that is acceptable is a policy decision — the
point of the test is that it is **named**, not silent.

---

## T8 — the tests themselves

| Check | Expect |
|---|---|
| Close, normal | `33/36` logic tests; quality (25) not run; 0 blocking |
| Add a test marked `block` with a wrong expected value | Close stops, names it, `Open tests` opens the editor |
| Set that test to `warn` | Close proceeds; it is reported, not blocking |
| Fixture test `ddbbc621` | Runs `WFP Test Setup`, passes at `8,804.40`; does not run on PROD |
| After a deploy | `Logic checks on PROD: 6/6` (not 60 data checks) |

---

## What to record

For each scenario: the change set name, the Check PROD message (quote it), the Review list,
the deploy result, and pass/fail. That is the evidence the flow behaves as described — and
the list of wording that still needs fixing.
