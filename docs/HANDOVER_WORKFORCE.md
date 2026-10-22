# Handover — Workforce model & Lenses (22 Oct 2026)

For the next agent (OpenCode) picking up the Workforce work. Read this first, then
`docs/BUILDING_MODELS.md` (v11 landmines) and `docs/PIVOT_PLAN.md`.

## Working rules (James's, non-negotiable)

- **Never push.** Everything stays local on branch `lenses` until James says "push".
- **Never restart servers.** Tell James: `systemctl --user restart tm1-backend` (IDE);
  the Lens app is Ctrl+C then `npm run lens`.
- **Ask before coding** when he is discussing ("I am discussing" = don't build). When he
  says go, build, test, report.
- Plain English, short answers, the concrete answer first. One step at a time in walkthroughs.
- No Playwright. Never write anything personal about James. Never call Lenses "frames".
- Keep TM1_CONSOL private. Never print or commit tokens. Security changes: James runs them.
- Don't re-add the amber "zero rule cell" highlight — he rejected it.

## Where things are

- **TM1 server:** `TM1_Test_DEV`. Open change set `92a949c9` ("AI: Workforce — new hires
  need Finance approval"). All model edits go through the governed MCP tools (tm1mcp).
- **Lenses live in the model** (folder Workforce, all drafts). Read with `get_lens`, save
  with `save_lens` (merge `config` from `get_lens` — saving without it drops `home` etc.).
- **Lens sources (local, gitignored):** `tmp/workforce/lens/*.src.html` + `_style.css` +
  `_helpers.js`. Build: `node tmp/workforce/lens/build.js` → `tmp/workforce/lens/out/*.html`
  (fills `/*STYLE*/` and `/*HELPERS*/`). Assumptions is hand-kept as
  `tmp/workforce/WFP-Assumptions.html` (not built).
- **Live check (reads only, writes recorded not sent):**
  `node tmp/workforce/run.js <abs path to out/X.html> '<config json>' <abs path to check script>`
  — runs the Lens in jsdom against TM1_Test_DEV. Examples: `hp2-check.js`, `lv-check.js`.
- **MCP from a script:** `tmp/workforce/mcp.js` (`const { h, run } = require('./mcp')`).
  NB it `chdir`s to the repo — write output files with absolute paths.
- **Retitle / save:** `tmp/workforce/retitle.js` — saves Lenses with numbered titles in Home
  order (0 Workforce home … 13 Since last forecast) and re-saves any it marks `fresh`.
- **Bridge limits:** one MDX ≤ 20,000 characters and ≤ 20,000 cells — chunk long member
  lists (see `chunks()` in WFP-Leavers). `call()` in `_helpers.js` errors on truncation.
- **Toolkit:** `shared/lens-kit/*` (v11), catalogue `shared/lens-components.json`,
  shared pivot `shared/pivot/*`. Tests: `npm test` (308 pass at commit 49134b6).

## The model in one paragraph (Option B: seats + people)

A `WFP Position` is a **seat**. `WFP Position Map` (by month) holds the seat's Cost Centre,
Home Entity, Grade, Location, Seat FTE and a rule-driven **Seat Status**
(Filled / Planned hire / Vacant / Closed). People are `WFP Employee` (2,782, alias Display
"Name · ID"); `WFP Assignment` (Period × Version × Position × Employee × measure) says who
sits where (FTE Share, Start/End Reason, flags Joiner/Leaver/Transfer In/Out — the Leaver
flag sits in the person's **last** month). `WFP Hiring Plan` holds a seat's Hire Month +
Finance approval; only approved hires count, and only while nobody is assigned
(Effective Hire Month → seat End Period). Attrition Month is **dead** (no rule reads it).
Processes: WFP Assign Person, End Assignment, Transfer Person, Move Seat, Approve Hire,
Load HR Assignments (+ Write Sample HR Extract). Outcomes go to the `Lens Messages` cube.

## Done this session (22 Oct)

1. **Home link** on every Workforce Lens (`config.home`), commit 49134b6.
2. **Hiring plan reworked** (WFP-Hiring-Plan v4): one row per seat from Position Map +
   Assignment; Leave month column removed; "Leaves after …" read-only; hire month refused
   in a month someone sits in the seat or the seat is closed; "Opens Sep 2026" for future
   seats; Seat roster link; right-click Why/Who/Notes on hire month.
3. **New Lens: Leavers & backfills** (WFP-Leavers v1): all leavers (472 in Forecast), what
   happens to the seat after, months vacant, editable Backfill from (writes Hire Month),
   Record a leaver by name (WFP End Assignment, HR/Finance only).
4. **Titles renumbered** 0–15 to match Home order; Home tiles updated.
5. **Model fix (processes, live):** WFP End Assignment (no backfill) and WFP Transfer Person
   now clear the seat's **old** approved Hire Month (≤ the person's last month), which would
   otherwise revive the seat as a counted "Planned hire" after they go. End Assignment's
   cutoff message no longer prints an index. Script: `tmp/workforce/fix-stale.js`.
   **Verified live on Downside** (23 Oct): Assign Person into an approved planned-hire seat
   (`ENG-2069`, hire 2026-08), End Assignment with no backfill → Hire Month 0, Approved/By/At
   cleared, Seat Status Vacant from 2026-09; restored from a full snapshot. Neither process
   touches the employee record for an existing person (the Status/Leaver attr writes are only
   in the new-person branch).
6. **New Lens: Transfers** (WFP-Transfers v1, title `4 Transfers`): people moving between
   seats and cost centres (Assignment Transfer In / Out flags), paired per person (Transfer
   Out sits the month before the Transfer In), "Old seat after" column reusing the Leavers
   logic, record a move by name (WFP Transfer Person, HR/Finance). No direct cube writes —
   process only. `tmp/workforce/lens/WFP-Transfers.src.html`. Tested live on Downside
   (`EXEC-001` → `ENG-002`, Henry Ford · E10001, from 2026-06): FTE moves, End Reason
   `Transfer Out` the month before, Start Reason `Transfer In`, old seat Vacant, new seat
   Filled, salary copied to the new seat; restored from a full snapshot.
7. **New Lens: Seats needing attention** (WFP-Attention v1, title `8 Seats needing attention`,
   Review group) + a Home tile: the three control checks (WFP Assignment `Over-filled` /
   `Over-booked`, WFP Position Map `Person In Closed Seat`). **The test caught a real bug:**
   `NON EMPTY` silently skips the two unfed rule checks (it saw only the fed closed-seat
   check), so it would have shown "all clear" while seats were over-filled. Fixed by reading
   the **consolidated month totals without `NON EMPTY`**, then scanning the full leaf grid for
   only the months that trip (no feeder changes). Landmine written up in
   `docs/BUILDING_MODELS.md`. Proved with three real Downside trips (second person into a
   filled seat → 2 over-filled; one person at FTE in two seats → 1 over-booked; a person in a
   closed seat → 1 closed, which also trips over-filled as its seat FTE is 0): lens and Home
   tile both showed all three; restored from a snapshot. Home tile adds ~0.1s (3 queries,
   72 cells).
8. **Snapshot trap found (read-only):** `WFP Copy Version` is not the snapshot tool — it
   copies only `WFP Workforce Input` (FTE, Base Salary). The snapshot tool is
   **`WFP Snapshot`**: it creates the version under `Non-Calculating`, then copies every
   cube carrying the Version dim via Bedrock `}bedrock.cube.data.copy` with
   `pSuppressRules=0` (calculated values included), and stamps the next period's
   `Prior Fcst Snapshot`. Headcount/Cost rules STET for non-calculating versions, so they
   rely on those stored values — using `WFP Copy Version` would leave them blank. The only
   old snapshot (`FCST 2026-02`) predates `WFP Assignment`, so it has no people data; a
   fresh snapshot fixes it. Written up in `docs/BUILDING_MODELS.md`.
9. **Fresh snapshot `FCST 2026-03` taken** (Forecast → FCST 2026-03, `2026-04` Prior Fcst
   Snapshot stamped). It **took 1h36m** (see performance item) but verified correct:
   Assignment 18,287 = 18,287, Leaver flags 472 = 472, Headcount Closing 2026-02 2,676 =
   2,676, Cost FY2026 matches, 238 hire months. **A later accidental whole-cube Bedrock copy
   (no period filter) ran 1h23m into FCST 2026-03; all 36 months still matched Forecast (0
   mismatches) and no thread was left.** It is now the "last forecast" for the 6
   lenses that read the newest `FCST yyyy-mm` (Bridge, Cost, Headcount, KPIs, My cost
   centre, Since last forecast). **Read-only timings (one month, Forecast):** WFP Workforce
   Cost 207,566 cells / 19s; Assignment 5,478 / 0.6s; Position Map 15,009 / 0.7s; Headcount
   11,229 / 1.2s; Workforce Input 5,643 / 0.6s; the rest tiny. **What the pages read:** all
   at cost-centre / entity level except **My cost centre and Since last forecast**, which
   read Cost at seat (Position) level — but only `Total Compensation` / `Reporting` /
   `Amount`. Position Map is read by none of them.
10. **Fast-snapshot probe (read-only design check).** Every element checked: `Total
    Positions` and the function names are consolidations; `Total Compensation`, `Cost to
    Company`, `Employee Deductions`, `GL:…` are consolidations; `Currency` and `Measure`
    are all leaves. So Cost must be stored at **leaf seats** — totals roll up. Bedrock's
    `}bedrock.cube.data.copy` defaults `pSuppressConsol=1` (skips consolidations),
    `pZeroTarget=1` (it **zeroes the target slice** via `}bedrock.cube.data.clear` before
    writing) and `pSuppressRules=1` (the WFP processes pass 0 to copy calculated values).
    Probe into `FCST 2026-03` itself (identical values, end state unchanged): one month ×
    restricted leaf slice = 12.9k cells 9.9s / 43k cells 44.7s; the month still matched
    Forecast to the last digit. Writes dominate. `create_chore` now takes `execution_mode`
    (default `SingleCommit`) so a chore can be `MultipleCommit` (commit per step) — tested,
    commit 8c99acc.

11. **Leaver comparison restored** (`WFP-My-Cost-Centre` v8, `WFP-Since-Last` v8): leaver
    lines now come from `WFP Assignment` `Leaver` (next leaver on/after the cutoff),
    compared Forecast → `FCST 2026-03`. The "comes back once snapshots carry people data"
    notes are gone; "New or moved leavers" and the Change filter are back. All differences
    are zero because the snapshot is a copy of Forecast.
12. **Sessions monitor fixed** (`getSessions` asked for `CurrentThread`, which TM1 v11
    rejects; now tries `Threads` → `CurrentThread` → `User`, caches the working one; the
    page attributes threads via `Session` and merges `s.Threads`). Tested, commit 83fa2b9.
    **Backend restart pending** (`systemctl --user restart tm1-backend`).
13. **Cost compare + assertion baseline built** (read-only; `tmp/workforce/compare-consol.js`).
    Reads **leaf** Entity / Cost Centre / Pay Component at `Position = Total Positions` for
    Budget / Forecast / Downside / Actual (months 2025-12…2027-12; Actual 2026-01…03), plus
    WFP Headcount at the same level. Stores only non-zero values (6 dp, keyed by full
    coordinates) and compares with tolerance 0.005. **Capture: 702,216 values, 3,198
    queries, 2–4 min, ~53 MB. Compare against the unchanged model: 0 differences.**
    Assertions were re-recorded on 24 Oct: the 19 stale-scale checks plus #5, #12 and #13
    (descriptions updated to remove old constants; #5 rewritten on EXEC-001: Downside
    222,600 vs Forecast 218,400). #7 reworded to the approval gate ("planned hire waiting
    for Finance → headcount 0"). **62 total, 62 pass.**

**Salary belongs to the seat** (intended, confirmed by James): a transfer copies the rate to
the new seat and **leaves it on the old seat** as the starting point for a backfill. A vacant
seat costs nothing, so it is not counted twice — **not yet proved**: next Downside test should
read `WFP Workforce Cost` for the old seat in the vacant months and confirm 0.

Verified by live read-only runs plus the reversible Downside tests above. **Not yet done
by James in the UI:** a real hire-month save, an approval, a backfill save, Record a leaver,
Record a transfer.

## Next, in order

1. **Slim the WFP Workforce Cost cube** (the real performance fix; James to decide — analysis
   done, nothing changed). Measured leaf breakdown, one month, 207,566 cells:
   - page-read components (Base, ER tax, ER pension, Benefits, Bonus, One-Time): **91,155 (44%)**
   - non-page real components (Gross Pay, Employee Income Tax, Employee Pension, Net Pay): **63,222 (30%)**
   - helpers `_…`: **53,189 (26%)** — only four hold cells (`_Monthly Base Full` 2,921,
     `_Earnings YTD` 16,902, `_Employer Tax YTD` 16,794, `_Employee Tax YTD` 16,572); the
     other nine are empty. Helpers are used **only** by the Cost rules/feeders (no TI, no
     Lens) and are the cross-cube entry point from `WFP Workforce Input` FTE / One-Time.
   - currencies: GBP 30,816 + USD 29,223 + NZD 11,097 (**local 71,136, 34%**), Reporting +
     Reporting @ Budget FX 136,430. Local currencies are the **calc basis** for the
     translation rules; **24 assertions** read local currencies or helpers.
   Options: (a) **NOT safe as framed** — the feeder chain is load-bearing: `WFP Workforce
   Input` FTE feeds `_Monthly Base Full`, which feeds **Base** and **Benefits**; ER tax is
   fed `Base → _Earnings YTD → _Employer Tax YTD → Employer Payroll Tax`. Remove those
   helper feeders and Base/Benefits/ER tax silently unfeed (totals drop). The only safe
   version is to re-point the cross-cube FTE feeder straight at Base and Benefits and keep
   the YTD chain — a small feeder win, **no cell change**. (b) move the 13 helpers to a small
   helper cube — −26% cells, medium effort; (c) also drop the 4 non-page components — −56%,
   but loses Employee Deductions and breaks their assertions (James deciding); (d) drop local
   currencies — high risk (calc basis + 24 assertions). Even the aggressive path lands at
   ~43k cells/month → snapshot ~25–30 min, **not minutes**. Prove any change with the
   compare script plus the 62 assertions, across all versions (a rules/feeder change applies
   to the whole cube — there is no "Downside first").
2. **Server settings (investigated, read-only).** MTQ is already on (4 cores). **MTFeeders /
   MTFeeders.AtStartup must stay F** — the model has conditional (attribute- and
   data-directional) feeders. **`ForceReevaluation…OnDataChange` stays T** (measured ~15%
   write overhead). The one candidate is **`MaximumCubeLoadThreads=3`** (static): James adds
   it at the next planned restart (SaveDataAll first), then run the compare (expect 0) +
   assertions and time the restart and the cold read; undo by removing the line and
   restarting.
3. Open question for James: Downside hiring lines for ENG-005 / SLS-003.
4. **Lens access (`config.access` per Lens).** Home now hides Lenses the person can't
   open — new route `GET /api/lens/lenses` filters by `config.access` against the signed-in
   person's TM1 groups (commit 240e059; IDE Explorer still shows all by design). The
   actual restriction needs each Lens's `config.access` set to the groups that may open it.
   Propose the per-Lens group map for James to approve; a Lens with no `access` stays
   visible to everyone.
5. **Move heavy calculations to TI — do this LAST, after the Lenses are updated.** The
   seat-level cost posting (Base, Benefits, ER tax → Cost) and the month-by-month YTD tax
   chain are what put a rule/feeder on every seat-month, driving the ~56s cold read, the
   ~12-min feeder rebuild and the 1.5h snapshot. Settings can't fix it. Plan (when we get
   there): which calcs move, what triggers them (version copy / Lens Save / a single
   `CubeProcessFeeders` after a bulk load), and prove with the compare script (0
   differences) + the 62 assertions before touching rules.

**Parked:** `WFP Snapshot Fast` (design: copy every cube in full except Cost, Cost at leaf
seat level; chore `MultipleCommit`) was designed and probed but **not built** — James chose
to slim the Cost cube instead. `WFP Snapshot` stays as-is; use it overnight.

Review list (work_state "workforce-lens-review"): save column layout from Preview; centre
all Lenses / roll the Assumptions look (1700px, footer History icon, stripes); month-grid
house rule (no sort/filter); cellMenu on every grid.

Shared pivot leftovers: IDE's own member picker + right-click menu onto the shared ones;
Advanced "views" (needs a view-layout bridge call) and aliases; paste from Excel;
spreading.

Lens app (`lens-server.js`) still points at 24Retail_Lens and needs a restart (James) to
pick up the new toolkit and routes.
