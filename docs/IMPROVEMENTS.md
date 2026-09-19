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

### 1.4 Retention / archive policy for `change_log.db`

- **Why:** The SQLite DB only grows; there is no snapshot, archive, or prune story.
- **Fix:** Decide a policy (archive to `config/archives/` on session close, or prune old
  entries with an audit export).
- **Effort:** Small–medium.

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

### 4.1 Cell-data capture option on baseline

- **Why:** The one thing neither baselines nor a Git repo recover. Baselines are a
  structural snapshot; only picklist cells are captured
  (`tools/tm1deploy/src/snapshot.js:394`).
- **Fix:** Optional data-level capture (split structural vs data baselines).
- **Effort:** Medium–large.

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

## Done / intentionally skipped

- **1.1 — browser write-route session gate** — **done**. `server.js` now hard-gates all 22 logged model-mutation routes (plus edge add/weight and view set-default) with `gateSession()` — a 409 unless a change set is open for that server. Toggleable via `TM1_REQUIRE_SESSION=0` to revert to the old nudge-but-proceed behaviour. Same rule MCP already enforces via `requireChangeSet`.
- **2.1 — `diffDimension` structural signature** — **done**. Now compares element `Name:Type` + edge `Parent>Child=Weight` token sets (same signature as `scopedSnapshot`), so re-parents, weight changes, and type flips report DRIFT instead of a false MATCH. Works against already-seeded baselines (they store raw elements + edges).
- **6.1 — MCP target allowlist** — **done**. `check_deploy_risk` / `check_target_drift` now refuse any `target` not in the bound `SERVER` ∪ `TM1_MCP_ALLOWED_TARGETS` (env) ∪ `config/servers.json` `mcpAllowTargets` — before any connection opens.
- CubeMap focus mode (click a cube to re-root the map around it) — **done**.
- Run-stats overlay on lineage — **skipped** (eye candy; devs read logs directly).
- Change-set collapse to first→last per object — **kept as-is** (intentional).
- Git file workflow — **skipped** (architecture choice; change-sets + baselines are the
  deploy discipline).

## Top three to do first

1. **1.1** — audit attribution gate (closes the anonymous-edit gap).
2. **2.1** — dimension diff correctness (silently wrong today).
3. **2.2** — line-level diffs in review (the difference between a verdict and a picture).

> **Also flagged (needs doing):** **6.1** — MCP target allowlist gate so the AI's check tools can't
> open read connections to PROD. Small effort, high security value.