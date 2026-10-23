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
- **Salary is per assignment** (the person's terms, from HR). The Position's `Base Salary`
  is only the default for a vacant/new Position.
- **Decision 5: pay and FTE are effective-dated by month** in a new cube
  **`WFP Assignment Pay`** (Version × Position × Employee × Period × Measure: `Base Salary`,
  `FTE`). The detail keeps the dates and Handover; the dated pay cube is the cost source, so a
  pay rise or FTE change is a value from a month, not a new record.
- `WFP Assignment` stays for month-level presence and flags (headcount, leavers, transfers).

Backfill from today's assignments: first/last month and reasons from `WFP Assignment`;
salary from the Position's current `WFP Workforce Input` until HR supplies per-person
salaries.

## Proposed cost

A TI process (`WFP Assignment Cost`) reads the detail dates and the dated pay cube, and per assignment, **month by month**:

- prorates by **days**,
- carries **YTD earnings / employer and employee tax** for that person (continuing across a
  transfer within the same company; restarting on a company move),
- sums the components (Base, ER tax, pension, benefits, bonus) into the **Position** for the
  existing Cost cube and pages.

The Position is the reporting grain; the **calculation grain is the assignment**. The
on-cost/tax logic moves out of the Position-level rules into this engine — it is across-time
work, which belongs in TI (design rule #1).

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
- 58 assertions (was 62 before four duplicates were removed).
- Reversible handover test: leaver 27 Aug / starter 27 Aug → Headcount 2, FTE 2, cost =
  leaver 27/31 + starter 4/31, control exempt; then restore.

## Decisions (resolved)

1. **Salary per assignment — DECIDED (yes).** Pay belongs to the assignment, not the
   Position, and is effective-dated by month (decision 5). The Position's `Base Salary` is only
   the default for a vacant/new Position.
2. **Cost granularity — DECIDED: assignment grain.** Cost and tax are calculated per
   assignment, then rolled up to the Position for the existing pages. One person holds **one
   Position at a time** (no simultaneous split), so tax per assignment = tax per person.
   Sequential assignments (a transfer) must **carry the person's YTD** across the move within
   the same company. A **company change is not a Transfer**: the person leaves the old company
   and takes a new Position/assignment in the new company (the YTD restarts). `WFP Transfer
   Person` is same-company only — it refuses a cross-company target, and the Position roster
   filters its target list to the person's current company.
3. **Day basis — DECIDED: working days.** The engine needs a working-day count per period
   (add a `Working Days` attribute on `WFP Period`, or a calendar; holidays still to decide).
4. **Handover — DECIDED: explicit.** The incoming assignment is marked as a handover; only
   marked overlaps are exempt from `Over-filled`. Unmarked over-fills still flag.
5. **Pay/FTE history — DECIDED: effective-dated monthly measures.** Pay and FTE live in
   `WFP Assignment Pay` by month; a change is a dated value. Do not split assignment records
   and do not store a single salary/FTE for a multi-month spell as the cost source.
6. **Test lab — DECIDED: WFP_Lab.** A small model generated by script from WFP's own
   definitions (dimensions, cubes, rules, processes), used to prove steps 1, 3 and 4 in seconds
   before applying them to WFP.

All six decisions are resolved.

## Related

- `docs/BUILDING_MODELS.md` rule #1 (TI for heavy/across-time work), rule #2 (version
  lifecycle), rule #3 (server-wide control).
- Effective-dated assumptions (`_Effective …` measures) already flow forward.
- Position vs Seat: the user-facing noun is **Position**; model object names
  (`Seat FTE`, `Seat Status`, `WFP Move Seat`, `WFP-Seat-Roster`) are Phase 2.
