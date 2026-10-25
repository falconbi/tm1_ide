# Workforce Planning (WFP) — model design

How the WFP model on `TM1_Test_DEV` works today (24 Oct 2026). This is the design document for
the model: read it before changing anything in a workforce model. Where the model and this
document disagree, one of them is wrong — fix it, don't live with it.

It replaces `ASSIGNMENT_MODEL.md` and `POSITION_LIFECYCLE.md` (merged, with the build diary
taken out). The general standard is [BUILDING_MODELS.md](BUILDING_MODELS.md); this is the
worked example it points to.

---

## 1. The four things — one name each

| Term | What it is | Who owns it |
|---|---|---|
| **Position** | A budgeted slot in the organisation: company, cost centre, grade, FTE. Exists whether or not anyone is in it. | HRIS for real Positions; TM1 for planned (TBH) Positions |
| **Person** | An employee or contractor (`WFP Employee`). | HRIS |
| **Assignment** | A Person holding a Position from a start date to an end date, at an FTE and a salary. **Tenure and pay live here, never on the Position.** | HRIS for actual; TM1 for planned |
| **TBH Position** | A Position the plan needs that HRIS doesn't have yet ("to be hired"). Same kind of element as any Position, `Source` = TM1. | The planner |

Always say **Position**: never "seat", "role" or "slot", in names, measures, processes, pages or
text.

A Position is **one element for its whole life**: vacant, filled, vacant again, closed. People come
and go through assignments; the Position and its budget-vs-actual history stay put. A Position
never changes company (see the company move, section 5).

---

## 2. Where the data comes from

- **HRIS is the system of record** for real Positions, People and Assignments. Loads are by
  stable HRIS ID, update in place (never recreate) and write absolute values (safe to re-run).
- **Actual months** (up to the Actuals Cutoff, `WFP Assumptions` → `Actuals Cutoff Index`) come
  from HRIS only. TM1 actions refuse them.
- **Plan months** start from HRIS's current state, plus HRIS future-dated events when the feed
  has them (accepted offers, resignations with notice, scheduled pay changes), never depending
  on them. TM1 then adds the plan: TBH Positions, planned hires and backfills, planned leavers,
  pay assumptions.
- **Every plan item HR can later make real has a match key.** When HRIS records the real thing,
  the plan item is matched and stops counting. It is never left beside the real one.

| Plan item (TM1) | Becomes real in HRIS as | Matched on |
|---|---|---|
| TBH Position | a new Position | HRIS Position ID (section 6) |
| Planned hire / backfill on an existing Position | a hire assignment on that Position | same Position, hire within the window |
| Planned leaver | a termination | same Person + Position |
| Planned pay rise | a pay change | same assignment + effective month |

### The HR extract

`WFP Load HR Assignments` (pFile, pClear, pCost) reads one row per assignment, plus a
continuation row (Reason `Pay change`) whenever its pay or FTE changes:

`EmployeeID, Name, Position, Entity, EmploymentType, FTE, StartDate, EndDate, Reason, EndReason, BaseSalary`

- Dates `yyyy-mm-dd` (a bare `yyyy-mm` = day 1 / the last day); blank `EndDate` = still running.
- **A start before the plan year means "on the books at the opening"**: the assignment starts in
  the opening balance period (`Obl 2026`), and the real date is kept as the person's **Hire Date**.
- Writes Actual up to the cut-off: `WFP Assignment` (FTE Share, Start/End Reason),
  `WFP Assignment Detail` (the record), `WFP Assignment Pay` (salary + FTE each month, so a pay
  change is dated). `pClear = 1` clears Actual first; `pCost = 1` recalculates cost.
- `WFP Write Sample HR Extract` stands in for HR in test: it writes this layout from today's Actual,
  so a reload reproduces Actual exactly.

---

## 3. Periods and versions

**Periods** (`WFP Period`): `Obl 2026`, then `2026-01` … `2027-12`, with quarters, halves, FY and
YTD totals. Attributes: `Period Index` (months compare by this, never by position in the
dimension), `Next Period` / `Prior Period`, `FY`, `Days In Month`, `Period Type`.

- **`Obl 2026` is the opening balance period** (Falcon BI standard `Obl yyyy`). `Period Type` =
  `Opening`; it sits before `2026-01` and is in **no FY total**. It holds balances only:
  - who is on the books at the start (assignments, FTE Share, pay rates),
  - assumptions and rates in force at the start,
  - each person's **payroll year to date**: earnings and employer / employee tax so far in their
    tax year (`WFP Person Tax`).
  - It is **never costed**: no pay, cost or hires are calculated in it.
