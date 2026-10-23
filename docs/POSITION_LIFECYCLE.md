# Position lifecycle — how a Position lives, changes and ends

Status: **target design** + proposals (23 Oct 2026). Where the WFP model doesn't match it yet
(e.g. Base pay is still read from the Position's Workforce Input, not the Assignment; nothing
sets Handover; no Cancel/Reopen actions), the model is the gap to close, not this document. Read before designing or changing anything in a
workforce model. Works with `docs/ASSIGNMENT_MODEL.md` (the assignment record) and
`docs/BUILDING_MODELS.md` (the design standard).

---

## 1. The four things — one name each

| Term | What it is | Who owns it |
|---|---|---|
| **Position** | A budgeted slot in the organisation: company, cost centre, job/grade, FTE. Exists whether or not anyone is in it. | HRIS for real Positions; TM1 for planned (TBH) Positions |
| **Person** | An employee (or contractor). | HRIS |
| **Assignment** | A Person holding a Position from a start date to an end date, at an FTE and a salary. **This is where tenure and pay live** — never on the Position. | HRIS for actual; TM1 for planned |
| **TBH Position** | A Position the plan needs that HRIS doesn't have yet ("to be hired"). Same kind of element as any Position, flagged as planned. | TM1 (the planner) |

Always say **Position** — never "seat", "role" or "slot" in names, measures, processes, pages or text.

A Position is **one element for its whole life**: vacant, filled, vacant again, closed. People
come and go through assignments; the Position and its budget-vs-actual history stay put.

---

## 2. Where the data comes from

- **HRIS is the system of record** for real Positions, People and Assignments. Every load is
  by **stable HRIS ID** (Position ID, Person ID), updates in place (never recreate), writes
  absolute values (safe to re-run).
- **Closed (actual) months:** HRIS is the only truth. TM1 edits are refused.
- **Open (plan) months** start from HRIS's current state **plus HRIS future-dated events**
  (accepted offers, resignations with notice, scheduled pay rises), then TM1 adds the plan:
  TBH Positions, planned hires and backfills, planned leavers, pay assumptions.
- **Every plan item that HR can later make real needs a match key and a "fulfilled" state.**
  When HRIS records the real thing, the plan item is **matched and stops counting**. It is
  never left beside the real one. This is the general rule; TBH matching (section 4) is the
  most important case.

| Plan item (TM1) | Becomes real in HRIS as | Match on |
|---|---|---|
| TBH Position | a new Position (or a requisition against an existing vacant one) | HRIS Position ID (section 4) |
| Planned hire / backfill on an existing Position | a hire Assignment on that Position | same Position + hire within the window |
| Planned leaver | a termination | same Person + Position |
| Planned pay rise | a pay change | same Assignment + effective month |

---

## 3. The lifecycle — every change a Position can go through

Each event is **dated** (effective month, or day where the assignment model needs it). A change
applies from its date onwards; months before it are never rewritten.

| # | Event | Source | What changes | Headcount / cost effect |
|---|---|---|---|---|
| 1 | **Position created** | HRIS load | new Position: company, CC, grade, FTE, start date | vacant until filled — 0 heads, counted as an open Position |
| 2 | **TBH Position created** | planner in TM1 | new TBH Position, status *Planned*, planned hire month | nothing yet — not approved |
| 3 | **TBH approved** | Finance (line approval) | status *Approved* | counts from its hire month: 1 head at the Position FTE and default salary, until matched |
| 4 | **TBH matched** | HRIS load + match (section 4) | TBH linked to the HRIS Position; status *Matched* | TBH stops counting; the HRIS Position carries it from its real start |
| 5 | **Filled (hire)** | HRIS (actual) or planned in TM1 | new Assignment: Person, start, FTE, salary | the Assignment counts from its start |
| 6 | **Pay change** (merit, promotion pay) | HRIS or plan | Assignment salary from a month | cost from that month |
| 7 | **Person FTE change** (part-time, return) | HRIS or plan | Assignment FTE from a month | FTE and cost from that month |
| 8 | **Position change** (regrade, budgeted FTE) | HRIS or plan | Position grade / FTE from a month | budget and the default salary for the next hire |
| 9 | **Reorg move (same company)** | HRIS or plan | Position's cost centre from a month (dated mapping, not an overwritten attribute) | cost and heads report under the new CC from that month; history stays under the old one. **A Position never changes company:** a reorg into another company closes this Position (row 16) and opens a new one there, and its holder makes a company move (row 11) |
| 10 | **Transfer (same company)** | HRIS or plan | old Assignment ends, new Assignment starts on another Position | Person counted once; YTD tax carries across |
| 11 | **Company move** | HRIS or plan | treated as a **leaver + a new hire** (not a transfer) | YTD restarts in the new company |
| 12 | **Leaver** | HRIS (actual) or planned | Assignment end date + reason | the Position becomes vacant from the next day/month |
| 13 | **Backfill** | planner | a planned hire on the **same** Position (not a new TBH) | counts once approved, from its hire month |
| 14 | **Handover overlap** | HRIS/plan, flagged | two Assignments overlap, the incoming one marked *Handover* | both count during the overlap; not an error |
| 15 | **Temporary absence / cover** (e.g. parental leave) | HRIS | absent Assignment continues (pay per policy); cover is a second Assignment marked *Cover* | *open decision — see section 7* |
| 16 | **Position closed** | HRIS or plan | Position end date; no Assignment may run past it | stops counting; history kept |
| 17 | **TBH cancelled** | planner / Finance | status *Cancelled* | stops counting; element kept (history, snapshots) — **never delete** |
| 18 | **Position reopened** | HRIS or plan | end date removed / moved | counts again — only if it's the same budget line; otherwise create a new one |

