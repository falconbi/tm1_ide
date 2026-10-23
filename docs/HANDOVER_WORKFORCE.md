# Handover — Workforce model & Lenses (22 Oct 2026)

For the next agent (OpenCode) picking up the Workforce work. Read this first, then
`docs/BUILDING_MODELS.md` (v11 landmines) and `docs/PIVOT_PLAN.md`.

## Working rules (James's, non-negotiable)

- **Push only when James explicitly says "push".** Default is local on branch `lenses`.
- **Warn him before anything that may take more than a few seconds** — full compare (~8 min),
  rules PATCH (~15 min), snapshots, long TI runs. Never leave him waiting silently; keep
  replies short.
- **Never restart servers.** Tell James: `systemctl --user restart tm1-backend` (IDE);
  the Lens app is Ctrl+C then `npm run lens`.
- **Ask before coding** when he is discussing ("I am discussing" = don't build). When he
  says go, build, test, report.
- Plain English, short answers, the concrete answer first. One step at a time in walkthroughs.
- No Playwright. Never write anything personal about James. Never call Lenses "frames".
- Keep TM1_CONSOL private. Never print or commit tokens. Security changes: James runs them.
- Don't re-add the amber "zero rule cell" highlight — he rejected it.

## Cold start — current state (25 Oct)

Read this first; items 14–17 below have the detail.

- **Step 2 done (23 Oct, Claude): the HR load keeps Actual assignments, records and dated
  pay.** New extract layout with dates and BaseSalary; `pClear`, `pCost`. Proven: reload
  reproduces every Actual assignment, compare 0 vs `2026-10-23-clean`, 59/59, a pay-change
  round trip. Design + proof in `docs/ASSIGNMENT_MODEL.md` → "HR extract and load". Process
  sources: `tmp/workforce/src/step2/`. **Caution:** the old backfill process
  `WFP Assignment Pay` clears the whole Pay cube, Actual included — don't run it after an HR
  load (it would put Workforce Input salaries back over HR pay).
- **Step 3 done (23 Oct, Claude): handover.** `WFP Assign Person` pReplace `handover` +
  `pHandoverUntil`; new `WFP Mark Handover`; `Handover FTE` / `In Handover` measures; the
  Over-filled rule allows a marked overlap. Fixed on the way: Base cost now adds each
  assignment (was overwriting → two people in a month costed as one), and Assign Person
  writes the new assignment's pay (was costed at band midpoint). Proven on Downside and
  reverted; compare 0, 59/59. Details: `docs/ASSIGNMENT_MODEL.md` → "Handover". Sources:
  `tmp/workforce/src/step3/`. Next: Step 4 (Position regrade / FTE change from a month);
  roster Lens needs the handover option.

- Branch `lenses`, server `TM1_Test_DEV`, change set `92a949c9` open. Uncommitted:
  `docs/HANDOVER_WORKFORCE.md`, `shared/lens-kit/index.js`, `static/lens-kit/lens-kit.js`.
- **Default convention:** every model dimension/cube has a public object literally named
  `Default` (case-sensitive, no braces). All 27 subsets + 12 views exist and execute.
- **Base is TI-written now.** Cost `Base` rule + `_Monthly Base Full => Base` feeder removed.
  TI `WFP Assignment Base` reads the **monthly assignment pay** cube `WFP Assignment Pay`
  (per assignment per month: Base Salary, FTE; backfilled from Workforce Input, Pay Rates
  `Salary Mid` fallback), and its Epilog full pass writes every Position-month (0 where none)
  to Cost `Base` at Position Map Entity / Cost Centre / Salary Currency.
  **compare 0 (702,222 values), 59/59 assertions; Base TI ~23–28s; pay backfill ~4 min.**
  Rules PATCH **872s** (raise the 120s client timeout); long TIs also exceed 120s. Triggers:
  `WFP Copy Version` Epilog; Lens **5 Assignments v5 Recalculate**. Write actions do NOT
  auto-recalc. Caveats: full pass covers Budget/Forecast/Downside/Actual only (not Working or
  stored snapshots); a `WFP Move Seat` CC change can leave Base at the old CC until cleared;
  the pay backfill clears `WFP Assignment Pay` before rebuilding (so it wipes any future dated pay edits — those must be re-applied or sourced).
- **Detail:** 2,782 named records per version + planned-hire presence (Budget 236 / Forecast
  128 / Downside 127) on employee leaf `Planned Hire`; day-level dates; Actual trimmed to
  2026-01. Rebuilding the detail drops view `WFP Assignment Base Src` — recreate it.
- **Stage 4 actions write the detail:** End Assignment, Approve Hire (Planned Hire presence
  at Hire Month; needs `cPer='WFP Period'`), Assign, Transfer (same-company guard). All
  tested and restored. E10003 (Ben Ortiz) incident repaired across all versions + detail;
  baseline re-captured. **Confirm E10003's name with HR.**
- **Lenses:** 5 Assignments v5; Position roster v16 (transfer From-first, same-company,
  taken-seat exclusion, history refresh v12; Move copy says same-company); Home v19.
  Recipient-CC-owner approval is design only, not built.
- **Home slowness (settled on a warm server):** the full page renders in 1.0–1.2s and its
  four queries take 0.0–0.1s once warm — it is not slow on every load. The cold first read
  after a TM1 restart is still unmeasured (needs a restart); run
  `node tmp/workforce/home-cold-check.js` immediately after one, before opening the Home.
- **Move-position test: done via the roster Lens** (Downside, ENG-002, from 2026-05,
  CC-ENG-PLT → CC-ENG-APP). The Lens ran `WFP Move Seat` (1.7s), the message appeared, 20
  months (2026-05…2027-12) changed CC and Home Entity stayed UK Ltd; the roster showed it
  leave CC-ENG-PLT and appear in CC-ENG-APP. Restored 72 Position Map cells from
  `move-snapshot.json`; roster re-check passed; compare 0 (702,218 values); 62/62 assertions
  at the time (58/58 now — item 20).
  The position was vacant, so the stale-Base caveat was not exercised — still open for a
  filled position.
- **Move guard (done):** cost centres are **shared across companies** (39/40 have UK/US/NZ
  positions; only CC-SALES-UK is UK-only), so a CC list **cannot** be filtered by company —
  that part of the old Next step was wrong. The real risk was `pEntity`: `WFP Move Seat` now
  **refuses a company different from the seat's current Home Entity**. Tested: US Inc
  refused, UK Ltd / blank allowed, Position Map unchanged. Roster v16 copy updated.
- **Open:** a filled-position Move may leave Cost Base at the old CC until cleared.
- **Next (approved plan):** 1) Home cold probe at the next TM1 restart. 2) Step 2: the Actual
  HR feed maintains `WFP Assignment Detail` + `WFP Assignment Pay`. 3) Step 3: Handover action
  + `Over-filled` exemption. 4) Step 4: dated regrade / budgeted-FTE. 5) Step 5: Close/Reopen
  + company move. 6) Step 6: TBH lifecycle/matching. 7) Step 7: absence/cover. 8) naming
  cleanup. Also open: stale-Base clear on Move (filled position); recipient-owner approval.