- January's `Prior Period` is `Obl 2026`, so January's Opening headcount and carried-forward
  assumptions read it.
- Processes find the opening by `Period Type`, never by a typed name.
- **Rolling forward:** `WFP Add Opening Period` (pYear) creates `Obl yyyy` in its place before that
  year's January. Its balances are payroll's year to date at the start, or the prior December's
  closing figures.

**Versions:** `Actual` and the snapshots (`FCST 2026-02`, `FCST 2026-03`) are stored
(Non-Calculating). `Budget`, `Forecast` and `Downside` calculate. Downside is just a spare
calculating version (a scenario). Budget is not yet frozen into a static approved copy.
`WFP Copy Version` copies between versions, the opening included; `WFP Snapshot` freezes one.

---

## 4. The cubes

| Cube | Grain | Holds |
|---|---|---|
| `WFP Position Map` | Period × Version × Position | the Position by month: Home Entity, Cost Centre, Grade, Location, `Position FTE`; rule-derived `Position State` |
| `WFP Assignment Detail` | Version × Position × Employee | the assignment record: Start / End Period and Day, FTE, Base Salary, Handover |
| `WFP Assignment` | Period × Version × Position × Employee | who holds what each month: FTE Share, Start / End Reason, Absent, Cover FTE, Handover FTE; flags Head, Joiner, Leaver, Transfer In / Out, Over-filled, In Handover |
| `WFP Assignment Pay` | Period × Version × Position × Employee | dated pay: Base Salary, FTE, Absence Pay %; Earnings (written by Base); planned-hire ER / EE tax |
| `WFP Assignment Base` | Version × Period × Position | staging: Base cost per Position-month (written by Base) |
| `WFP Workforce Cost` | Period × Version × Entity × Cost Centre × Pay Component × Currency × Position | cost by pay component, local and reporting currencies, Capex / Opex |
| `WFP Person Tax` | Period × Version × Employee | per person: Earnings, Earnings YTD, ER / EE Tax and their YTD, Company, Jurisdiction |
| `WFP Headcount` | Period × Version × Entity × Cost Centre × Position | Headcount, FTE, Opening, Hires, Leavers, Transfers, Closing, Open Positions, Absent / Cover Headcount, Headcount excl Cover |
| `WFP Hiring Plan` | Version × Position | planned hire month, Finance approval, effective hire month, checks (Late Hire, Unplanned Position) |
| `WFP Workforce Input` | Period × Version × Position | the Position's default FTE and salary (for a vacancy / planned hire) |
| `WFP Pay Rates` | Period × Version × Grade × Job Family × Location | pay bands (Salary Mid etc.) |
| `WFP Tax Bands` | Jurisdiction × Tax Type × Band | thresholds and rates |
| `WFP Assumptions` | Period × Version × Entity | merit, promo, bonus pool, Actuals Cutoff Index — effective-dated (a value carries forward until the next one) |
| `WFP FX Rates` | Period × Version × Currency × Rate Type | FX |
| `WFP Control` | Version | Cost Out Of Date, Requested At / By, Updated At |

### Reporting by location

