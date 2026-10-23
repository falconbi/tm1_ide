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

## Close, reopen, company move (Step 5 — done 23 Oct)

- **`WFP Close Position`** (pVersion, pPosition, pLast): open through `pLast`, closed from the
  month after (Position Map `Seat FTE` 0, Workforce Input `FTE` 0); months before untouched.
  Refused while anyone holds it after `pLast` (end or transfer them first) or a hire is planned
  after `pLast`. A hire month at or before `pLast` is history: it's cleared (with its approval)
  and the planned-hire record ends at `pLast` — otherwise the planned-hire window (which runs to
  the Position's unversioned End Period attribute) would count the closed Position again.
- **`WFP Reopen Position`** (pVersion, pPosition, pFrom, pFTE −1 = last FTE): the same budget
  line only — it must have been open earlier in `pFrom`'s plan year (`FY`), otherwise
  "create a new Position". Opens the closed months from `pFrom`, vacant.
- **`WFP Move Position To Company`** (pVersion, pPosition, pFrom, pEntity, pCostCentre,
  pNewPosition, pSalary): a Position never changes company. Creates a new Position
  (`<Position>-<2 letters>` by default) under the same parent with the company's currency
  (`Local Currency`), location (`Primary Location`) and tax (from a Position already there);
  copies grade and FTE from `pFrom`; each holder leaves the old Position the month before
  (End Assignment, Leaver) and is hired into the new one (Assign Person, Hire, `pSalary` in the
  new currency); the old Position closes. Year-to-date tax restarts with the new employer.
- Proof (Downside, all reverted): close of a held Position refused; SLS-1078 closed after Jun /
  re-close refused / reopened from Aug (Jul stays closed); future-hire and other-plan-year
  refusals; ENG-001 → US Inc from Oct 2026 at $160,000: Alice Leaver Sep / Hire Oct on
  ENG-001-US, cost USD 13,333/month (≈ £10,533), US `_Earnings YTD` restarts in Oct. After
  restore: compare 0, 59/59.

## On-costs follow the person (done 23 Oct)

- Checked every component: **Employer Pension, Employee Pension, Bonus and the YTD payroll-tax
  chain are all worked out from `Base`** — which `WFP Assignment Base` writes from the people's
  assignments since Step 1 — so they already followed the person.
- **Benefits** was the one still using the Position's budgeted FTE (Workforce Input `FTE`). The
  rule now uses the people's FTE (`WFP Assignment` All Employees `FTE Share`) when someone holds
  the Position, and the Position's budgeted FTE only for a planned hire. Written with two IF
  levels (a 3-deep IF can return blank on this engine — the lint caught the first draft).
- Applied in ~30–47 s (not the ~15 min feared). Compare 0 on today's data (everyone's FTE equals
  their Position's). Proof: ENG-001 Downside budget FTE 0.8 from Oct with Alice at 1.0 →
  Benefits stays 300 (was 240 before the fix); reverted. 59/59.
- **Still open — payroll tax YTD is per Position, not per person.** `_Earnings YTD` runs on the
  Position (following its cost centre), so a mid-year backfill inherits the leaver's
  year-to-date earnings, and two people in a handover month are taxed on their combined pay —
  employer tax can come out low once band thresholds bite. The fix is a TI tax run per person
  (assignment grain), in line with design rule #1.

## Payroll tax per person — the tax run (done 23 Oct)

- **Why:** tax was banded on the **Position's** earnings year to date (`_Earnings YTD` rules).
  A mid-year backfill inherited the leaver's year (no fresh threshold or allowance), and two
  people in a handover month were taxed on their combined pay.
- **Now, in TI** (design rule #1):
  - `WFP Assignment Base` also writes each assignment's monthly earnings
    (`WFP Assignment Pay` → `Earnings`), then runs `WFP Tax Run`.
  - `WFP Tax Run` adds earnings up **per person** (new cube `WFP Person Tax`: Earnings, YTD, ER/EE
    tax, company, jurisdiction) and walks the months: year to date carries across transfers in
    the same company, restarts each January and on a company change; bands from
    `WFP Tax Bands` by the Position's Tax Jurisdiction; contractors pay none. A planned hire
    (no named person) is taxed per Position (`Planned Hire` rows in Pay: `ER Tax`, `EE Tax`).
  - `WFP Tax Run Post` clears Employer Payroll Tax / Employee Income Tax (Budget, Forecast,
    Downside; local currencies; Amount) and writes each person's tax to the Positions they held
    that month, shared by earnings, at the Position's company / cost centre / salary currency.
    Capex/Opex and the Reporting currencies follow from the existing feeders and rules.
  - The `_Earnings YTD`, `_Employer Tax YTD`, `_Employee Tax YTD` and `_Prior …` rules and the
    YTD feeder chain are **removed** from `WFP Workforce Cost`.
- **Run time:** Base + tax run + post ≈ 87 s (Base alone was ~25 s). The cost-rule change
  took ~13 min to apply (removing feeders); the MCP client gave up at 120 s while TM1 carried on.
- **Proof:**
  - Independent recalculation (`tmp/workforce/src/taxrun/verify.js`): all 61,219 Forecast
    person-months match the TI to the penny.
  - Against the old rule before the switch: every Position-month equal, total employer tax
    identical (£35,739,630) — today no Position changes hands mid-year, so YTD never differed.
  - Backfill case on Downside (Alice leaves ENG-001 after Jun; replacement from Jul at
    £120,000): employer tax Jul **1,380 → 124** (own £9,100 threshold), employee tax Jul
    **4,000 → 0** (own allowance), then 1,486 / 2,000. Reverted.
  - After the switch: compare **0 differences** over all 550,608 remaining values (only the
    retired `_… YTD` helper lines dropped out); 59/59. New baseline `2026-10-23-taxrun`.
- Tax year is the calendar year (January), as the rules had it — not the UK's April year.
- Bug of my own on the way: the month walk followed `Next Period`, and **2027-12's Next
  Period is itself** — the first run looped forever (cancelled; nothing written but the new
  cube). The walk now stops when Next Period equals the month.

## Related

- `docs/BUILDING_MODELS.md` rule #1 (TI for heavy/across-time work), rule #2 (version
  lifecycle), rule #3 (server-wide control).
- Effective-dated assumptions (`_Effective …` measures) already flow forward.
- Position vs Seat: **Position** everywhere since Step 8 (24 Oct) — `Position FTE`, `Position State`,
  `Person In Closed Position`, `WFP Move Position`, `WFP-Position-Roster`.