- **Terms:** user-facing "Position"; internal names stay (`Seat FTE`, `WFP Move Seat`,
  `WFP-Seat-Roster`). Transfer = person to a different Position; Move = same Position to a
  different CC; a company change is a leaver + a new Position, not a Transfer.
- **Data facts:** 3,022 positions, 2,782 employees; Actuals Cutoff Index 15 (2026-03);
  ENG-005 is US Inc; FIN-1238 is CC-FIN-FPA (UK Ltd); test temps cleaned up.
- **Checks:** `npm test` (316 pass, 1 skip — `tests/` only, never touches TM1); live check
  `tmp/workforce/run.js`; MCP `tmp/workforce/mcp.js`; 59 assertions (all pass, 23 Oct).
- **Baseline compare:** `node tmp/workforce/compare-consol.js compare 2026-10-23-clean` (~2 min,
  read-only). **Baselines are write-once:** capture refuses an existing label, and the files are
  read-only. Capture a new, dated label after an intended change (`capture 2026-MM-DD-<what>`).
  `2026-10-23-clean` = the model after Step 1 + the E10003 restore (59/59).
- **Live scripts:** only `tmp/workforce/live-*.js`, each refusing to run without `LIVE=1`. The 58
  older one-off scripts that changed TM1 without a guard are in `tmp/workforce/archive-unguarded/`
  — do not run them.

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