Location belongs to the Position (dated in `WFP Position Map`; it sets the pay band and, through
the Position's `Tax Jurisdiction`, the tax). `WFP Location` is city → country → region → All
Locations (London → UK → EMEA, New York → US → Americas, Auckland → NZ → APAC), with Country and
Currency attributes. Headcount and cost by location come from the **"By Location" Alternate
Hierarchy** on `WFP Position` — All Locations > region > country > city > each Position —
generated by **`WFP Rebuild Location Hierarchy`** from each Position's location in the first plan
month (Forecast), falling back to its Location attribute (none → `Location not set`, which a
control assertion keeps at 0). It runs inside `WFP Recalculate If Needed` (so after every action)
and after the HR load, moves only Positions whose location changed, and is never edited by hand. It also keeps the ALT H's own subsets: **Default** (the whole tree) and **Cities**.
Not dated: every month reports under the Position's current location. Proven 24 Oct 2026: by
location = by company = group total for headcount, FTE and cost; Over-filled / In Handover show at
city, country and region (their rules test leaves with `DTYPE`, not `ELLEV`); compare 0.

---

## 5. The lifecycle — every change, who makes it, where

Each change is dated and applies from its month onwards; months before it are never rewritten.
Actual months are refused. Every action calls `WFP Request Recalculation` so cost follows
(section 8).

| # | Change | Who | Page | Process | Effect |
|---|---|---|---|---|---|
| 1 | Position created | HRIS load | — | `WFP Load HR Assignments` | vacant until filled: 0 heads, counted as an open Position |
| 2 | New position requested (TBH) | manager | Hiring plan | `WFP Create TBH Position` | `TBH-<cc>-<nnnn>` (never reused), waiting for Finance |
| 3 | Hire approved | Finance | Hire approvals | `WFP Approve Hire` | counts from its hire month at the Position's FTE and default salary, until matched |
| 4 | TBH matched to the HR Position | HR | Match new Positions | `WFP Match TBH` | TBH stops counting; the HR Position carries the hire from its real start |
| 4b | Match undone | HR | Match new Positions | `WFP Unmatch TBH` | everything the match changed is put back |
| 5 | Hire (incl. replace / handover) | HR | People | `WFP Assign Person` | new assignment with its own pay |
| 6 | Pay or FTE change from a month | HR | People | `WFP Change Assignment` | the person's pay / FTE from that month |
| 7 | Position change: grade, budgeted FTE, location, salary | HR / Finance | Positions | `WFP Change Position` | dated in Position Map; the person keeps their own pay |
| 8 | Move to another cost centre (same company) | HR / Finance | Positions | `WFP Move Position` | dated cost centre; history stays under the old one |
| 9 | Transfer a person (same company) | HR | People | `WFP Transfer Person` | old assignment ends, new one starts; YTD tax carries across |
| 10 | Company move | HR / Finance | Positions | `WFP Move Position To Company` | a leaver + a hire into a new Position in the new company; YTD tax restarts |
| 11 | Leaver (+ backfill) | HR | People | `WFP End Assignment` | Position vacant from the next month; backfill = a planned hire on the same Position |
| 12 | Handover overlap | HR | People | `WFP Assign Person` (handover) / `WFP Mark Handover` | both count and are paid during the marked overlap |
| 13 | Time away | HR | People | `WFP Record Absence` | stays in headcount, paid its pay % |
| 14 | Cover while someone is away | HR | People | `WFP Assign Cover` | a second real person, flagged Cover; only while someone is away |
| 15 | Position closed | HR / Finance | Positions | `WFP Close Position` | stops counting; refused while anyone holds it |
| 16 | TBH cancelled | manager / Finance | Hiring plan / Positions | `WFP Cancel TBH Position` | stops counting; element kept (never delete) |
| 17 | Position reopened | HR / Finance | Positions | `WFP Reopen Position` | same budget line in the same plan year only; otherwise create a new Position |

**Two statuses, kept apart:**
- **Position Status** (stored, not by month): Planned → Approved → Matched for a TBH; Open for an
  HRIS Position; Closed; Cancelled.
- **Position State** (rule-derived each month, never typed): Filled, Planned hire, Vacant, Not open.

---

## 6. Matching a TBH Position to the HR Position (no double count)

A planner adds `TBH-ENG-APP-0007` for a June hire. In May HR opens the real Position and the
hire lands on it. Unlinked, the plan would count two Positions and two salaries for one person.

- Attributes on `WFP Position`: `Source` (`HRIS` / `TM1`); on the TBH `HRIS Position ID` +
  `Matched From`; on the HR Position `Matched TBH`. The link is one real-world fact, so it is
  unversioned; its effect is per version.
- **Matching is always confirmed by a person.** The Match page suggests candidates (same company,
  cost centre and grade; hire month within ±3 months) and HR confirms. There is no automatic
  matching.
- On match, the TBH stops counting from the first open month (planned hire cleared, closed). A
  late hire shows as forecast variance, not as two Positions.
- `WFP Match TBH` refuses: a TBH or HR Position already linked, an HR-side "TBH", a planning-side
  "HR Position", anyone holding the TBH.
- **A match can be undone.** Before it clears anything, `WFP Match TBH` saves a restore point in that
  version (Hiring Plan `Match Undo`: the planned hire — month, approval, its record — the TBH's
  status, and each open month's FTE). **`WFP Unmatch TBH`** (pVersion, pTBH) puts it all back, clears
  the restore point and the link (unless the TBH is still matched in another version), and cost
  follows. The Match page lists "Matched in this version" with **Unmatch…**. Proven identical
  before / after in the lab and on Downside (24–25 Oct 2026). Match refuses a TBH already matched in that version, so a
  restore point is never overwritten.
- **Unmatched outcomes are flagged** (Needs attention; Forecast and Downside only):
  - `Unplanned Position`: a new HR Position in an open month with no TBH and no planned hire.
    It is real, so it counts.
  - `Late Hire`: an approved TBH whose hire month is in actuals, still unmatched.

---

## 7. Absence and cover

- `WFP Record Absence` sets `Absent` and `Absence Pay %` on every Position the person holds in
  those months. They **stay in headcount** and are paid that % of their pay (tax follows).
- `WFP Assign Cover` adds a cover assignment (Start Reason `Cover`, End Reason `Cover end`: not a
  joiner or leaver), only while someone on the Position is away in every one of those months.
- `Over-filled` allows the cover FTE only in months someone is away.
- Headcount shows `Absent Headcount`, `Cover Headcount`, `Cover FTE` and `Headcount excl Cover`.
  The Headcount page has an **Include cover** switch.
- Month grain only (no part months). Actual has no absence / cover yet (the HR extract would need
  absence rows).

---

## 8. Cost and tax

**Where each calculation lives** (BUILDING_MODELS design rule #1): the heavy, across-time work is
TI; rules only for what planners must see change live.

- **Base — TI, `WFP Assignment Base`.** Per assignment, month by month from its start to its end
  (never in the opening period): salary / 12 × FTE, prorated by day in the start and end months,
  × the absence pay % when away. Pay comes from `WFP Assignment Pay`, falling back to the record's
  FTE and salary, then the pay band for the Position's dated grade and location. Each assignment
  is **added** to its Position (two people in a month are both paid). Written to `WFP Workforce
  Cost` `Base` at the Position's dated company, cost centre and salary currency.
- **On-costs — rules on `Base`:** employer and employee pension, bonus. **Benefits** use the
  people's FTE when the Position is filled, the Position's FTE for a planned hire.
- **Payroll tax — TI, per person** (`WFP Tax Run`, run by Base, then `WFP Tax Run Post`):
  - earnings are added up per person in `WFP Person Tax`;
  - the run walks the months from the first plan month, **starting from the person's payroll
    year to date in the opening period**;
  - year to date restarts at the start of the person's **tax year** (`WFP Jurisdiction` →
    `Tax Year Start Month`: UK and NZ April, US January) and when they change company; it carries
    across a transfer in the same company;
  - tax is banded on year to date (`WFP Tax Bands`, by the Position's `Tax Jurisdiction`);
    contractors pay none; a planned hire (no named person) is taxed per Position;
  - `WFP Tax Run Post` shares each person's tax across the Positions they held that month.
  - The UK tax year runs 6 April to 5 April; in a monthly model April is tax month 1, as payroll
    counts it.
- **Opening year to date:** payroll supplies each person's earnings and tax so far in their tax
  year at the opening. Until it does, `WFP Estimate Opening YTD` (pOverwrite) estimates it: monthly
  pay at the opening × the months of the tax year already gone (UK / NZ 9, US 12), taxed on the
  same bands. Real payroll figures replace the estimate.
- **Cost follows every action:** each action process calls `WFP Request Recalculation` (marks
  `WFP Control` → Cost Out Of Date). Chore **`WFP Recalculate Cost`** (every 5 minutes) runs
  `WFP Recalculate If Needed` → Base + tax run only when something is marked. Pages show "Cost up
  to date (hh:mm)" or "Cost updating…". **The TM1 server clock is UTC−8**: a chore start time
  must be in the past in server time.
- Run time on the full model: Base + tax run + post ≈ 90 s.

---

## 9. Counting rules

- **Headcount** = people with an assignment in the month (a handover overlap counts 2; cover
  counts), plus approved, unmatched planned hires from their hire month.
- **FTE** = the sum of assignment FTE, plus the Position FTE of counted planned hires.
- **Opening** = last month's Headcount (January reads `Obl 2026`). **Closing** = Opening + Hires −
  Leavers + Transfers In − Transfers Out. Leavers count in the month after their last month.
- **Open Positions** = Positions that exist in the month with nobody counted in them.
- **Cost** is calculated per assignment and rolled up to the Position; counted planned hires cost
  at the Position's default salary.

## 10. Checks that must always hold

The three kinds of check are explained in
[BUILDING_MODELS.md](BUILDING_MODELS.md#checks--who-decides-and-the-three-kinds).

**Control checks** — run as assertions and on the Needs attention page:

- Nobody over 1.0 FTE across Positions (`Over-booked`).
- No Position holding more people than its FTE (`Over-filled`), except a marked handover or cover
  while someone is away.
- Nobody assigned to a Position in a month it doesn't exist (`Person In Closed Position`).
- No assignment record that ends before it starts (`Bad Span`).
- No HRIS Position linked to more than one TBH; no matched TBH counting in an open month.
- Every new HR Position in an open month is matched or flagged *Unplanned*; every approved TBH
  past its hire month is matched or flagged *Late hire*.

**Worked examples** — the remaining assertions check agreed numbers on the sample data (tax, net
pay, cost per assignment). They run on DEV or a loaded test dataset, not on Prod's real people.

**Regression totals** — compared before and after a change on the same data:

- `WFP Workforce Cost`: every version × entity × cost centre × month (Obl 2026 onward) × leaf pay
  component × currency × measure, at Total Positions.
- `WFP Headcount`: every version × entity × leaf cost centre × month × headcount measure, at Total
  Positions.

Any difference must be one the change set says to expect.

---

## 11. Pages (Lenses, folder Workforce)

One page per job, built from the lifecycle (section 5):

| # | Page | Who | What |
|---|---|---|---|
| 0 | Workforce home | all | tiles by job: People & positions · Plan · Review · Dashboard · Variance |
| 1 | People | HR | hire (replace / handover), pay or FTE change from a month, leaver + backfill, transfer, time away, cover |
| 2 | Positions | HR / Finance | grade / FTE / location / salary from a month, move (cost centre or company), close, reopen, cancel a TBH |
| 3 | Match new Positions | HR | new HR Positions with no plan → suggested TBHs → confirm |
| 4 | Hiring plan | managers | planned hires; request a new position (TBH); cancel |
| 5 | Assumptions | Finance | merit, promo, bonus pool, by month (effective-dated) |
| 6 | Hire approvals | Finance | approve or reject planned hires (line approval) |
| 7 | Needs attention | HR / Finance | the checks in section 10, with links to fix them |
| 8–14 | My cost centre, KPIs, Workforce cost, Headcount, Pay & grades, Budget to forecast, Since last forecast | managers / Finance | reports |

Month lists on the pages offer real months only (`yyyy-mm`), never the opening period.

---

## 12. Decisions

1. **Match window:** ±3 months, always confirmed by a person. No automatic matching for now.
2. **An approved TBH counts before it is matched**, from its hire month.
3. **Absence / cover:** the absent person stays in headcount, paid per policy; cover is a second
   real person and also counts; reports get a "without cover" option.
4. **Reopen vs new:** reopen only the same budget line in the same plan year.
5. **HRIS future events:** use them when the feed has them; never depend on them.
6. **Pay and FTE history:** effective-dated monthly values per assignment, not split records.
7. **Salary is per assignment;** the Position's salary is only the default for a vacancy or
   planned hire.
8. **Cost grain is the assignment;** reporting grain is the Position.
9. **Handover is explicit:** only marked overlaps are exempt from Over-filled.
10. **A company change is a leaver + a new hire in a new Position,** not a transfer.
11. **Tax follows each jurisdiction's tax year,** from payroll's year to date at the opening.
12. **The opening is a period (`Obl yyyy`), not a borrowed month;** start dates before the plan
    year are on the books at the opening, the real date kept as Hire Date.
13. **Test lab:** WFP_Lab is generated from WFP's own definitions so it cannot drift.

## 13. Known gaps

- Day basis: proration is by calendar day; working days were decided but not built.
- Budget has no frozen, static approved copy yet.
- Actual has no absence / cover rows.
- Hire Dates are sample dates until a real HR extract supplies them; opening year to date is
  estimated until payroll supplies it.
- If the outgoing person's end changes after a handover is marked, re-run `WFP Mark Handover`.

---

## 14. How changes are tested

1. **Lab first.** `LIVE=1 node tmp/workforce/live-lab-build.js` (about 4 minutes) regenerates
   WFP_Lab (every `LAB …` object, 14 chosen Positions and their people, never deployed) from the
   current WFP model and checks its cost equals WFP's. Prove the change there.
2. **Then one Downside run** on the real model with snapshot, restore and compare, when the change
   can be confined to one version. A change to something every version shares (the period
   dimension, for example) is proven in the lab and checked by the compare.
3. **Compare:** `node tmp/workforce/compare-consol.js compare <baseline>` (about 2 minutes,
   read-only). Baselines are write-once; capture a new dated one after an intended change. Latest:
   `2026-10-24-obl`.
4. **Assertions:** 59, all passing (24 Oct 2026); run on every close of the change set.
