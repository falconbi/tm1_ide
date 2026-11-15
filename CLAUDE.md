# CLAUDE.md — TM1 IDE

This file tells Claude Code how to work in this repository.

---

## What This Project Is

A browser-based IDE for IBM Planning Analytics (TM1). It runs as a Node/Express server that proxies all TM1 REST API calls through PAW (Planning Analytics Workspace). The frontend is a React/Vite SPA served from `static/`.

Users open it in a browser, connect to a TM1 server, and edit rules, processes, dimensions, subsets, views, chores, and cube data — all without installing TM1 Architect or Perspectives.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js, Express |
| TM1 API | IBM OData REST API v1, proxied through PAW |
| Auth | PAW session cookie + CSRF header, managed by `core/paw_connect.js` |
| Frontend | React 19, Vite, TanStack Query, Zustand, Tailwind v4, shadcn/ui |
| Editor | Monaco Editor (`@monaco-editor/react`) |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) |
| SQL | better-sqlite3, mssql, mysql2, pg |

---

## Key Files

```
server.js                     # Express backend — all API routes
core/
  tm1_client.js               # TM1 REST client (all API calls go through here)
  paw_connect.js              # PAW session auth + CSRF caching
  adapter_registry.js         # Pluggable PAW connection adapter registry
  adapters/
    direct_v11.js             # Direct PAW V11 native auth adapter
    paw-native.js             # PAW-native session adapter
    paw-oauth2.js             # Authentik/OAuth2 adapter (PAW V12)
  sql_client.js               # External SQL connections (MSSQL/PG/MySQL/SQLite)
shared/pivot/                 # The shared pivot — one slice-and-dice grid for the IDE View editor and Lenses (docs/lenses/PIVOT_PLAN.md)
  tree.js / mdx.js / cellset.js / format.js / grid.js
client/src/
  App.jsx                     # Root layout, tab groups, global keyboard handlers
  store/                      # Zustand: tabs, groups, splitDirection, server, UI state
  hooks/useApi.js             # All TanStack Query hooks (useCubes, useRules, etc.)
  components/
    Explorer.jsx              # Left sidebar: object tree for all TM1 object types
    TabBar.jsx                # Tab bar — drag-to-reorder, right-click menu, split controls
    EditorPane.jsx            # Rules editor + cell trace + lineage + Check Now button
    ProcessEditor.jsx         # TI editor with debugger, snippets, error log viewer
    DimensionEditor.jsx       # Hierarchy tree + attribute grid
    SubsetEditor.jsx          # MDX + visual subset editor
    ViewEditor.jsx            # Native/MDX view builder + cell grid (PivotGrid → shared pivot), auto-refreshes on rules save
    PivotGrid.jsx             # React wrapper around shared/pivot/grid.js with the IDE toolbar + appearance
    CellContextMenu.jsx       # Right-click context menu for view grid cells (trace)
    GuidedMDXBuilder.jsx      # Guided MDX view and subset builders
    ChoreEditor.jsx           # Chore schedule + steps editor
    CubeEditor.jsx            # Cube structure editor
    SQLEditor.jsx             # External SQL query editor with schema browser
    DeployHistory.jsx         # Deploy history log viewer
    ShortcutsHelp.jsx         # F1 keyboard shortcut reference panel
  lib/
    tm1-completion.js         # Monaco autocomplete: cube/dim name context, TI/Rules function snippets
    tm1-functions.js          # Monaco language registration: syntax, completions, TI folding provider
    rules-validator.js        # Static analysis for Rules: arg counts, keyword validity, line-accurate squiggles
    ti-validator.js           # Static analysis for TI: section structure, IF/WHILE/FOR/NEXT tracking, arg counts
    mdx-validator.js          # MDX expression validator: function names, arg counts
    tm1-snippets.js           # TI and Rules snippet library
    ti-interpreter.js         # Client-side TI code execution simulator
    ti-debugger.js            # TI debugger — breakpoint injection + capture parsing
    formatters/               # TM1 rules formatter (tokenizer, AST, presets, settings)
config/
  servers.json                # TM1 server list { name, ... }
  forge.json                  # Workspace persistence (open tabs, server, splitDirection)
  sql-connections.json        # External SQL connection definitions
  sql-queries.json            # Saved SQL queries
static/                       # Built frontend (committed, served directly)
docs/                         # Architecture docs, Postman collection
tools/
  tm1mcp/                     # MCP server — exposes TM1 model + build/diagnostic tools to AI agents (see docs/ide/MCP_SERVER.md)
    server.js                 #   bootstrap only — build shared ctx, wire each tool group, connect
    shared.js                 #   shared context: SERVER/AGENT_USER, client(), ok(), logChange, runAssertions, requireChangeSet
    registry.js               #   registers every tool through the security wrapper: read/write classification, MCP_MODE=readonly skips writes, policy check, reader/builder identity, read audit
    guard.js                  #   pure rules: READ_TOOLS/WRITE_TOOLS, config/mcp-security.json policy, cell/attribute masking, TI password stripping
    identity.js               #   reader (TM1_MCP_READ_USER — TM1 security applies) vs builder (service login); fails closed, never falls back
    tools/                    #   the 65 tools, one file per subject: docs, introspect, changeset, assertions, deploy, build, develop, diagnostics, lenses
  tm1deploy/                  # Deploy pipeline CLI (diff / package / risk / execute)
```