## The model in one paragraph (Option B: positions + people)

A `WFP Position` is the **budgeted establishment** (the position); `WFP Position Map` (by month) holds its Cost Centre,
Home Entity, Grade, Location, Seat FTE and a rule-driven **Seat Status**
(Filled / Planned hire / Vacant / Closed). People are `WFP Employee` (2,782, alias Display
"Name · ID"); `WFP Assignment` (Period × Version × Position × Employee × measure) says who
sits where (FTE Share, Start/End Reason, flags Joiner/Leaver/Transfer In/Out — the Leaver
flag sits in the person's **last** month). `WFP Hiring Plan` holds a position's Hire Month +
Finance approval; only approved hires count, and only while nobody is assigned
(Effective Hire Month → position End Period). Attrition Month is **dead** (no rule reads it).
Processes: WFP Assign Person, End Assignment, Transfer Person, Move Seat, Approve Hire,
Load HR Assignments (+ Write Sample HR Extract). Outcomes go to the `Lens Messages` cube.

## Done this session (22 Oct)

1. **Home link** on every Workforce Lens (`config.home`), commit 49134b6.
2. **Hiring plan reworked** (WFP-Hiring-Plan v4): one row per position from Position Map +
   Assignment; Leave month column removed; "Leaves after …" read-only; hire month refused
   in a month someone sits in the position or the position is closed; "Opens Sep 2026" for future
   positions; Position roster link; right-click Why/Who/Notes on hire month.
3. **New Lens: Leavers & backfills** (WFP-Leavers v1): all leavers (472 in Forecast), what
   happens to the position after, months vacant, editable Backfill from (writes Hire Month),
   Record a leaver by name (WFP End Assignment, HR/Finance only).
4. **Titles renumbered** 0–15 to match Home order; Home tiles updated.
5. **Model fix (processes, live):** WFP End Assignment (no backfill) and WFP Transfer Person
   now clear the position's **old** approved Hire Month (≤ the person's last month), which would
   otherwise revive the position as a counted "Planned hire" after they go. End Assignment's
   cutoff message no longer prints an index. Script: `tmp/workforce/fix-stale.js`.
   **Verified live on Downside** (23 Oct): Assign Person into an approved planned-hire position
   (`ENG-2069`, hire 2026-08), End Assignment with no backfill → Hire Month 0, Approved/By/At
   cleared, Seat Status Vacant from 2026-09; restored from a full snapshot. Neither process
   touches the employee record for an existing person (the Status/Leaver attr writes are only
   in the new-person branch).
6. **New Lens: Transfers** (WFP-Transfers v1, title `4 Transfers`): people moving between
   positions and cost centres (Assignment Transfer In / Out flags), paired per person (Transfer
   Out sits the month before the Transfer In), "Old position after" column reusing the Leavers
   logic, record a move by name (WFP Transfer Person, HR/Finance). No direct cube writes —
   process only. `tmp/workforce/lens/WFP-Transfers.src.html`. Tested live on Downside
   (`EXEC-001` → `ENG-002`, Henry Ford · E10001, from 2026-06): FTE moves, End Reason
   `Transfer Out` the month before, Start Reason `Transfer In`, old position Vacant, new position
   Filled, salary copied to the new position; restored from a full snapshot.
7. **New Lens: Positions needing attention** (WFP-Attention v1, title `8 Positions needing attention`,
   Review group) + a Home tile: the three control checks (WFP Assignment `Over-filled` /
   `Over-booked`, WFP Position Map `Person In Closed Seat`). **The test caught a real bug:**
   `NON EMPTY` silently skips the two unfed rule checks (it saw only the fed closed-position
   check), so it would have shown "all clear" while positions were over-filled. Fixed by reading
   the **consolidated month totals without `NON EMPTY`**, then scanning the full leaf grid for
   only the months that trip (no feeder changes). Landmine written up in
   `docs/BUILDING_MODELS.md`. Proved with three real Downside trips (second person into a
   filled position → 2 over-filled; one person at FTE in two positions → 1 over-booked; a person in a
   closed position → 1 closed, which also trips over-filled as its position FTE is 0): lens and Home
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
   read Cost at position (Position) level — but only `Total Compensation` / `Reporting` /
   `Amount`. Position Map is read by none of them.
