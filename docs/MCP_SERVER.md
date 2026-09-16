# tm1mcp — MCP Server for AI Agents

`tools/tm1mcp/` is a [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes the TM1 model and a full set of build/diagnostic tools to any MCP-capable AI
client (Claude Desktop, Claude Code, Cursor, Cline, …). `server.js` is just the bootstrap
(shared context + wiring); the 60 tools themselves live in `shared.js` (common helpers) and
`tools/*.js`, one file per subject — `docs`, `introspect`, `changeset`, `assertions`,
`deploy`, `build`, `develop`, `diagnostics`.

It is **provider-neutral** — MCP is an open protocol; the server has no dependency on any
particular model.

**Building a model from a requirements doc?** Read [`BUILDING_MODELS.md`](BUILDING_MODELS.md)
first (or call the `read_build_guide` tool) — it's the method; this file is the reference.

> ⚠️ **Status: early, needs more real-world testing.** The change-set gating and deploy-pipeline
> integration below are the intended safety net, but the tool surface (60 tools) hasn't seen
> heavy production use yet — treat it as a working build, not a hardened one.
>
> **Security note on external LLMs:** any MCP client you point at this server — including a
> third-party/external LLM, not just Claude — gets real tool access to write to your TM1 model
> (dimensions, cubes, rules, processes, cells) inside whatever change set is active, and the
> `deploy` tools can read from and check drift against a live target server (e.g. Prod). Only
> connect MCP clients and models you trust with that level of access, keep build work inside a
> named change set (never against Release scope) so everything is diffed before it ships, and
> review what an agent proposes before approving or deploying it.

---

## What's been tested (and what's still open)

The MCP is the layer used to build the **Workforce Planning (WFP) model** end-to-end —
see [`WORKFORCE_MODEL_PLAN.md`](WORKFORCE_MODEL_PLAN.md). That is the current real-world
evidence, and it's still early.

**Tested — a full model built through the external LLM:**
- A blank test server (no dimensions, no TI library) built by conversation with an external
  LLM over this MCP server — spec agreed interactively, replayed as requirements, then built
  in **six iterative phases**, each building on the last.
- Dimensions, cubes, rules, processes, subsets and views all created through the tools,
  change-set gated throughout.
- The build was verified against **expected results** (see `config/assertions.json`) — the
  "does it compute the right number" layer on top of TM1's own rule checker.
- Standards and conventions were taught to the LLM *during* the build; those conventions are
  now codified in the lints (`core/rules-lint.js`, `core/ti-lint.js`) and
  [`BUILDING_MODELS.md`](BUILDING_MODELS.md).
- The IDE and the MCP write through the **same client and change log** — the agent's work
  flows through `diff → package → risk → deploy` exactly like hand-built changes.

**Still open / not yet hardened:**
- The tool surface (~60 operations) has not seen heavy production use — a second model is the
  next test.
- **Security is the open question.** The MCP authenticates as the server's configured
  identity (not a specific logged-in user), and access is gated by the change set rather than
  fine-grained per-action permissions. What the agent may read, whose permissions apply, and
  how every change is reviewed are being worked through — read-only mode, scoping, and
  data-redaction are planned (the reads are the current gap; the writes are change-set gated).
- Redaction of sensitive data before it leaves the MCP (cell values, process code, attributes)
  is not yet implemented.

---

## Running it

```bash
# one server, by name from config/servers.json
node tools/tm1mcp/server.js --server 24Retail

# or via env var
TM1_MCP_SERVER=24Retail node tools/tm1mcp/server.js

# register with Claude Code
claude mcp add tm1 -- node /abs/path/tools/tm1mcp/server.js --server 24Retail
```

Auth: same as the IDE with no logged-in user — it uses the `makeClient(server, null)` path,
so it authenticates with the adapter's fallback credentials from `config/servers.json`.

---

## The change-set workflow (important)

**Every metadata write requires an open change set.** This is the deployment-workflow gate:
the agent's work is captured exactly like a change made in the IDE, so it flows through
`diff → package → risk → deploy` unchanged.

```
seed_baseline           → snapshot the server as its deploy baseline (do this FIRST,
                          so the diff shows only what the agent builds, not older drift)
                          Baselines are per-server — .tm1baseline/<server>.json — so
                          several Dev→Prod loops run without colliding.
start_change_set        → open a labelled change set ("AI: <model name>")
  build_dimension …     ┐
  build_cube …          ├─ each write logged to change_log.db against the open set
  build_process …       ┘
get_change_set          → review what's been recorded
diff_change_set         → diff vs the deployment baseline
close_change_set        → done
package_change_set      → build the deployable folder under packages/ (add release:true
                          for every object changed since the baseline, not just this set)
check_deploy_risk       → risk analysis of the package against a target (read-only)
check_target_drift      → has the target moved from the baseline? (read-only)
                        → deploy itself is a human step in the IDE Deploy panel
```

Writes attempted with no open change set are refused with a clear message.
`read_*`, `run_process`, `check_rules_syntax`, all diagnostics, and the
`package_change_set` / `check_*` deploy tools do **not** need a change set.

**The agent prepares and checks; a human approves the push.** `package_change_set`
and the two `check_*` tools cover diff → package → risk → drift — the tedious 90%,
including the fix loop (risk flags a bad rule → fix it → re-package → re-check).
There is deliberately no `deploy_execute` tool: the actual write to a target goes
through a person in the IDE (Deploy panel, or Import Package on another machine).

Change sets are stored in `change_log.db` (shared with the IDE), attributed to user
`ai-agent`. Because `getActiveSession` is keyed by server (not user), give the agent its own
sandbox server so a human editing the same server doesn't land changes in the agent's set.

---

## Static rule lint (`core/rules-lint.js`)

TM1's own `tm1.CheckRules` confirms a rule *parses* — it does **not** catch a valid-looking
call made with the wrong argument count. That gap cost real iterations in the first build:
`ElementAttrN('Dim', !Dim, 'attr')` (3 args) passes `CheckRules`, but the engine binds the
element name into the *hierarchy* slot and the rule silently returns blank.

`core/rules-lint.js` is a CJS lint that catches that class of mistake before the rule is
written. It runs a single-pass scanner (string- and comment-aware) and reports:

| | |
|---|---|
| **errors** | a known rules function called with the wrong number of arguments — e.g. `ELEMENTATTRN`/`ELEMENTATTRS` with 3 args instead of 4 (with a note to use `ATTRN`/`ATTRS` for a single-hierarchy dimension) |
| **warnings** | `IF` nested more than 2 deep (some TM1 engine versions return blank past 2) |

Wired into three tools:

- **`check_rules_syntax`** — runs the lint **and** the server `CheckRules`; returns
  `static_errors` / `static_warnings` / `tm1_errors` separately.
- **`update_cube_rules`** — lint errors **block the write**. `force: true` overrides.
  Warnings are reported but don't block.
- **`build_cube`** — lint errors on the `rules` param **abort the whole call** (the cube is
  not created). `force: true` overrides.

Arg counts are transcribed from `RULES_CATALOG` in `client/src/lib/tm1-completion.js` — keep
them in step. The Monaco editor's own validator (`client/src/lib/rules-validator.js`) already
does the same check in the IDE; this is the equivalent for the MCP path.

**Known catalog inaccuracy (not fixed):** `ELEMENTATTRN`/`ELEMENTATTRS` (and the other
`ELEMENT*` hierarchy functions) are flagged `compat: 'v12'` in the catalog, but hierarchy
functions shipped in PA 2.0 / TM1 Server 11.0. The flag is currently inert — the validator
defines `compat` but never checks it — so this has no runtime effect. If `compat` checking is
ever wired up against the connected server version, these should move to a `v11+hierarchies`
tier, not `v12`.

---

## Static TI lint (`core/ti-lint.js`)

TM1 compiles a TI process on save but is lenient about things that then fail at run time —
the error lands in the process error log, not the save response. `core/ti-lint.js` catches
the two that cost iterations in the first build:

| | |
|---|---|
| **errors** (block the write) | wrong argument count on a common TI function — e.g. `AttrInsert` with 3 args (it is 4: `dimension, priorAttribute, name, type` — the IDE catalog has this wrong), `CellPutN` with fewer than 3, 3-arg `ElementAttrN`/`ElementAttrS` |
| **warnings** (reported, don't block) | Prolog inserts an element then writes an attribute on it in the same section (the insert isn't committed until the Prolog ends → "element not found" at run time — move attribute writes to the Epilog); `//` used as a comment (TI uses `#`) |

Signatures are **hand-built from actual TI behaviour, not from `TI_CATALOG`** — that catalog
has errors. Wired into `build_process` (errors abort, process not written) and `update_process`
(lints the full *merged* process; errors block). `force: true` overrides on both.

---

## Feeder checks

The rules lint also flags one feeder trap: a `DB()` feeder whose target element comes from an
attribute read (`=> DB(cube, …, ATTRS('Dim', !Dim, 'attr'), …)`). If the attribute is blank
for any source element, the feeder writes to a non-existent element and fails at load — give
unmatched elements a sentinel value instead of blank.

`check_feeders` (recalculate feeder propagation — run after writing feeders) and
`trace_feeders` (which cells feed an intersection; empty = under-fed) use REST endpoints that
exist only on newer PA — they degrade with a clear message on servers that lack them.

---

## Model assertions (`core/assertions.js`)

The rules lint checks that a rule is *written* correctly. Assertions check that the model
*computes* the right numbers — the value layer.

An assertion is an MDX query plus the number it should return. `run_assertions` executes each,
**sums the returned cells**, and compares to `expected` within an absolute `tolerance`
(default 0.01). Stored as `config/assertions.json`, keyed by server, plain JSON so it can be
hand-edited and version-controlled as part of the model spec.

| Tool | |
|---|---|
| `add_assertion` | `{ description, mdx, expected, tolerance?, tags? }` — stores it and runs it once so you know the query and value are right |
| `list_assertions` | the stored set for this server |
| `remove_assertion` | delete by id |
| `run_assertions` | run all (or `{ tags: [...] }` for a subset) — returns `{ total, passed, failed[] }` with `expected` / `actual` / `diff` per failure |

**`close_change_set` runs the assertions automatically** if any are stored, and reports
`Assertions: N/M passing` plus the failing descriptions. It does not block the close — a
failing assertion during a WIP build is legitimate — but the failure is loud.

Typical use: after the design is settled, `add_assertion` for each invariant ("pool clears:
total DR = pool", "fully-loaded total = direct total", "allocation accounts net to zero").
From then on every build is checked against them. The expected values come from you or a
worked example (e.g. an Excel); the tool just enforces them.

---

## Tool catalog (57)

### Orientation
| Tool | Purpose |
|---|---|
| `read_build_guide` | returns `BUILDING_MODELS.md` — call first when building a model |

### Read — model context
| Tool | Purpose |
|---|---|
| `list_cubes` / `list_dimensions` / `list_processes` / `list_views` / `list_subsets` / `list_chores` | enumerate model objects |
| `get_cube_rules` / `get_cube_dimensions` | cube detail |
| `get_elements` | dimension elements (+ `include_tree` for parents/children) |
| `get_element_attributes` | attribute definitions (+ values for one element) |
| `get_process` | all 4 sections + params + datasource |
| `get_view` | MDX text, or resolved native row/col/title placements |
| `get_subset` | MDX expression or static element list |
| `get_chore` | steps + schedule |
| `find_cubes_using_dimension` | quick impact list |

### Change set
| Tool | Purpose |
|---|---|
| `seed_baseline` | snapshot server state as the deploy baseline — run before a build |
| `start_change_set` | open — **call first** |
| `close_change_set` | close when the build is done |
| `get_change_set` | list recorded object changes |
| `diff_change_set` | diff vs deployment baseline |

### Deploy — prepare & check (no change set / no writes to target)
| Tool | Purpose |
|---|---|
| `package_change_set` | build the deployable folder under `packages/` (`release:true` = everything since baseline) |
| `check_deploy_risk` | risk analysis of a package vs a target — syntax on target, missing deps, chore conflicts |
| `check_target_drift` | has the target changed from the baseline for the package's objects? |

*(No `deploy_execute` — the push to a target is a human step in the IDE.)*

### Build — write (change set required)
| Tool | Purpose |
|---|---|
| `build_dimension` | declarative: elements + edges + attributes + values + alternate hierarchies in one call |
| `add_elements` | incremental element/edge add — `hierarchy` param (created if missing) |
| `create_hierarchy` | add an alternate hierarchy (different roll-up of the same elements) |
| `restructure_dimension` | in place: re-parent, remove edge, set weight (element rename attempted, reported honestly) |
| `set_attribute_values` | write element-attribute values |
| `build_cube` | create cube over existing dims, optional rules (static-linted + CheckRules); idempotent if the cube exists with the same dimensions |
| `build_process` | create/replace a TI process — params, datasource, 4 sections |
| `write_cells` | write cell values by `{ dimension: element }` coordinates |
| `create_view` | create/replace a view — MDX or native |
| `create_subset` | MDX or static subset |
| `create_chore` / `set_chore_state` | chore create + activate/run |
| `delete_object` | delete any object type (cleanup during a build) |
| `update_cube_rules` | replace a cube's rules — static-linted, errors block unless `force` |
| `update_process` | edit sections of an existing TI |

### Verify / run
| Tool | Purpose |
|---|---|
| `read_cells` | read values by MDX or single intersection — check rules & feeders |
| `execute_view` | run a view, return cells |
| `run_process` | execute a TI (no change set needed) |
| `check_rules_syntax` | static lint + server CheckRules, no write |
| `add_assertion` / `list_assertions` / `remove_assertion` | manage stored expected-result checks |
| `run_assertions` | run the stored assertions — pass/fail against live cells |
| `check_feeders` | recalculate feeder propagation for a cube's rules (newer PA only) |
| `trace_feeders` | which cells feed an intersection — empty = under-fed (newer PA only) |

### Diagnostics
| Tool | Purpose |
|---|---|
| `get_process_log` | recent `TM1ProcessError_*.log` content for a process |
| `get_active_threads` | live server threads |
| `list_error_logs` | server error-log file list |
| `get_transaction_log` | recent cell-write transactions (degrades gracefully on TM1 versions that reject the query) |
| `find_dimension_usage` / `find_cube_usage` / `find_process_usage` | cross-object usage scans |
| `search_ti_code` | regex across all TI code |

---

## Notes & limits

- **Alternate hierarchies**: an element added to the main hierarchy is **not** automatically
  in an alternate one — every element an alternate hierarchy contains (shared leaves included)
  must be listed for it. `build_dimension`'s `hierarchies:[{name, elements, edges}]` and
  `create_hierarchy` + `add_elements(hierarchy:…)` both handle this; the tools re-add shared
  leaves for you when you list them.
- **Large dimensions**: build them from a `build_process` TI that loads from a datasource,
  not from `build_dimension` element lists.
- **Cell data** (`write_cells`) is applied to the server but is *not* carried by the metadata
  deploy pipeline — seed real data with a load process.
- **Chores** are created on the server but not currently carried by the deploy pipeline.
- **`get_transaction_log`** — TM1 v11 rejects `$filter`/`$orderby` on `TransactionLogEntries`,
  so the whole log is fetched (`$top` up to 200k, ~3s for 70k rows) and filtered client-side.
  On a log larger than 200k entries it counts + fetches the tail window. A cube with no writes
  in that window returns `[]`. Requires transaction logging to be enabled for the cube.
- **Native `get_view`** resolves subset *names* but not always the dimension name for
  inline subsets — a limitation of `getViewWithSubsets`.

---

## Bug fixes made to `core/tm1_client.js` for this (also fix IDE features)

| Method | Was | Now |
|---|---|---|
| `getChore` | `$expand=Steps($expand=Process,Parameters)` → 400 | `$expand=Tasks($expand=Process($select=Name))` |
| `getThreads` | `$expand=User,Session` → 400 (no `User` on v11) | `$expand=Session` |
| `getErrorLogFiles` | `$select=Filename,LastUpdated` → 400 | `$select=Filename` |
| `createDimension` | assumed TM1 auto-creates the leaf hierarchy (it doesn't) | creates `Hierarchies` entry explicitly |
| `saveStaticSubset` | copy-paste bug — PATCHed a view URL with undefined vars | PATCH/POST to the Subsets collection |
| `createOrReplaceProcess` | hard-coded `DataSource: {Type:'None'}` | passes through `proc.datasource` |
| `getTransactionLog` | `$filter=Cube eq …` + `$orderby` → 400 on v11 | fetch whole log via `$top`, filter cube + tuple and sort client-side (also fixes the IDE Transaction Log panel) |