---

## Build & Run

```bash
# Install (once)
npm install
cd client && npm install && cd ..

# Build frontend (required after any client change)
cd client && npm run build
# Vite writes straight into ../static (outDir) and the Lens kit into ../static/lens-kit.
# Do NOT copy from client/dist -- there is no dist step; an old dist folder is a stale build
# and copying it back over static/ silently reverts every change since (happened Nov 2026).

# Start server
npm start          # http://localhost:8083
```

Development with HMR:
```bash
npm start          # terminal 1 (backend on :8083)
cd client && npm run dev   # terminal 2 (Vite on :5173)
```

---

## Architecture Constraints

- **All TM1 calls go through `TM1Client`** — never call the TM1 REST API directly from a route. Add a method to `tm1_client.js` and call it from the route.
- **All API routes are in `server.js`** — no router files. Routes follow the pattern `app.METHOD('/api/noun/verb', async (req, res) => { try { ... } catch (e) { res.status(500).json({ error: e.message }) } })`.
- **Routes report failure with `fail(res, e)`** — the adapters normalise TM1 errors (`core/tm1-error.js`), so `e.message` is TM1's own text and `e.status` is the HTTP status. The only routes that return a result object containing `error` with HTTP 200 are the command-result routes `/api/period-builder/run` and `/api/deploy/git/prepare|execute|review`.
- **TM1 OData URL pattern**: `${PAW_HOST}/api/v0/tm1/{server}/api/v1/{path}`
- **No direct TM1 connections** — everything proxies through PAW. Server name comes from `config/servers.json`.
- **Frontend served from `static/`** — the built assets are committed. Always rebuild and copy after client changes.
- **CommonJS throughout** — `server.js` and `core/` use `require`/`module.exports`. Ignore VS Code's "convert to ES module" hints.

---

## TM1-Specific Conventions

### TI Variable Naming
All IDE-generated TI code must follow the `p/v/n/s/c` prefix convention:
- `p` — parameter (input)
- `v` — variable (local string)
- `n` — numeric variable
- `s` — server name variable
- `c` — cube name variable

### TM1 REST API Notes
- OData `$filter`, `$select`, `$expand` are passed as query params
- Control objects start with `}` — filter them client-side with `.filter(n => !n.startsWith('}'))` OR use `ModelCubes()` / `ModelDimensions()` endpoints
- Process save uses `PATCH /Processes('name')` for updates (not delete+recreate)
- Cell writes use `POST /Cubes('name')/tm1.Update` (single) or `tm1.UpdateCells` (bulk)
- Process execution uses `tm1.ExecuteWithReturn?$expand=ErrorLogFile` (returns timing + error log filename inline)

### Rules Language
- Language ID for Monaco: `tm1rules`
- Regions are `#Region name` / `#EndRegion` comments
- Feeders section follows calculation section, separated by `FEEDERS;`

### TI Language
- Language ID for Monaco: `tm1ti`
- Sections: Prolog, Metadata, Data, Epilog
- Comments use `#` not `//`

### TM1 Function Catalog — single source of truth (rebuilt Sep 2026)

**One JSON file drives everything**: `shared/tm1-function-catalog.json`. Every
consumer — client (ESM, via a `@shared` Vite alias) and server (CJS, via plain
`require`) — reads the same file. **Never hand-add a function name to any
consumer file directly.** Add it to the JSON, and every consumer picks it up
automatically.

