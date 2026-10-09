# TM1 IDE — Improvement Backlog

Prioritized list of improvements identified during a review of the deploy pipeline,
audit trail, and diff engine (Sep 2026). Each item is grouped, with file references,
effort estimate, and the reasoning.

---

## 1. Audit & History

### 1.1 Hard-gate browser write routes on an active session

- **Why:** Biggest audit gap. Browser edits made with no active session log with
  `session_id = null` (`hasSession: false`, `core/change_log.js:263`), so they have no
  user attribution, no session grouping, and no rollback linkage. Only the MCP path
  refuses writes without an open change set (`tools/tm1mcp/shared.js:79`).
- **Fix:** Apply the same gate to the ~10 mutating routes in `server.js` — refuse (or
  auto-open a session) when no session is active for that server.
- **Effort:** Small.

### 1.2 Add `user` column to `log_entries`

- **Why:** Per-edit attribution currently only exists via `JOIN sessions`. Unsessioned
  edits are anonymous forever.
- **Fix:** Schema migration (`ALTER TABLE log_entries ADD COLUMN user TEXT`) + write it in
  `writeLog` (`core/change_log.js:231`).
- **Effort:** Small.

### 1.3 Surface the 200-row `getObjectHistory` cap

- **Why:** `getObjectHistory` (`core/change_log.js:210`) silently truncates at 200
  entries — history is hidden without the user knowing.
- **Fix:** Return `truncated: true` and show it in `ObjectHistoryPanel.jsx`.
- **Effort:** Trivial.

---

## 2. Deploy Diff

### 2.1 Fix `diffDimension` to use the structural signature

- **Why:** **Correctness bug.** `diffDimension` (`tools/tm1deploy/src/diff.js:248`)
  compares element *names only* — a re-parent, weight change, or hierarchy restructure
  reports "element count unchanged" → MATCH. The correct signature already exists in
  `scopedSnapshot` (`tools/tm1deploy/src/snapshot.js:470`): elements `Name:Type` + edges
  `Parent>Child=Weight`, sorted.
- **Fix:** Port that signature into `diffDimension`.
- **Effort:** Small.

### 2.2 Line-level diff in the deploy diff output

- **Why:** `diffRules`/`diffProcess` (`tools/tm1deploy/src/diff.js:120,146`) compare whole
  normalized strings and return "changed from baseline" with no detail. The UI already has
  a Monaco side-by-side DiffEditor via `before_state`/`after_state`
  (`client/src/components/DiffViewerModal.jsx`) — thread a line-diff into the diff result
  so review shows *what* changed, not just that it changed.
- **Effort:** Medium.

### 2.3 Leverage `before_state` in the diff

- **Why:** `before_state` is captured (change_log.js:229) but never read by `diff.js`. It
  would power "this session changed X: A → B" per object, independent of the baseline.
- **Effort:** Small.

---

## 3. Release Windows

### 3.1 Two-baseline / release-window diff

- **Why:** "What changed between baseline N and N+1" is computable *today* — the building
  blocks exist (`getEntriesSinceId`, `core/change_log.js:182`, and the baseline's
  `last_entry_id`) — it is just not wired into any command or UI.
- **Effort:** Small–medium.

### 3.2 Auto-suggest baseline cadence

- **Why:** Recovery quality depends on seed freshness; there is no warning when the HEAD
  baseline has gone stale.
- **Fix:** Warn when the current baseline is older than N days (or N change-log entries
  behind `getMaxEntryId`).
- **Effort:** Small.

---

## 4. Recovery

### 4.2 Per-server read-only / no-pull posture

- **Why:** Lets PROD be browse-only while DEV stays writable — prevents accidental writes
  to the wrong server. Modeled on PA-Code's "Local Workspace Folder off" idea.
- **Fix:** Per-server flag that gates the write routes in `server.js`.
- **Effort:** Medium.

---

## 5. AI / Editor Loop

### 5.1 Wire save → CheckRules → inline error feedback

- **Why:** The one editor-ergonomics item worth keeping. When AI writes rules/TI via MCP,
  caught errors should surface immediately rather than at deploy time. The pieces exist
  (`/api/cube/check`, CheckRules, static validators) — they just need to be in the loop
  automatically.
- **Effort:** Medium.

---

## 6. MCP / PROD Security

