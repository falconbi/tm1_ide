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

## HR extract and load (Step 2 — done 23 Oct)

`WFP Load HR Assignments` (pFile, pClear, pCost) reads the HR extract — one row per
assignment, plus a continuation row (Reason `Pay change`) whenever its pay or FTE changes:

`EmployeeID, Name, Position, Entity, EmploymentType, FTE, StartDate, EndDate, Reason, EndReason, BaseSalary`

- Dates `yyyy-mm-dd` (a bare `yyyy-mm` = day 1 / the last day); blank `EndDate` = runs on; a
  start before the model's first month counts from that month (an opening person).
- Writes Actual up to the cut-off: `WFP Assignment` (FTE Share, Start/End Reason),
  `WFP Assignment Detail` (the record — clipped to the cut-off year, the Actual cost months),
  `WFP Assignment Pay` (salary + FTE each month, so a pay change is dated).
- `pClear = 1` clears Actual in all three; `pCost = 1` reruns `WFP Assignment Base`.
- Employee Status is set from the HR row (Active while it runs, Leaver when it ends with an
  end reason) — a continuation row doesn't change it.
- `WFP Write Sample HR Extract` stands in for HR: it writes this layout from today's Actual
  (through a view), so a clean reload reproduces Actual exactly.
- Proof (23 Oct): reload = every Actual assignment identical; compare 0 (702,222 values);
  59/59. A March pay rise on one person → two HR rows → March pay and cost follow; reverted.
  Intended changes: E10003's record starts Jan 2026 like everyone else's (Dec isn't a cost
  month); 108 people's Status Leaver → Active (the old sample took a Position's future end
  date as the person's).

## Handover (Step 3 — done 23 Oct)

- **Create:** `WFP Assign Person` with `pReplace = 'handover'` and `pHandoverUntil` (the
  outgoing person's last month): the current people stay through that month and then leave
  (End Reason Leaver, record End Period); the new person starts at `pFrom`; the overlap is
  marked automatically. `pReplace = 'yes'` (end the month before) and `'no'` (refuse) are
  unchanged.
- **Mark / clear:** `WFP Mark Handover` (pVersion, pPosition, pEmployee, pAction mark|clear).
  Writes the incoming person's FTE to `WFP Assignment` → `Handover FTE` in each month they
  overlap someone else on the Position, and `Handover` = 1 on their record. It refuses the
  outgoing person (whoever held the Position the month before the overlap) and Actual.
- **Checks:** `Over-filled` = FTE Share − Handover FTE > the Position's FTE — so a marked
  overlap is allowed and an unmarked one still flags. `In Handover` (new, informational)
  counts Positions in a handover; it is not an error.
- **Cost:** both people are paid during the overlap. `WFP Assignment Base` now **adds** each
  assignment's cost to the Position (`CellIncrementN`) — it used to overwrite, so a Position
  with two people in a month (handover, job share) was costed for one. No existing data had
  two people in a month, so today's numbers were unaffected (compare 0).
- `WFP Assign Person` now also writes the new assignment's monthly pay
  (`WFP Assignment Pay`: pSalary, or the Position's salary) — before, a new hire was costed
  at the pay band midpoint whatever salary was given.
- Proof (Downside ENG-001, reverted): handover hire Aug, outgoing through Sep → In Handover
  Aug–Sep, Over-filled 0; clear → Over-filled Aug–Sep; re-mark → 0; marking the outgoing
  person refused; cost ENG-001 Jul–Oct 11,042 / 22,083 / 22,083 / 11,042. After restore:
  compare 0 (702,222), 59/59.
- **Not yet:** the Position roster Lens has no "handover" option in its Assign form; if
  the outgoing person's end later changes, `Handover FTE` isn't recalculated (re-run Mark
  Handover).

## Position change — regrade, budgeted FTE, location (Step 4 — done 23 Oct)

- `WFP Change Position` (pVersion, pPosition, pFrom, pGrade, pFTE, pLocation): from `pFrom` to
  the end of the plan, in the months the Position is open, writes Position Map `Grade` /
  `Location` and budgeted FTE (Position Map `Seat FTE` **and** Workforce Input `FTE`, zeroed
  then written so the feeders fire). Months before are untouched. Blank / −1 = unchanged.
- The person in the Position keeps their own pay and FTE (the assignment). If their FTE is
  now above the Position's, the message says so and Over-filled flags it.
- Refuses: Actual, a month in actuals, a closed Position, an unknown grade/location,
  FTE ≤ 0 or > 1 (closing is Step 5's Close Position).
- `WFP Assignment Base` now reads the Position's **dated** grade and location (Position Map,
  falling back to the attribute) for the pay-band fallback — as the cost rules already did.
  No effect on today's data (compare 0).
- Proof (Downside ENG-001, reverted): FTE 0.8 from Oct → Sep 1 / Oct+ 0.8 in both stores,
  warning, Over-filled Oct+; grade G4→G5 from Oct → Benefits 240→320 (G5 rate), Base
  unchanged; refusals OK. After restore: compare 0, 59/59.
- **Gap found:** on-costs (Benefits, pension, bonus, employer tax) are still worked out from
  the **Position** (its salary × budgeted FTE in `_Monthly Base Full`), not from the person's
  assignment — only Base moved to the assignment in Step 1. So a Position at 0.8 with a person
  at 1.0 gets Base for 1.0 but Benefits for 0.8. Move the on-costs onto the assignment too.

## Related

- `docs/BUILDING_MODELS.md` rule #1 (TI for heavy/across-time work), rule #2 (version
  lifecycle), rule #3 (server-wide control).
- Effective-dated assumptions (`_Effective …` measures) already flow forward.
- Position vs Seat: the user-facing noun is **Position**; model object names
  (`Seat FTE`, `Seat Status`, `WFP Move Seat`, `WFP-Seat-Roster`) are Phase 2.