There are **two different statuses**. Keep them apart, with different names:

- **Position Status** is stored, set by HRIS or by a planner/approver action, and is not by
  month: *Planned → Approved → Matched* for a TBH; *Open* for an HRIS Position; *Closed*;
  *Cancelled* for a TBH that never happened.
- **Monthly Position State** is derived by rule for each month, never typed: *Filled* (an
  Assignment counts), *Planned hire* (an approved, unmatched hire has started), *Vacant* (the
  Position exists, nobody counts), *Not open* (before its start or after its end).

---

## 4. Matching a TBH Position to the HRIS Position (no double count)

**The problem:** a planner adds `TBH-ENG-0007` for a June hire. In May, HR opens the real
Position in HRIS (`P-104233`), and the June hire lands on it. If nothing links the two, the
plan counts **two** Positions and two salaries for one person.

**Proposed rule (James to confirm the details marked ◆):**

1. **TBH IDs are planning-only and never reused:** `TBH-<CostCentre>-<nnnn>`. Attributes:
   `Source` = TM1, `Status`, `Planned Hire Month`, `HRIS Position ID` (blank until matched),
   `Matched From` (period).
2. **Explicit link first (preferred):** when HR raises the requisition, the TBH ID is recorded
   on it, or the planner/HR types the HRIS Position ID onto the TBH. The HRIS load then matches
   them exactly.
3. **Suggested match otherwise — confirmed by a person, never silent:** for each HRIS Position
   that is new and starts in an open month without a link, list candidate TBHs that are
   *Approved*, unmatched, in the same company and cost centre, the same grade/job, with a hire
   month within ◆ ±3 months. HR / Finance confirm on a "Match new Positions" Lens page.
   ◆ Auto-match only when there is exactly one candidate (or never).
4. **On match:** set `HRIS Position ID` and `Matched From` on the TBH, status *Matched*. The
   TBH contributes **nothing in open months**; the HRIS Position and its Assignment carry the
   plan from the real start date. A hire later than planned shows up as forecast-vs-prior-
   forecast variance, not as two Positions.
5. **Unmatched outcomes are flagged, not hidden** (a "needs attention" check):
   - a **new HRIS Position with no TBH** → *Unplanned Position*. It is real, so it counts.
   - an **Approved TBH past its hire month with no match** → *Late hire*. It keeps counting
     until someone moves its month, matches it or cancels it.
6. **One link only:** an HRIS Position ID may be linked to at most one TBH (a check enforces
   this).

Backfills and planned hires on **existing** Positions don't need any of this. They are planned
Assignments on a Position HRIS already knows, matched by Position + hire window (section 2).

---

## 5. Counting rules (what each number means)

- **Headcount** = people with an Assignment in the month (a handover overlap counts 2), plus
  approved, unmatched TBH / planned hires from their hire month.
- **FTE** = sum of Assignment FTE, plus the Position FTE of counted TBH / planned hires.
- **Cost** = calculated per Assignment (the assignment grain, in TI), rolled up to the
  Position; counted TBH / planned hires cost at the Position's default salary.
- **Open Positions** = Positions that exist in the month (not closed) with nobody counted in
  them.
- Closed months come from HRIS actuals only.

## 6. Checks that must always hold

- No Person in two Positions at once beyond 1.0 FTE (except a flagged handover).
- No Assignment on a closed Position.
- No HRIS Position ID linked to more than one TBH; no matched TBH counting in an open month.
- Every new HRIS Position in an open month is either matched or flagged *Unplanned*.
- Every Approved TBH past its hire month is either matched or flagged *Late hire*.
- A plan item fulfilled by HRIS (hire, leaver, pay change) is never counted twice.

## 7. Decisions (resolved 23 Oct 2026)

1. **Match window:** ±3 months, and **always confirmed by a person**. No auto-match yet; add
   single-candidate auto-match later only if it proves reliable.
2. **Approved TBH before match:** **yes**, it counts from its hire month. Otherwise the
   forecast drops the hire until HR acts.
3. **Absence / cover:** the absent person **stays in headcount**, paid per policy. Cover is a
   second real person, flagged *Cover*, and also counts. Reports get a **"without cover"**
   option.
4. **Reopen vs new:** reopen only when it is the **same budget line in the same plan year**;
   otherwise create a new Position.
5. **HRIS future events:** accept accepted offers, resignations with notice and scheduled pay
   changes **when the feed has them**; never depend on them.
6. **Pay/FTE history (A):** **effective-dated monthly measures per assignment** (option a),
   not split assignment records.
7. **Test lab (B):** build **WFP_Lab** by script from WFP's definitions (dimensions, cubes,
   rules, processes) so it cannot drift; use it for steps 1, 3 and 4.

Implementation notes: the model's "Seat Status" is the derived **Monthly Position State**
(naming phase); the stored **Position Status** is a separate attribute. Pay/FTE changes are
dated on the assignment, not on the Position.
