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
4. **Titles renumbered** 0–13 to match Home order; Home tiles updated.
5. **Model fix (processes, live):** WFP End Assignment (no backfill) and WFP Transfer Person
   now clear the seat's **old** approved Hire Month (≤ the person's last month), which would
   otherwise revive the seat as a counted "Planned hire" after they go. End Assignment's
   cutoff message no longer prints an index. Script: `tmp/workforce/fix-stale.js`.
   **Compiled, not yet scenario-tested** — test on Downside: Assign Person into an approved
   planned-hire seat, End Assignment with no backfill, check Hire Month = 0 and Seat
   Status Vacant after; then revert.

Verified by live read-only runs only. **Not yet done by James in the UI:** a real hire-month
save, an approval, a backfill save, Record a leaver.

## Next, in order

1. **Transfers Lens** — people moving between seats/cost centres (Assignment Transfer In /
   Out flags; WFP Transfer Person). Same shape as WFP-Leavers.
2. **Home tile "seats needing attention"** from the 3 control assertions (over-filled,
   over-booked, person in closed seat — Position Map / Assignment check measures).
3. **My cost centre** and **Since last forecast** still read the dead Attrition Month —
   switch their leaver lines to WFP Assignment (Leaver flag).
4. Re-record the 17 scale assertions for the 3,000-person model.
5. Open question for James: Downside hiring lines for ENG-005 / SLS-003.

Review list (work_state "workforce-lens-review"): save column layout from Preview; centre
all Lenses / roll the Assumptions look (1700px, footer History icon, stripes); month-grid
house rule (no sort/filter); cellMenu on every grid; model performance (full feeder
rebuild ≈12 min, cold cost reads 75–90 s — low priority).

Shared pivot leftovers: IDE's own member picker + right-click menu onto the shared ones;
Advanced "views" (needs a view-layout bridge call) and aliases; paste from Excel;
spreading.

Lens app (`lens-server.js`) still points at 24Retail_Lens and needs a restart (James) to
pick up the new toolkit and routes.