10. **Fast-snapshot probe (read-only design check).** Every element checked: `Total
    Positions` and the function names are consolidations; `Total Compensation`, `Cost to
    Company`, `Employee Deductions`, `GL:…` are consolidations; `Currency` and `Measure`
    are all leaves. So Cost must be stored at **leaf positions** — totals roll up. Bedrock's
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
14. **Every model dimension and cube has a Default object (25 Oct).** All 27 model
    dimensions carry a public subset named `Default` (all elements); all 12 cubes carry a
    public view named `Default` (measure on columns, first dimension on rows, the other
    titles at their default member). Created the 2 missing subsets (`Lens Message`,
    `WFP Assignment Detail Measure`) and the 4 missing views (`Lens Messages`,
    `WFP Assignment`, `WFP Assignment Detail`, `WFP Position Map`); **all 12 views execute
    cleanly**. The object name is the flag — `Default` is case-sensitive and there is no
    separate "is default" property in the REST API.
15. **Assignment list Stage 1 done (25 Oct).** New `WFP Assignment Detail Measure` (7
    elements) and cube `WFP Assignment Detail` (Version × Position × Employee × Measure);
    backfilled 1,940 assignments across Budget/Forecast/Downside (13,580 cells; salary from
    the end-month Workforce Input Base Salary, Seed Base Salary fallback). New read-only
    Lens **5 Assignments** (`WFP-Assignments`, inserted after Transfers; Home tile;
    renumbered 0–16, so **Attention is now 9**): version / cost centre / position picker,
    one row per assignment with Person, From, To, FTE, Salary, Handover. Vacant positions
    read "No assignments". Tested Forecast + Downside + cost-centre switch; assertions
    62/62. **The first backfill was wrong** (the month axis was NON EMPTY, so chunks with
    fewer months mis-indexed and lost 842 positions) — the cube was cleared/rebuilt:
    **2,782 named records per version** (every paid position), dates day-level (320 partial
    starts), plus **planned-hire presence records** (Budget 236, Forecast 128, Downside 127)
    using a new **`Planned Hire`** employee leaf (Display "Planned hire"). Total detail
    records: Budget 3,018, Forecast 2,910, Downside 2,909, **Actual 2,782** — the Actual
    detail starts are trimmed to **2026-01** (the first Actual Cost month; the Actual
    Assignment FTE begins 2025-12).

16. **Base → TI: final (25 Oct).** A read-only replica proved the formula: detail
    windows + monthly Workforce Input salary/FTE + Pay Rates `Salary Mid` fallback +
    calendar-day proration matches the old Cost `Base` **exactly** — 0 differences across
    36 months × Budget / Forecast / Downside (491,556,295.71 / 482,509,947.88 /
    480,495,890.79). A staging cube **`WFP Assignment Base`** and TI **`WFP Assignment
    Base`** (view `WFP Assignment Base Src` over the detail) were built. The Cost `Base`
    rule + `_Monthly Base Full => Base` feeder were removed; the TI fills the staging from
    the detail and an **Epilog full pass** writes **every Position-month** to Cost `Base`
    (0 where nothing is assigned) at the Position Map Entity / Cost Centre / Salary
    Currency — this clears stale months after an end or transfer.
    **compare 0 (702,218 values) and 62/62 assertions.** Rules PATCH **872s** (raise the
    120s client timeout for this cube); the TI run **35s**.
    **Triggers:** `WFP Copy Version` calls the TI in its Epilog; Lens **5 Assignments v5**
    has a **Recalculate** button (all versions, ~1 min). The write actions do **not**
    auto-recalc; version copy does.
    **Caveats:** the full pass covers Budget / Forecast / Downside / Actual only (not
    Working; the stored snapshot versions are untouched). A Position Map / Cost Centre
    change (`WFP Move Seat`) can leave Base at the old Cost Centre until cleared — add a
    clear to Move Seat (or avoid map changes) until then.
    *History: a first switch was reverted because the actions did not yet write the detail
    and the detail had no Actual; both were fixed in item 17 before this final switch.*