### 6.1 Gate the MCP `check_deploy_risk` / `check_target_drift` targets to an allowlist

- **Why:** The MCP binds to ONE server (`--server` / `TM1_MCP_SERVER`, `tools/tm1mcp/shared.js:18-29`) —
  all write tools (`build_*`, `write_cells`, `update_cube_rules`, `delete_object`, …) run against that
  single bound server, so the AI **cannot** write to any other server. But `check_deploy_risk` and
  `check_target_drift` (`tools/tm1mcp/tools/deploy.js:10-47`) accept **any server name as `target`** and
  connect to it via the fallback admin account. They are read-only, but they still open a read connection
  to whatever target the AI names — including PROD.
- **Fix:** Refuse any `target` not in an allowed set before opening a connection. Source of the allowlist:
  env var `TM1_MCP_ALLOWED_TARGETS` (comma-separated) as the override, falling back to a key in
  `config/servers.json` (e.g. `"mcpAllowTargets": [...]`). Default behaviour: only the bound `SERVER`
  itself plus the allowlist; anything else errors out before any connection is made.
- **Scope decision:** MCP-only is the high-value gate (the CLI / IDE Deploy panel is already a human step).
  Consider extending to `tm1deploy deploy --target` later if needed.
- **Effort:** Small.

### 6.2 (Optional) Run a second, PROD-quarantined MCP instance

- **Why:** If the fallback admin account is the only identity the MCP has, and `config/servers.json` lists
  PROD, the MCP process *can* authenticate to PROD for read-only checks. To quarantine PROD from even AI
  reads, run a separate MCP instance against a config that does **not** list PROD — or rely on 6.1.
- **Effort:** Small (ops choice, not code).

---

## 7. Cube Map — full TI data flow

### 7.1 Show every TI process and its reads, not just writers of the focused cube

- **Status (Oct 2026): built, awaiting James's check.** Scanner returns `processes` (reads/writes/calls + code-order `steps`) and `tiReaders`; reads = `CellGetN/S` + cube-view datasource; `CubeProcessFeeders` counts as a write. Map: "All TI" toggle, dashed-blue read edges, "Read by (TI)" panel section. **Dims** toggle: only dimensions a process *changes* (catalog-derived — statements taking a `dimname`, excluding subset/view/cube calls, since temp-view subset scaffolding would link every process); dim→cube links only in focus mode; attribute reads deliberately not drawn. Name resolution now seeds from parameter defaults, follows `a = b;` chains and `var | 'lit'` concatenations (Rollover's `sDimension | '.Refresh Subsets'`). **Show playback built too** (clapperboard button): entry = chore or uncalled process; walks code-order `steps` depth-first into `ExecuteProcess` callees; highlights the step's nodes/edges (amber glow, animated edge) with a trail; reads of a rule cube also light its DB()/feeder edges. Limits: designed order, loops play once, not a replay — a real-run replay from the message log is a possible follow-up.

- **Why:** Found building FIN Consolidation (Sep 2026). The Cube Map only draws a process as a satellite
  of the *focused* cube, and only when it **writes** to it. A process's inputs are invisible:
  a posting process reads a journal cube and writes a data cube, but only the write edge
  shows. A large consolidation run will read ~4 cubes and write 1 — its flow would be
  mostly hidden. There's also no way to see all processes at once.
- **Fix:** In the `/api/cubemap/model` scanner (`server.js`), add **read** detection alongside writes:
  `CellGetN/S` (cube = 1st arg, literal or resolved `var = 'literal'`) and a process's cube-view
  **datasource** (`DataSource.dataSourceNameForServer` when `Type = 'TM1CubeView'`). Return
  `tiReaders` per cube. Frontend (`CubeMapEditor.jsx`): draw reads as a distinct edge
  (dashed, "TI reads from cube"), and add an **"All TI"** mode that shows every process node with all its
  read/write/call edges, not only the focused cube's writers.
- **Note:** writer detection was already extended (Sep 2026) to `CellIncrementN/S` and
  `ViewZeroOut`/`CubeClearData` — clear-and-rebuild processes were invisible before that.
- **Effort:** Medium.

---

## 8. Period Builder

### 8.1 `.Rollover` doesn't refresh the Rolling 3 / 6 / 12 consolidations