**What used to be here, and why it isn't anymore:** before Sep 2026 this was
four independently hand-typed catalogs (`RULES_CATALOG`/`TI_CATALOG` in
`tm1-completion.js`, `TM1_FUNCTIONS` in `tm1-functions.js`, plus separate
hand-typed lists in `core/rules-lint.js`, `core/ti-lint.js`,
`ti-validator.js`'s `isBuiltInTM1Function`, `ti-interpreter.js`'s
`SIMULATED_FNS`, `tm1-snippets.js`, `formatters/naming.js`, and two regex
scanners in `core/tm1_client.js` — 17 hand-maintained lists across 14 files in
total). They drifted: two of them were even wired in as **competing, live
Monaco completion providers on the same editor** at once. Several contained
fabricated TM1 function names (`ETYPE`, `ElementConsolidationSet`,
`GetCurrentUser`, `SetOutputDir`, `ViewDelete`, `SubsetAddElement`, and more)
that were never checked against a real server. All of that was consolidated
into the one JSON file below, with every entry either carried over from a
verified-correct source or corrected against a **live TM1 server test**, not
guessed. See `feedback_reuse_not_silo` in project memory for the full story —
the short version is: before adding a new function-name list anywhere, check
whether `shared/tm1-function-catalog.json` already has (or should have) it.

#### Schema

`shared/tm1-function-catalog.json` is a flat object, one entry per function name (as TM1 spells it, e.g. `AttrInsert`, `DIMSIZ` — lookups are case-insensitive via `.toUpperCase()` at every call site):

```json
"ATTRINSERT": {
  "language": "ti",
  "params": ["dimname", "attribute", "attribute", "value"],
  "returnType": "void",
  "description": "Creates a dimension attribute after priorAttribute ...",
  "compat": "both",
  "deprecated": null,
  "isStatement": true
}
```

- `language` — `'rules'` | `'ti'` | `'both'`
- `params` — type tags: `cubename` | `dimname` | `element` | `attribute` | `subset` | `hiername` | `value` | `n` | `string` | `condition`. `*` suffix on the **last** tag = variadic (1-or-more repeats of that type). If the variadic tail is actually *optional* (e.g. `ExecuteProcess('Proc')` with zero param pairs is valid) add `"variadicMin": 1` to override the computed minimum — see `EXECUTEPROCESS`/`RUNPROCESS` for the pattern.
- `returnType` — `'numeric'` | `'string'` | `'void'` | `'any'`
- `description` — shown in hover tooltips and the Catalog Admin UI
- `compat` — `'both'` | `'v12'` (PA 2.0+/TM1 Database 12 only) | `'v11'` (classic only, removed in v12)
- `deprecated` — string shown as an amber squiggle, or `null`
- `isStatement` — `true` if it can't appear inside an expression (`CellPutN`, `AttrPutS`, `ProcessQuit`, etc.)

#### Consumers (all derive from the JSON — never edit these directly)

| Consumer | File | What it derives |
| --- | --- | --- |
| `RULES_CATALOG` / `TI_CATALOG` | `client/src/lib/tm1-completion.js` | Filters the JSON by `language`; drives completion, the bare-word snippet list, and signature help for both `tm1rules`/`tm1ti` |
| Monarch syntax highlighting | `client/src/lib/tm1-functions.js` | Builds the `tm1rules` function-name regex from `Object.keys(RULES_CATALOG)` at register time — every cataloged function gets highlighted, not a fixed ~10-name list |
| Hover | `client/src/lib/tm1-functions.js` | `catalogHover` reads `catalogEntry()` (below) directly — no separate fallback catalog |
| `core/rules-lint.js` / `core/ti-lint.js` | server-side, CJS | `require()` the JSON directly and compute each `SIG` arity table (`{min, max}`) from `params.length` + the variadic/`variadicMin` rule — not hand-transcribed |
| `isBuiltInTM1Function` | `client/src/lib/ti-validator.js` | `Object.prototype.hasOwnProperty.call(TI_CATALOG, name.toUpperCase())` — no separate allowlist |
| `SIMULATED_FNS` | `client/src/lib/ti-interpreter.js` | Hand-written JS implementations (can't be derived — it's *behavior*, not metadata) but every key must correspond to a real catalog entry; don't add a simulated function that isn't in the catalog |
| Snippets | `client/src/lib/tm1-snippets.js` | Hand-curated (nicer placeholder names than a generic builder), but every function name/arity used in a snippet body must match the catalog |
| Casing dictionary | `client/src/lib/formatters/naming.js` | Independent list (controls capitalization, not validation) — should agree with the catalog's real names, checked periodically, not auto-derived (different purpose: casing preference, not existence) |