17. **Stage 4 + incident (25 Oct).** The four write actions now update the detail:
    - **End Assignment** sets the record End Period/Day (tested PRD-1060/E10074; restored).
    - **Approve Hire** creates the `Planned Hire` presence at the Hire Month on approve and
      clears it on reopen (tested PRD-1089; restored).
    - **Assign Person** creates the new record and ends replaced people's records; the
      process ran correctly — **but the test cleanup picked the first employee in the
      detail (historical E10003) and deleted E10003**.
    - **Transfer Person** code is in place (old record ends the month before pFrom; new
      record starts at pFrom) — **not yet tested**.
    **Incident repair:** E10003 (Ben Ortiz · E10003, ENG-002) was re-added with attributes,
    assignments in Budget / Forecast / Downside / Actual / FCST 2026-03, and detail
    records; the phantom E12784 was removed. Cost compare 0; 62/62 assertions. Two HC cells
    (`HC|Downside|2025-12` Hires/Closing) are now 1 — the position-level HC was already 1
    (the snapshot confirms) and the old CC roll-up was stale at 0; **the compare baseline
    was re-captured** (702,218 values; compare 0). E10003's name is inferred from the
    position incumbent — **confirm with HR**.
    **Transfer Person** is **same-company only** (James's call): a company change is a leaver
    + a new Position/assignment in the new company, not a Transfer. A guard was added to the
    process (refuses a cross-company target) and the roster filters its targets to the current
    company. The Transfer form now puts **From first** and re-filters the To list to that
    From (roster **v14**; verified Apr 61 → Jul 105 options, label follows). The earlier temp
    test moved ENG-002 (UK Ltd) → ENG-005 (**US Inc**) — a cross-company move, not the
    intended transfer; its data was restored (compare 0) and the guard now refuses it (tested:
    no data change). The **same-company CC transfer** on the temp is the remaining scenario;
    the **Base switch was redone** with the full pass (item 16).

18. **Move-position test via the roster Lens.** Drove **Position roster v15** in jsdom
    with a live runner (`tmp/workforce/run-live.js` — real `runProcess`, unlike `run.js`)
    against `TM1_Test_DEV`: Downside, Apr 2026, CC-ENG-PLT, select **ENG-002**, **Move
    position…** → **CC-ENG-APP** (a UK Ltd CC), from **2026-05**. The form listed **39 CCs**
    (all except the current one — no company filter), `pEntity=''`. The Lens ran
    `WFP Move Seat` in **1.7s** and showed *"Seat ENG-002 moves from CC-ENG-PLT to CC-ENG-APP
    from 2026-05 (Downside)."* Data: **20 months changed** (2026-05…2027-12), **16 unchanged**
    (…2026-04), Home Entity stayed **UK Ltd**, Seat FTE 1, Seat Status Vacant. The roster then
    showed ENG-002 gone from CC-ENG-PLT and present in CC-ENG-APP in May.
    **Restored** all 36 months × {Cost Centre, Home Entity} = **72 cells** from
    `tmp/workforce/move-snapshot.json`; all match the snapshot; roster re-check confirms it is
    back in CC-ENG-PLT. **Compare 0 (702,218 values); 62/62 assertions.** The position was
    **vacant**, so Base was null at both CCs — the **stale-Base caveat is untested** and needs
    a filled position (next test). Scripts: `move-snap.js`, `move-lens-check.js`,
    `move-restore.js`, `run-live.js`.

19. **Move guard — same company only.** Investigated the old Next step "filter the
    Move CC list to the current company". **That premise is wrong:** cost centres are not
    company-specific — at Apr 2026, **39 of 40 CCs have positions in all three companies**
    (e.g. CC-ENG-APP = UK 89 / US 89 / NZ 32); only **CC-SALES-UK** is UK-only. There is no
    CC→company mapping to filter on (Transfer can filter because it targets *positions*,
    which carry Home Entity; Move targets a *CC*).
    The real risk was the process parameter `pEntity`: `WFP Move Seat` would change Home
    Entity if passed one. It now **refuses a company different from the seat's current Home
    Entity** (blank or the same company is allowed). Updated the process (prolog, change set
    `92a949c9`) and the roster Info/note copy (**v16**). Tested live on Downside / ENG-002 /
    2026-05: `pEntity='US Inc'` → *"Seat ENG-002 is in UK Ltd — a move stays in the same
    company…"*; `pEntity='UK Ltd'` and blank → allowed; **Position Map unchanged** after all
    three (checked against `move-snapshot.json`). No compare re-run — no data changed.
    Scripts: `move-company-probe.js`, `move-guard-apply.js`, `move-guard-test.js`.

20. **Assertion cleanup (58 remain).** Removed four duplicates; backup in
    `tmp/workforce/assert-removed.json`; **58/58 pass**. Removed: `1740b6db` (older copy of
    the ENG-002 tax control), `9cdd95e8` (identical, untagged), `61a5059e` (ENG-005 `=6600`
    mislabelled `control` — it depends on data), `7e937d87` (identical, untagged). Kept the
    ENG-002 tax zero as the `control` (`958ed167`) and the ENG-005 6600 as a `behaviour`
    check (`39aeacf8`). Tags on the rest were left alone — the tooling has no assertion
    update, and re-adding would rewrite each assertion's author/change-set provenance.
    **Caveat:** the over-booked control (`b09660c1`) hit the client's **120s** timeout on a
    cold cache, then passed; run assertions again if it times out. Coverage gaps unchanged:
    no assertions yet for Assignment Detail counts, Base TI totals, or the Stage 4/Move
    process guards (the Move guard is a manual test by nature).

21. **LAB separated from the Workforce change set.** The 42 `LAB *` entries were moved from
    `92a949c9` to a separate **closed** session `a793c922-4a56-4b20-ab72-37b868b9cfaf`
    ("WFP_Lab — test model, never deploy"). Packaging filters them out
    (`tools/tm1deploy/src/never-deploy.js`, used by the packager) and the deployer **hard-stops**
    any package containing a `LAB ` object. `WFP_Lab` is generated by `tmp/workforce/lab-build.js`
    from WFP's own cube dimension order and measure names; it proved the dated-pay logic
    (LAB-003: 80k→90k mid-year = 6,666.67 then 7,500, while the old position salary stayed
    7,500).

22. **Step 1 — pay on the assignment (done).** New cube **`WFP Assignment Pay`** (Period ×
    Version × Position × Employee × Measure: Base Salary, FTE), backfilled from monthly
    Workforce Input; `WFP Assignment Base` now reads it (Pay Rates fallback). Old TI backed up
    at `tmp/workforce/base-ti-before-step1.json`. Scope: **11,618 detail records / 207,339
    months / 414,678 pay cells**. The backfill exceeded the 120s client timeout (actual ~3 min;
    the 40–70s estimate was wrong); Base TI **24.6s**, **28.1s** after the repair.
    **Compare 0 (702,222 values); 59/59 assertions; npm test 316 pass, 1 skip (unit only).**
    The first compare showed 792 differences in CC-FIN-FPA / Downside 2026-11: **FIN-1238's
    `Planned Hire` detail record had End 2026-04 before Start 2026-11** — the only such record
    in any version. The baseline held a stale 2,666.67 Base; the record was repaired to
    End 2027-12/31. Caveat: the pay backfill clears `WFP Assignment Pay` before rebuilding, so
    dated pay edits must be re-applied or sourced.

23. **Follow-ups to Step 1 (done).** `WFP Approve Hire` now **refuses a planned hire whose
    position end is before the hire month** (tested: End 2026-04 on FIN-1238 → Aborted,
    approval unchanged). New **`WFP Check Assignment Spans`** writes `Bad Span` (1 where
    end < start); it is called from Assign / End / Transfer / Approve Hire. New control
    assertion **"no assignment record ends before it starts"** (expected 0) — **59/59**.
    `WFP Assignment Pay` now **clears before rebuilding** (house rule). `run_process` takes
    **`timeout_ms`**, threaded through the adapter/client (backfill ran 233.6s). Also repaired
    a repeat **E10003** deletion (not via the MCP log; cause unknown) with correct per-version
    spans: Budget/Forecast/FCST to 2027-12, Downside/Actual to 2026-03; Forecast gets the 4%
    merit from 2026-04 (85,280). Removed the returned **phantom E12784** (ENG-002 Oct 2026+,
    +7,333/month). Baseline recaptured at **702,222** values because the Forecast 2025-12
    CC roll-up was stale 0 (same pattern as item 17); compare 0.

24. **Root cause of the repeated E10003 loss: `npm test` ran live scripts.** `node --test`
    discovers `test-*.js` anywhere, and `tmp/workforce/test-assign.js` was deleting **the first
    employee in the detail** (E10003) after creating "ZZ Test Assign" (the phantom E12784). So
    every test run damaged the model. Fixes:
    - `npm test` now runs **`tests/` only** (316 pass, 1 skip, 13s; no live calls).
    - live scripts renamed **`tmp/workforce/live-*.js`** and each **refuses unless `LIVE=1`**.
    - `live-assign.js` records the IDs before the run and deletes **only the one it created**.
    - **`WFP Assign Person` now allocates `max E-number + 1`** and never reuses a gap (a deleted
      test ID can't be handed to a real hire).
    - E10003 restored with verified spans (Budget/Forecast/FCST to 2027-12, Downside/Actual to
      2026-03; Forecast 4% merit from 2026-04 = 85,280); phantom E12784 removed.
    **Compare 0 (702,222), 59/59.** The 18:07 `WFP Assumptions` MCP writes are **not** from any
    test script (none write Assumptions) and remain unattributed; no live script runs now.
    Landmine added to `BUILDING_MODELS.md`.

**Salary belongs to the position** (intended, confirmed by James): a transfer copies the rate to
the new position and **leaves it on the old position** as the starting point for a backfill. A vacant
position costs nothing, so it is not counted twice — **not yet proved**: next Downside test should
read `WFP Workforce Cost` for the old position in the vacant months and confirm 0.

Verified by live read-only runs plus the reversible Downside tests above (actions tested
via the API). **Not yet exercised in the UI:** the Lens v5 **Recalculate** button, the
`WFP Copy Version` trigger, a real hire-month save, an approval, a backfill save, Record a
leaver, Record a transfer.

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
   compare script plus the 58 assertions, across all versions (a rules/feeder change applies
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
5. **Terminology — standardize on "Position" (James's decision).** The model already says
   Position; only the UI/docs say "Position". Phase 1 (cheap, display only): Lens titles/labels/Info/
   Home tiles/prose → "Position" ("Position roster", "Positions needing attention"), keeping the
   internal names `WFP-Seat-Roster`, `Seat FTE`, `Seat Status`, `WFP Move Seat`. Phase 2 (model
   refactor, test with compare + assertions): `Seat FTE` → `Position FTE`, `Seat Status` → ? — it
   **collides with the `WFP Position` attribute `Position Status`** (the establishment status from
   the position file), so one must be renamed (`Establishment Status` vs `Monthly Status`);
   `WFP Move Seat` → `WFP Move Position`; lens name `WFP-Seat-Roster` → `WFP-Position-Roster`.
   **Decision needed on the status naming before Phase 2.**
6. **Move heavy calculations to TI — do this LAST, after the Lenses are updated.** The
   position-level cost posting (Base, Benefits, ER tax → Cost) and the month-by-month YTD tax
   chain are what put a rule/feeder on every position-month, driving the ~56s cold read, the
   ~12-min feeder rebuild and the 1.5h snapshot. Settings can't fix it. Plan (when we get
   there): which calcs move, what triggers them (version copy / Lens Save / a single
   `CubeProcessFeeders` after a bulk load), and prove with the compare script (0
   differences) + the 58 assertions before touching rules.

**Parked:** `WFP Snapshot Fast` (design: copy every cube in full except Cost, Cost at leaf
position level; chore `MultipleCommit`) was designed and probed but **not built** — James chose
to slim the Cost cube instead. `WFP Snapshot` stays as-is; use it overnight.

Review list (work_state "workforce-lens-review"): save column layout from Preview; centre
all Lenses / roll the Assumptions look (1700px, footer History icon, stripes); month-grid
house rule (no sort/filter); cellMenu on every grid.

Shared pivot leftovers: IDE's own member picker + right-click menu onto the shared ones;
Advanced "views" (needs a view-layout bridge call) and aliases; paste from Excel;
spreading.

Lens app (`lens-server.js`) still points at 24Retail_Lens and needs a restart (James) to
pick up the new toolkit and routes.