- **Why:** Rolling N children are set only by `.Build` (from `pCurrentPeriod`). `.Rollover` advances
  `Is Current Period` and rebuilds subsets, but the Rolling consolidations stay where Build left them,
  so they go stale month by month.
- **Fix:** Move the (now clear-then-populate) Rolling block into a shared routine that `.Rollover` also
  runs, or have `.Rollover` call it. Decide whether Rolling is anchored to the current period (forward)
  or trailing (backward) — current code rolls **forward** from the current period.
- **Effort:** Small.

### 8.2 Re-sync the `tm1_period_dimension` repo `.pro` files with the generator

- **Why:** That repo's README says its `ti/*.pro` files are exactly what the Period Builder generates.
  After the Sep 2026 fixes (FY/YTD/YTG/LTD reset before re-adding children; Rolling N cleared before
  re-populating) they no longer match.
- **Fix:** Regenerate the three processes from `client/src/components/PeriodBuilder/lib` and replace
  the repo's `.pro` files.
- **Effort:** Trivial.

---

## Done / intentionally skipped

- **1.1 — browser write-route session gate** — **reverted (Sep 2026)**. The hard 409-unless-a-change-set-is-open gate was shipped, then reversed: a session groups changes for deployment, it is not a login, and must never block a save from working. `TM1_REQUIRE_SESSION` now defaults to off (writes always succeed) — set `TM1_REQUIRE_SESSION=1` to opt back into the strict gate. The actual anonymous-edit gap this was meant to close is fixed properly instead, orthogonal to session state: every write always logs the real acting user (`req.user` browser-side, `AGENT_USER` for MCP) via `writeLog`'s new `user` parameter — including the save-collapsing path, which previously froze attribution on whoever started the session, even days later.
- **2.1 — `diffDimension` structural signature** — **done**. Now compares element `Name:Type` + edge `Parent>Child=Weight` token sets (same signature as `scopedSnapshot`), so re-parents, weight changes, and type flips report DRIFT instead of a false MATCH. Works against already-seeded baselines (they store raw elements + edges).
- **6.1 — MCP target allowlist** — **done**. `check_deploy_risk` / `check_target_drift` now refuse any `target` not in the bound `SERVER` ∪ `TM1_MCP_ALLOWED_TARGETS` (env) ∪ `config/servers.json` `mcpAllowTargets` — before any connection opens.
- **2.2 — line-level diffs in deploy review** — **done**. `diffRules`/`diffProcess` now attach an LCS `lineDiff` (added/removed lines, fallback to set-based for very large files) and surface it as "+N / −M lines" in the note, with sample lines rendered in the Deploy panel rows (`DeltaLine`).
- **1.2 — `user` column on `log_entries`** — **done**. Schema migration (auto-applied on boot) + `writeLog` stamps the active session's user; per-entry attribution shows in Object History.
- **1.3 — surface the 200-row `getObjectHistory` cap** — **done**. `getObjectHistory` now returns `{ entries, truncated }` (fetches 201 rows) and the panel shows an amber banner when history continues past the latest 200.
- **5.1 — save → CheckRules inline feedback** — **done**. `update_cube_rules` (MCP) now runs live TM1 `CheckRules` *before* writing and refuses with the actual compiler errors (line + message) unless `force:true`. Previously it only ran the static lint, so syntax that static lint missed surfaced only at deploy time. `check_rules_syntax` already did both checks without writing; the browser editor already has live CheckRules.
- **3.1 — two-baseline / release-window diff** — **done**. New `release-diff` CLI command: `npm run tm1deploy release-diff --server <name> [--from <file>] [--to <file>]`. Defaults to the baseline before HEAD → HEAD. Every `seed` now stamps `_meta.last_entry_id` (change-log position), so baselines are window markers; the command diffs the window's entries against the FROM baseline.
- **2.3 — leverage `before_state` in the diff** — **done**. `diffRules`/`diffProcess` now read the captured `before_state`/`after_state`: NEW objects carry `sessionBefore`/`sessionAfter` so a session-scoped A → B is available even with no baseline, and the NEW note distinguishes "new cube in this session".
- **3.2 — auto-suggest baseline cadence** — **done**. `diff` / `release-diff` / `package` warn when the HEAD baseline is stale (>14 days old or >50 change-log entries behind `getMaxEntryId`), with the re-seed command inline.
- **1.4 — retention / archive policy for `change_log.db`** — **done**. `npm run tm1deploy archive-log --server <name> [--days N] [--dry-run]` exports eligible entries to `config/archives/change-log/` before pruning, with a safety floor (never prunes below the oldest baseline's `last_entry_id`, never prunes entries tied to an open session). No silent auto-prune — opt-in only.
- **4.2 — per-server read-only / no-pull posture** — **done**. Mark a server browse-only via `config/servers.json` `"readOnlyServers": [...]` (or `"readOnly": true` on a connection/adminHost). `server.js` refuses every write route on it — model mutations (same set as the session gate), cell writes, process run/debug, chore execute/activate/deactivate/create, annotations, file upload/delete, user/maintenance admin, period-builder, SQL→TI, rollback — with a 409. `/api/servers` now returns `[{name, readOnly}]`; the StatusBar shows a lock badge and the server selector marks read-only servers.
- **1.4 — retention/archive policy for `change_log.db`** — **done**. New CLI command: `npm run tm1deploy archive-log --server <name> [--days <n>] [--dry-run]` (default retention: `$CHANGE_LOG_RETENTION_DAYS` or 365 days). Manual and opt-in only — nothing is ever pruned automatically. Export always happens before delete, and pruning never crosses the oldest baseline still on disk for that server (its `_meta.last_entry_id`) or touches a still-open session's entries, so a future release-window diff can never lose an entry it might need. `--dry-run` previews the count with zero footprint (no file written). Exports land in `config/archives/change-log/`, alongside the existing deploy-diff archives.
- **4.1 — cell-data capture on baseline** — **declined**. This is a Dev→Prod pipeline and Dev cell data is intentionally never promoted to Prod, so there's no recovery scenario a data-level baseline would serve. Structural-only baselines (dimensions, cubes, rules, processes, views, and dimension **attribute values** — metadata, not transactional data) remain correct by design; revisit only if a concrete recovery scenario for actual cube data emerges.
- CubeMap focus mode (click a cube to re-root the map around it) — **done**.
- Run-stats overlay on lineage — **skipped** (eye candy; devs read logs directly).
- Change-set collapse to first→last per object — **kept as-is** (intentional).
- Git file workflow — **skipped** (architecture choice; change-sets + baselines are the
  deploy discipline).

## Top three to do first

> **Updated Sep 2026** — 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 4.2, 5.1, and 6.1 are all **done**; 4.1 is declined by design. Remaining: **6.2** — ops choice (run a second, PROD-quarantined MCP instance), not code.


### Rules lint: commas inside area references counted as argument separators

- **Status: FIXED Oct 2 2026** — `core/rules-lint.js` `countArgs` now tracks `[ ]` / `{ }` depth; genuine wrong
  arg counts still caught. The client validator (`rules-validator.js`, AST-based) never had the bug. Needs an IDE
  server restart and a Claude Code restart (MCP) to load.

- **Found:** Oct 2026 building `PE Data` — `IF( cond, - ['Base Data', 'Amount'], 0 )` refused by build_cube /
  update_cube_rules static lint ("IF() expects 3 arguments, got 4"); TM1 itself accepts it.
- **Fix:** the arg splitter in the rules validator / `core/rules-lint.js` must treat `[ … ]` as a bracketed group
  (like parentheses and quotes) when counting top-level commas.

---

## 7. Capability candidates (generic, logged Oct 2026)

Standard OData/REST capabilities and common engineering patterns, logged as roadmap
candidates from first principles (no external implementation referenced).

### 7.1 Bulk REST folding via OData `$batch`

- **What:** Fold many TM1 REST calls into one `$batch` round-trip (rules for every cube,
  code for every process, metadata sweeps) for the MCP tools and the lens bridge; fall
  back per-request when a server lacks it. Batch is non-atomic — keep first pass replay-safe.
- **Effort:** Medium.

### 7.2 Unbound compile as a cheaper pre-save gate

- **What:** Validate TI code / cube rules via the server compile/check endpoints *without
  saving* — a fast review-time gate before the full save+validate path.
- **Effort:** Small.

### 7.3 Pre-write coordinate check (leaf + rule-overlap)

- **What:** Before any cell write (grid or lens input form), verify the target is an
  N-level element and flag rule/consolidation overlap — the silent no-op of writing to a
  calculated cell. The exact guard input forms need in Stage 3.
- **Effort:** Small.

### 7.4 Feeder audit (static heuristics + `}StatsByCube`)

- **What:** Whole-model scan for overfeeding (wildcard brackets, feeders into
  consolidations) plus runtime feeder-efficiency evidence where available.
- **Effort:** Medium.

### 7.5 Per-process `.pro` / git two-file round-trip

- **What:** Export any TI process to `.pro` or the diff-friendly git layout
  (`{name}.json` + `{name}.ti`) and re-import/bundle-install — individual-process
  version control, separate from full-model deploy packaging.
- **Effort:** Medium.

### 7.6 Confirm guards on destructive MCP tools

- **What:** `confirm` argument repeating the target name on every destructive MCP tool
  (delete/clear/execute/write).
- **Effort:** Trivial.

### 7.7 Model audit suite

- **What:** One-call bulk scans for naming-convention violations, TI/rule complexity
  (LOC, nesting, score), orphan dimensions, and v12-readiness gaps.
- **Effort:** Medium.

### 7.8 Chore dependency graph

- **What:** Downstream call graph for every chore task, surfaced in the cube map / chore
  editor — impact analysis before changing or deactivating a chore.
- **Effort:** Small–Medium.

### 7.9 Explicit v11/v12 REST version branches

- **What:** Central numeric-major version branching in the TM1 client (fields/endpoints
  that differ between 11.x and 12.x), replacing ad-hoc v12 handling.
- **Effort:** Medium.

### 7.10 Bulk source fetch for search & analysis

- **What:** Pull every process's code and every cube's rules in one sweep, then
  regex-search with caps — generalises the cube-map scanner's partial bulk read.
- **Effort:** Medium.

## 9. Documentation overhaul (logged Oct 2026)

### 9.1 Rewrite the IDE docs against the current code

- **What:** The docs predate most of what the IDE now is — deploy pipeline, MCP server
  (60 tools), function catalog rebuild, cube map / TI scanner, Lenses, TI regions,
  multi-user adapters. README, CLAUDE.md feature list and `docs/` need a rewrite, not a patch.
- **How:** First an audit — every doc checked against the code, with a list of what's stale,
  missing or wrong — approved before any rewriting starts.
- **Effort:** Medium–Large.

### 9.2 MCP `build_dimension`: Format values on a brand-new measure dimension fail (logged 4 Oct 2026)

- **Bug:** creating a new `… Measure` dimension with `attribute_values` for `Format` in the same call fails with
  "'}ElementAttributes_<dim>' can not be found" — the elements are created, the attribute (and its control cube) is not.
- **Workaround:** call again with `attributes: [{ name: "Format" }]` declared explicitly, then the values apply.
- **Fix:** create the `Format` attribute (and wait for its `}ElementAttributes_` cube) before writing values.

## 10. Deploy pipeline on TM1's built-in Git integration (logged 4 Oct 2026)

### 10.1 Move the deploy pipeline onto TM1's built-in Git integration — **DECIDED 5 Oct 2026: hybrid**

**Decision (after the lab evaluation — evidence in `docs/TM1_GIT_EVALUATION.md`):** the deploy pipeline moves to a
**hybrid**. **TM1 Git is the transport and history for object structure** (cubes, dimensions, processes, rules,
views, subsets — IBM's standard format, clean per-change git commits, customer-owned repo). The **IDE keeps** what
TM1 Git cannot do — **attribute values** (don't travel: check #5), **deletes** (don't propagate: check #6),
**drift** (the pull plan is a commit diff, not a live-state check: check #7), plus the **readiness check** (10.2)
and all **governance** (change sets, risk check, approval, assertions, Deploy Center, history UI).

- **What:** TM1 (Planning Analytics 2.0.7+ / TM1 11.4+, and v12) can push its own model to any git repository and pull it
  back with a preview ("plan") first — REST `GitInit`, push plan / pull plan, execute. Files are IBM's standard JSON per
  object (cubes incl. rules and views, dimensions incl. subsets, processes incl. TI); no cube data; `tm1project.json`
  controls scope.
- **Proposed shape:** the IDE keeps the governance (change sets, risk check, approval, assertions, Deploy Center,
  history UI); TM1's Git feature does the transport — the package becomes a git commit, the deploy becomes executing the
  pull plan (TM1 applies changes in its own order). The pull plan shows only the change **once the target has a
  baseline** (first pull on a never-pulled target is a full overwrite — there is no "adopt current state" action).
- **Why:** less of our own code doing the riskiest step (the first real deploy found 9 deployer bugs); a standard format
  understood by PAW / TM1py / community tools instead of our undocumented one; no lock-in for users (their models and
  history work without the IDE); aligned with v12. Adoption/marketing angle: "the IDE governs, TM1 itself deploys".
- **Evaluation results (TM1_Test_DEV → TM1_Test_PROD, 5 Oct):** ✅ connect/credentials (per-call token, not stored);
  ✅ repo layout readable/diffable, plain-text rules/TI; ✅ pull plan shows only the change after a baseline;
  ⚠️ object scoping (branch-scoped, object-granular; "branch per change set" untested); ❌ **attribute values don't
  travel**; ❌ **deletes don't propagate**; ❌ **drift not detected** (pull plan is a commit diff, not live-state).
  Also: GitPlans are ephemeral (create+execute atomically); a view with a member-less title breaks the pull (→ 10.2);
  `tm1project` Ignore only supports top-level objects.
- **Operational:** credentials are per-call (the IDE keeps the token, e.g. in `.env`); first pull on a populated target
  is a full overwrite — the IDE must warn and run a first-pull safety analysis (see 10.2); keep our own transport as a
  fallback for sites that block git from the TM1 server, and for the three gaps (values, deletes, drift).
- **Governance documents in git — DECIDED 5 Oct:** `tm1project Files` does not carry Application-managed documents
  (tests, change sets, deploy records, Lenses under `Applications/Governance/`). The IDE **mirrors** them into the
  model's repo — on push, commit `Applications/Governance` into a `governance/` folder; on deploy, write them to the
  target with a per-target rule (PROD gets health checks only, never test payloads). The server stays the runtime truth.

### 10.2 Git readiness check — must pass before any push (logged 5 Oct 2026)

- **Why:** TM1 tolerates stale references at runtime but its Git import does not. In the evaluation, one view whose
  title pointed at a deleted version member ("Working") exported with `Selected: null`, PROD's pull rejected it, and
  because a pull plan is all-or-nothing **one stale view blocked the whole deployment**. Every long-lived model collects
  leftovers like this, and `tm1project` Ignore can't exclude a single view (only whole cubes/dimensions/processes).
- **What it checks (each finding names the object, the reason and the fix):**
  1. View titles with no selected member (`Selected` null) — incl. ones saved by the IDE's member-less title bug
  2. Views and subsets that reference members which no longer exist (title/row/column members, static subset elements,
     MDX expressions naming missing members)
  3. Names TM1 Git is known not to round-trip (e.g. a comma in a subset name)
  4. Anything in `tm1project` Ignore — reported, so nobody is surprised it isn't deployed
- **Where it runs:** as a **BLOCKER in the deploy pipeline's risk check before every push**; on demand from a model
  health screen; and in a read-only scan across servers.
- **Drift through Git — DECIDED 5 Oct 2026 (evaluation check #8 passed):** before a deploy, PROD pushes its live state
  to its own branch (`prod-live`); `git diff <commit PROD last received>..prod-live` is the drift check — per object,
  readable, with a history of every check. **The IDE's baseline snapshots retire**; drift, deploy and history all run
  through git. Objects that exist only on PROD show up on every check until reconciled (brought into DEV/git, or removed
  from PROD) — that's intended. Attribute-value drift stays an IDE check (values don't travel). In real use PROD pushes
  with a **separate machine-user account and token limited to `prod-live`** (GitHub branch protection is per account).
- **First-pull safety analysis (populated targets):** TM1 Git has **no "adopt current state" / baseline action** — a
  site that already runs a model and switches to TM1 Git gets a **full overwrite on its first pull** (a never-pulled
  target plans an Update/Create for every object it manages). Before a first pull onto a populated target, the
  readiness check must additionally compare the target against the repo: which objects differ, anything that would be
  **deleted**, and **elements on the target missing from the repo** (those are removed, with their data). Only proceed
  when that analysis is clean.
- **Prevention at save time:** the IDE always sets a resolved `Selected` title member when saving a view, and warns when
  a view or subset being saved references a member that doesn't exist.
- **Also for the community guide (TM1 Git):** "clean up stale references before adopting TM1 Git".