`config/function-catalog-overrides.json` + `client/src/lib/catalog-runtime.js` still provide the **user-editable override layer** on top of `RULES_CATALOG`/`TI_CATALOG` (additions/overrides/deletions persisted via Catalog Admin) — unchanged by this rebuild. It does not yet reach the other consumers in the table above (a known, pre-existing gap, not introduced by this rebuild).

#### Keeping it correct: automated live validation

**Never add a function to the catalog from memory alone if it can be checked.** `tools/validate-catalog.js` is the automated drift-check:

```bash
node tools/validate-catalog.js --server <name> --language ti
```

It builds a minimal syntactically-plausible call for every TI-usable catalog entry, tries to save it as a throwaway TI process (TM1 compiles on save, so a bad function name or arg count fails immediately), and deletes the temp process either way. Run it after editing the catalog, after pointing the IDE at a new TM1 version, or periodically to catch drift. It only reports — you still decide what to change in the JSON based on what the real error says. Rules-function validation isn't automated this way (it needs a real cube + real dimension/element names to build a testable area rule) — use Catalog Admin's Rules tab for that.

`client/src/components/CatalogAdmin.jsx` (book icon in the app header) is the interactive version — Validate button per tab, same underlying approach, `POST /api/admin/validate-ti-functions` (note: this route creates the temp process with `MetadataProcedure` — lowercase `d` — matching TM1's real OData property name; the capitalization is easy to get wrong and silently breaks every single test with a generic "Unknown Process property" error, which is exactly what happened here before this rebuild caught it).

---

## UI / Styling Conventions

- **Tailwind v4** with shadcn/ui components — use `cn()` from `@/lib/utils` for conditional classes
- **Dark/light theme** — `dark` boolean comes from `useStore()`. Monaco theme registered via `registerTM1Theme(monaco, dark)`
- **Color palette**: monochrome base. Accent colors by context:
  - Green (`bg-emerald-700`) — Run/Execute buttons
  - Amber — warnings, error log viewer
  - Red — errors, destructive actions
  - Primary (theme-aware) — active/selected state
- **Monaco widgets** — always set `fixedOverflowWidgets: true` on every MonacoEditor instance
- **z-index for Monaco overlays** — overridden in `index.css` to `z-index: 2000+` for find widget, hover tooltips, context menus

---

## State Management

Zustand store (`client/src/store/`) holds:
- `tabs` — array of open tab objects `{ id, type, label, server, dirty, content, ... }`
- `groups` — tab groups for split-pane layout `[{ id, tabIds, activeTabId }]`
- `activeGroupId` — which group receives keyboard focus and new tabs
- `splitDirection` — `'horizontal'` (side-by-side) | `'vertical'` (stacked) — persisted in forge.json
- `server` — active server name
- `dark` — theme
- `subsetVersions` — `{ 'server::dim': n }` — bumped on subset save; SubsetEditor watches for refresh
- `rulesVersions` — `{ 'server::cube': n }` — bumped on rules save; ViewEditor watches and re-executes automatically

TanStack Query handles all server state — data fetching, caching, mutations. Cache keys always include `server` as the first key segment.

---

## Adding a New Editor Type

1. Create `client/src/components/MyEditor.jsx`
2. Add to the dispatcher in `EditorPane.jsx` or `App.jsx`
3. Add a tab type to `openTab` calls in `Explorer.jsx`
4. Add API routes to `server.js` (and methods to `tm1_client.js` if needed)
5. Add hooks to `hooks/useApi.js`
6. Add to the `getRevealTarget` function in `EditorPane.jsx` if it has a "show in tree" target

---

## Completed Features (as of Jun 2026)

- Explorer: cubes, dimensions, subsets, processes, chores, views, rules — full CRUD
- Rules Editor: Monaco + syntax highlight + live validation (CheckRules API) + static validator (arg counts, keyword validity, line-accurate squiggles) + **Check Now** button with pass/fail glow + lineage trace + cell calculation trace panel + code formatter + **#Region/#EndRegion folding** + snippets
- TI Editor: Monaco + 4-section tabs + parameter editor + datasource editor + run + debugger + error log viewer + snippets + static validator (section structure, IF/WHILE/FOR/NEXT block tracking, arg counts) + **IF/WHILE/FOR block folding**
- Dimension Editor: hierarchy tree + attribute grid + element/edge CRUD + bulk import
- Subset Editor: MDX code view + visual tree + static/MDX save + MDX preview
- View Editor: native + MDX view builder + cell grid with writeback + **auto-refresh when rules for the same cube are saved** + **cell right-click context menu** (rule trace)
- Guided MDX Builder: axis builder, subset filter, MDX execution
- Chore Editor: schedule + steps + activate/deactivate + execute
- Cube Editor: create/delete cubes
- SQL Editor: multi-driver connections + schema browser + query save + post-to-TI
- MDX Sandbox: ad-hoc MDX execution with result grid
- Global Search: cross-object search across rules + TI code
- Period Builder: generates TI processes for period dimension maintenance
- Autocomplete: cube name, dimension name, element context in Rules (DB, ATTRS) and TI (CellPutN, DimensionElement*, etc.)
- Tab system: drag-to-reorder within group + right-click context menu (Split Right, Split Down, Move to other pane, Close others, Close to right, Close) + arrow button on hover to send tab to other pane
- Split panes: horizontal (side-by-side) and vertical (stacked) layouts — toggle without closing panes — direction persisted in forge.json
- Multi-user login: per-user PAW sessions, pluggable adapter registry (direct_v11, paw-native, paw-oauth2)
- Deploy pipeline: Change Set tracking → diff vs Prod baseline → package → risk check → deploy; browser UI + CLI
- Deploy History: archive log of past deployments

---

## IBM TM1 REST API Reference

The Postman collection at `docs/ide/Planning Analytics.postman_collection.json` is the authoritative endpoint reference. The `TM1Client` in `core/tm1_client.js` covers all commonly used endpoints. Key endpoint groups: Dimensions, Cubes, Processes, Chores, Views/MDX, Subsets, Transactions, Jobs, ErrorLogFiles, Metrics, Configuration.

---

## Validator Architecture Notes

### Rules validator (`rules-validator.js`)

- Uses `parseLogicalUnits()` from `formatters/tm1-structured.js` — joins multi-line physical lines into logical statements terminated by `;`. Each unit carries a `startLine` (1-indexed) used for squiggle placement.
- `\` (integer division) must be tokenised as an `operator` not `unknown` — see `SINGLE_CHAR_OPS` in `formatters/tokenizer.js`. If it becomes `unknown`, the expression parser consumes it speculatively and miscounts arguments (e.g. reports "IF expects 3 args, got 4").
- `ELSEIF` / `ELSE` / `ENDIF` are TI block keywords, **not valid in Rules**. The validator explicitly rejects them with a message pointing to the function-style `IF(condition, trueVal, falseVal)` syntax.
- Line numbers: always use `unit.startLine` (the logical statement's physical start line), never recompute from token `.pos` (which is relative to the joined statement string).

### TI validator (`ti-validator.js`)

- Block structure checker tracks IF/WHILE/FOR on a stack; ENDIF/END/NEXT pop and emit ranges. Unmatched opens/closes are reported by section.
- `isBuiltInTM1Function()` is a hardcoded allowlist that suppresses "unknown function" warnings for TM1 statements (`ItemReject`, `ItemSkip`, `FOR`, `NEXT`, etc.) that look like function calls but aren't in any catalog.
- `ItemReject` and `ItemSkip` are **statements**, not functions — write `ItemReject;` without parentheses.

### Code folding

- Rules `#Region name` / `#EndRegion` folding is handled by the Monarch `foldingMarkers` registered in `tm1-functions.js`. Requires `folding: true`, `foldingStrategy: 'auto'`, `glyphMargin: true` on the Monaco editor instance.
- TI IF/WHILE/FOR block folding uses a `registerFoldingRangeProvider` for `tm1ti` in `tm1-functions.js` (stack-based, line-pair ranges). Same options required on the ProcessEditor Monaco instance.

---

## ViewEditor: Critical Bugs Found & Fixed (Jun 2026)

Three interrelated bugs caused saved native view member selections to revert on reload:

### 1. TM1 API returns `Subset.Name=""` not `null`
When `$expand=Subset` is used on a placement collection (e.g. `Views('name')/Rows?$expand=Subset`), TM1 returns `{ Subset: { Name: "", Expression: "...", ... } }` for inline subsets. The `Name` is an **empty string** `""`, not `null`. All checks using `p.Subset?.Name == null` fail — must use `!p.Subset?.Name` (falsy check) instead.
- **Fix**: `core/tm1_client.js` `getSubset()` — changed `p.Subset?.Name == null` to `!p.Subset?.Name`
- **Also fixed**: `server.js` `extractAxis()` — same pattern

### 2. TM1SubsetAll() needs `memberSet: 'all'` not `members: null`
When a dimension is set to "All" members, TM1 saves the Expression as `TM1SubsetAll([Dim].[Hier])`. The `_extractMembersFromExpression` correctly returns `null` for this (doesn't start with `{`), but the display logic in `DimPill` checks `memberSet` before `members`. Without `memberSet: 'all'`, the label shows "Members" instead of "All".
- **Fix**: `core/tm1_client.js` `getSubset()` — detect `/^TM1SubsetAll\(/i` and set `memberSet: 'all'`
- **Fix**: `server.js` `extractAxis()` — same detection
- **Fix**: `server.js` `dimInfo` and `nativeConfig` construction — pass `memberSet` through
- **Fix**: `client/src/components/ViewEditor.jsx` `make()` — accept `memberSet` parameter

### 3. SubsetPopover calls `onMemberSelect(null)` after `onSubsetSelect(name)`
In `SubsetPopover` (line 498), clicking a named subset called both `onSubsetSelect(s.Name)` and `onMemberSelect(null)`. Since `setMember` clears `subset`, the subset selection was immediately overwritten.
- **Fix**: `client/src/components/ViewEditor.jsx` line 498 — removed `; onMemberSelect(null)` from the onClick handler

---

## CellContextMenu — View Grid Right-Click (Jun 2026)

`client/src/components/CellContextMenu.jsx` — fixed-position popup triggered by AG Grid's `onCellContextMenu` in `ViewEditor.jsx` and `HierarchyGrid.jsx`.

### How the intersection is built

`handleCellContextMenu` in `ViewEditor.jsx` assembles a `dimElemPairs` array from the AG Grid event:

- **Row coordinates** — `e.data.__tupleKey__` (`::`-joined) split and zipped with `axes.rows`
- **Column coordinates** — `hierarchyData.columns.find(c => c.id === colId).members` zipped with `axes.columns`
- **Page/title coordinates** — `axes.pages` filtered to placed members
- `cubeDims.map(d => coordMap.get(d))` puts all dims in TM1 cube-order for API calls

`isAllLeaf` is derived from `e.data.__d${i}_isLeaf__` flags set by `HierarchyGrid` — Write tab only shown for fully-leaf intersections.

### Panel breakdown

| Tab | Endpoint | Purpose |
| --- | -------- | ------- |
| Write | `POST /api/cells/write` | Inline value write; `dims` = `dimElemPairs`; triggers `handleExecute()` on success |
| Trace | `POST /api/cube/trace` | Rule chain — shows `Type` badge (RULE/CONSOLIDATED/BASE/FEEDER), rule statements, component breakdown |
| Log | `GET /api/transactions?elements=JSON` | Transaction history filtered to this intersection (top 30) |
| Copy | clipboard | Writes `dim: element` pairs + MDX tuple `([Dim].[Dim].[Elem], ...)` |
| Rules | `openTab()` | Opens rules editor tab for the cube (`type: 'rules'`) |

### `.badge` utility class

Added to `client/src/index.css` — `display:inline-flex`, `padding:1px 5px`, `border-radius:3px`, `font-size:10px`. Used by `TypeBadge` inside `CellContextMenu` and its sub-panels. Color applied via Tailwind bg/text classes per cell type.

---

### Placement-level `$expand=Subset` is the reliable approach
The `$expand=Subset` on individual placement collections (`Rows?$expand=Subset`, `Columns?$expand=Subset`, `Titles?$expand=Subset`) works in this TM1 version, while `$expand=Rows,Columns,Titles` on the view entity returns empty objects `{}` for each placement. The fallback chain:
1. `Views('name')/Rows?$expand=Subset` (placement collection — **this works**)
2. `Views('name')?$expand=Rows,Columns,Titles` (direct entity — fails silently, empty rows)
3. Collection-based expand — also fails
4. Separate placement fetches without expand — minimal data

The placement collections do **not** carry the view-level `SuppressEmptyRows` / `SuppressEmptyColumns` flags — `getViewWithSubsets` fetches the base `Views('name')` entity as a 4th parallel call to pick those up.

### A named-subset axis never reports its own dimension (Sep 2026)

A view placement bound to a **named subset** never carries its parent dimension in the API response — and if that named subset is **static** (an explicit element list, no MDX Expression), there's no Expression to parse a dimension out of either. Every consumer of `getViewWithSubsets` used to see `dimension: null` for these axes.

This silently corrupted anything that stored the result: a **baseline seeded** while a view had such an axis recorded `dim: null` forever, and every later drift check compared that `null` against a freshly-read (and correctly resolved, if the read happened to hit a different fallback path) dimension — a permanent false-positive drift ("Rows dimensions changed: `[]` → `[RealDim]`") with nothing actually different on the target. This is the same underlying defect that once cost `Cost by Cost Centre` its column subset during packaging.

Fixed at the source: `getViewWithSubsets` (`core/tm1_client.js`) now resolves any axis with a `subset` but no `dimension` itself — scan the cube's dimensions for one that owns a subset by that name (`getSubset(dim, name)`), cached per subset name within the call. Every caller (baseline seeding, drift check, packager, MCP `get_view`, the IDE's `/api/view/axes`) gets the fix for free; `packager.js`'s old per-call backfill (the same algorithm, done locally) was removed as redundant.

**A baseline seeded before this fix still has the bad `dim: null` recorded** and will keep reporting false drift on that view until re-seeded — this is exactly the "baseline is out of sync, force it back" recovery case the Deploy Center's Baselines view exists for.

### Suppress-empty and totals-position persistence (Sep 2026)

ViewEditor toolbar had three toggles — suppress empty (`suppressZeros`: none/rows/columns/all), row-totals position, col-totals position — that were pure client `useState`, never saved, so they reset on every reopen.

- **Suppress empty** *is* a real native-view property. It now round-trips: `buildSavePayload` → `nativeAxes.suppressEmptyRows/Columns` → `/api/view/save` → `saveNativeView` writes `SuppressEmptyRows` / `SuppressEmptyColumns` in the POST body. Load path reads them back via `getViewWithSubsets` → `/api/view/axes` `nativeConfig` → `setSuppressZeros`. The grid re-suppresses through the existing client-side `cellsetToHierarchyData` memo — no re-execute. Also threaded through the deploy pipeline (packager `fetchView`, `deployView`).
- **Totals position** has no classic native-view equivalent (it's grid presentation). Persisted per-user to `localStorage` key `tm1-viewprefs:${server}::${cube}::${view}`, not to the TM1 view.

## React Flow (`@xyflow/react`): never derive nodes from `nodes` state itself (Sep 2026)

`CubeMapEditor.jsx` added satellite "process" nodes (TI writers + callers, shown only when a cube is focused) via a `useMemo` that read cube positions from the `nodes` state and rebuilt the process nodes from scratch on every recompute. This caused a genuine infinite render loop — not a performance nit, the browser console filled continuously:

1. Freshly-built node objects have no `measured` field (React Flow's own record of a node's rendered width/height, added internally once it measures the DOM element via `ResizeObserver`).
2. React Flow sees an unmeasured node, measures it, and reports the result through `onNodesChange` (a `dimensions` change) — which `useNodesState`'s handler applies by calling `setNodes` with a new array.
3. `nodes` reference changes → the `useMemo` (which depends on `nodes`) recomputes → it rebuilds the *same* process nodes as brand-new plain objects with no `measured` field again → back to step 1, forever.

Existing cube nodes never had this problem because they're built once by a `useEffect` and then live in the same `useNodesState`-managed array `onNodesChange` writes back into — so `measured` persists across renders and React Flow stops re-measuring once stable.

**Fix**: never keep node/edge data that React Flow renders in a plain derived `useMemo` computed from the `nodes` state. Merge it into the actual managed state instead, via `setNodes(prev => ...)` (functional update, so `nodes` doesn't need to be a dependency at all — read current positions from `prev`), and remove it the same way when it's no longer relevant. This lets `measured` (and any other React-Flow-owned fields) persist across renders like it does for every other node.

**How to spot it early**: if a `useMemo`/`useEffect` in a React Flow component depends on `nodes` (or `edges`) and *also* constructs brand-new node/edge objects from scratch every time (rather than reading/updating existing ones), that's the shape of this bug — even if it looks fine on first render, it will spin continuously the moment React Flow measures anything unmeasured inside it.
