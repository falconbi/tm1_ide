# Assignment list per Position — design

Status: draft for review (22 Oct 2026). No code yet.

## Why

A Position is the budgeted establishment; the **tenure** belongs to the **assignment**
(person × Position). A Position can have a leaver ending 27 Aug and a starter beginning
27 Aug — two assignments on one Position, overlapping for the handover.

The model today cannot express that:

- `WFP Assignment` is **month-level** (FTE Share > 0) and carries Start/End Reason, but no
  **start/end dates or days**.
- `WFP Workforce Input` holds **one FTE and one Base Salary per Position** — a leaver and a
  starter cannot be paid differently.
- Cost is per **Position** (no Employee dimension) and its proration uses the **Position's**
  Start/End attributes, not each assignment's dates.
- The `Over-filled` control flags a legitimate handover overlap as bad data.

## Proposed data

New cube **`WFP Assignment Detail`**

- Dimensions: `WFP Version × WFP Position × WFP Employee × WFP Assignment Detail Measure`
  — one record per assignment, **not** per month.
- Measures: `Start Period`, `Start Day`, `End Period`, `End Day`, `FTE`, `Base Salary`,
  `Handover` (0/1).
- `WFP Assignment` stays for month-level presence and flags (headcount, leavers, transfers).

Backfill from today's assignments: first/last month and reasons from `WFP Assignment`;
salary from the Position's current `WFP Workforce Input` until HR supplies per-person
salaries.

## Proposed cost

A TI process (`WFP Assignment Cost`) reads the detail, **prorates each assignment by days**,
and sums by Position × Month × Version into a **cost driver** (e.g. a new `Assignment Base`
measure in `WFP Workforce Input`). The Cost rules use that driver as `Base`; the existing
on-cost and tax chain runs on it unchanged.

- Keeps the current **Position-level** tax granularity (already an approximation).
- Gets **day-accurate handovers** and **two salaries**.
- Per-person cost (adding Employee to Cost) is the “perfect” version but changes every page;
  not recommended now.

## Handover and the Over-filled control

- Two overlapping assignments are allowed: Headcount 2, FTE 2 during the overlap.
- `Over-filled` allows **Seat FTE + Handover FTE** in that window only.
- A separate **informational** check lists the overlap (days / FTE) without treating it as
  bad data.
- Mark the overlap explicitly (`Handover`), not "any same-month overlap" — an automatic
  exemption would hide genuine bad data.

## UI

An **assignment list** per Position — select a Position (Position roster, or a new
“Assignments” page): Person · From · To · FTE · Salary · Reason · Handover.

Actions write the detail dates; the existing processes keep the month-level assignment:

- Assign / Record hire → new assignment with dates.
- End assignment → End date.
- Transfer → end the old assignment and start the new one.

## Staged plan

1. `WFP Assignment Detail` + backfill + read-only assignment list.
2. TI cost driver + Base rule switch (compare must be 0 on existing data).
3. Handover flag + Over-filled exemption + informational check.
4. Assignment actions writing the detail.

## Proof

- Compare script: 0 on unchanged data; differences only where a handover exists.
- 62 assertions.
- Reversible handover test: leaver 27 Aug / starter 27 Aug → Headcount 2, FTE 2, cost =
  leaver 27/31 + starter 4/31, control exempt; then restore.

## Decisions (open — take one at a time)

1. **Salary per assignment** — store `Base Salary` per assignment in the detail (sourced
   from HR), instead of one salary per Position.
2. **Cost granularity** — position-level aggregation (recommended) or per-person.
3. **Day basis** — calendar days or working days.
4. **Handover** — explicit flag (recommended) or derived from overlapping dates.

## Related

- `docs/BUILDING_MODELS.md` rule #1 (TI for heavy/across-time work), rule #2 (version
  lifecycle), rule #3 (server-wide control).
- Effective-dated assumptions (`_Effective …` measures) already flow forward.
- Position vs Seat: the user-facing noun is **Position**; model object names
  (`Seat FTE`, `Seat Status`, `WFP Move Seat`, `WFP-Seat-Roster`) are Phase 2.
