# tm1mcp — MCP Server for AI Agents

`tools/tm1mcp/` is a [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes the TM1 model and a full set of build/diagnostic tools to any MCP-capable AI
client (Claude Desktop, Claude Code, Cursor, Cline, …). `server.js` is just the bootstrap
(shared context + wiring); the 67 tools themselves live in `shared.js` (common helpers) and
`tools/*.js`, one file per subject — `docs`, `introspect`, `changeset`, `assertions`,
`deploy`, `build`, `develop`, `period`, `coreti`, `diagnostics`, `lenses`. The security wrapper every tool goes
through lives in `registry.js`, `guard.js` and `identity.js` (see [Security](#security)).

It is **provider-neutral** — MCP is an open protocol; the server has no dependency on any
particular model.

**Building a model from a requirements doc?** Read [`BUILDING_MODELS.md`](../models/BUILDING_MODELS.md)
first (or call the `read_build_guide` tool) — it's the method; this file is the reference.

> ⚠️ **Status: early, needs more real-world testing.** The change-set gating and deploy-pipeline
> integration below are the intended safety net, but the tool surface (67 tools) hasn't seen
> heavy production use yet — treat it as a working build, not a hardened one.
>
> **Security note on external LLMs:** any MCP client you point at this server — including a
> third-party/external LLM, not just Claude — gets real tool access. By default that is
> read-only (`readonly` mode). In `build` mode, which must be switched on with `MCP_MODE=build`, it
> includes writing to your TM1 model (dimensions, cubes, rules, processes, cells) inside whatever
> change set is active, and the `deploy` tools can read from and check drift against a live
> target server (e.g. Prod). For read-only use, leave `MCP_MODE` unset and add
> `TM1_MCP_READ_USER` so the agent has no write tools and sees only what that TM1 user may see
> (see [Security](#security)). Only connect MCP clients and models you trust, keep build work
> inside a named change set (never against Release scope) so everything is diffed before it
> ships, and review what an agent proposes before approving or deploying it.

---

## What's been tested (and what's still open)

Three full TM1 models have been built through this MCP, one after the other, by the same AI
working with the same person. The write-up is the article
[Three Models, One Lesson](https://falconbi.github.io/articles/three-models-ai-guardrails/).

1. **An operating-expense allocations model.** It worked in the end, and showed exactly where
   an AI goes wrong in TM1 (wrong dimensionality, rules that compile but compute the wrong
   thing). Those lessons are now built into the lints and [`BUILDING_MODELS.md`](../models/BUILDING_MODELS.md).
2. **A workforce planning model.** Versions and assumptions, pay rates, a hiring plan, FX, and
   employee income tax through to gross-to-net pay. It was deployed through the IDE's pipeline
   from a development server to a production server, and the figures **matched to the cent**.
   See [`WORKFORCE_MODEL_PLAN.md`](../Archive/WORKFORCE_MODEL_PLAN.md).
3. **A statutory group consolidation.** Ownership and control at any depth, goodwill and
   non-controlling interests, step acquisitions and disposals, foreign currency translation,
   and consolidation of sub-groups. Built test-first: **26 published worked examples matched**,
   with **over 150 stored checks** run after every change.

Across all three:
- Dimensions, cubes, rules, processes, subsets and views were created through the tools,
  change-set gated throughout.
- Builds are verified against **expected results** stored in the model
  (`Applications/Governance/Tests/assertions.json`; `config/assertions.json` is the fallback
  for unmigrated servers) — the "does it compute the right number" layer on top of TM1's own
  rule checker.
- The IDE and the MCP write through the **same client and change log**, so the agent's work
  flows through `diff → package → risk → deploy` exactly like hand-built changes.

**Resolved — read security (October 2026).** Reads used to be the gap: the agent read
everything as the service login, with no scoping, masking or record. That is now closed — see
[Security](#security) below: per-user reads under TM1's own security, a `readonly` mode with no
write tools, cube / dimension / process scoping, masking, TI password stripping, and an audit of
every read.

**Still open — honestly:**
- **Per-user reads need a direct connection.** `TM1_MCP_READ_USER` works on servers reached
  directly (Basic or CAM login). On a server reached through PAW there is no per-user login
  here yet, so the MCP refuses to start with a reader user rather than fall back.
- **One reader per MCP process.** The reader is whoever is set in the environment when the MCP
  starts; there is no per-request sign-in. Run one MCP per person.
- **Writes still use the builder (service) login.** That is deliberate — the change set is the
  gate, and every change-set row now records both the developer and the TM1 login — but TM1
  security does not limit what a build can change.
- **Masking is cosmetic. TM1 security is the real control.** Masking changes what the MCP
  hands back; it doesn't stop TM1 calculating or returning the value. The classic leak is a
  total: if a leaf is masked but its parent isn't, the leaf is the parent minus the visible
  siblings. Tested on a lab server, one masked organisation leaf came back exactly from its parent
  and two siblings. The MCP now masks every **parent** of a masked member automatically (default
  hierarchies; if it can't read a hierarchy it masks the whole cube). That closed the lab leak,
  but it still doesn't catch:
  - a rule-calculated cell built from the masked value (e.g. `Total Comp = Salary + Bonus` as a
    leaf);
  - a total in an alternate hierarchy;
  - a value seen through another tool (`get_transaction_log` shows old and new values for a cube
    you've allowed).

  If a value must not be seen, deny it with TM1 element or cell security on the reader login
  (`TM1_MCP_READ_USER`), or deny the cube in the policy. Use masking as a convenience on top,
  not as the control.
- **Some governance reads use the service login.** `list_baselines`, `get_change_set` and
  `diff_change_set` read through the deploy tooling with its own connection. They're audited and
  scrubbed of passwords, but not narrowed by the reader's TM1 security.
- **The deploy checks reach another server as its service login.** `check_deploy_risk` and
  `check_target_drift` connect to a target (which can be production) with that server's service
  login, outside the reader's TM1 security and the masking rules. In `readonly` mode they're
  only offered when target servers were named on purpose (`TM1_MCP_ALLOWED_TARGETS` or
  `"mcpAllowTargets"` in `config/servers.json`). In `build` mode they're limited to that list
  plus the bound server.
- **No screen for the read audit yet.** `read_audit` keeps 90 days by default
  (`TM1_MCP_AUDIT_DAYS`; `0` = keep forever), but no MCP tool or IDE screen shows it. Read it
  with SQLite.
- **Password stripping is pattern-based.** Every tool's answer goes through it, the deploy
  checks and error messages included. It recognises the standard places: the password argument
  of `ODBCOpen` / `ODBCOpenEx` / `AssignClientPassword`, password-named variables
  (`vPassword = '…'`), `PWD=` / `Password=` in connection strings, and password / secret / token
  fields in returned objects. A password it doesn't recognise as one gets through, e.g. built
  from pieces (`'Tr0' | 'ub4dor'`), held in a variable with an ordinary name, or read from a
  file at run time. Don't rely on it to make TI that holds passwords safe to share; move the
  passwords out of the code.
- The tool surface (67 tools) has been used on three models, not yet in heavy production use.

---

### Bedrock is not an MCP dependency

The MCP tools and AI-generated TI must not call `}bedrock.*` processes. Bedrock is a
developer-only TM1 toolbox; it is not part of the core IDE process layer and not a
supported dependency for AI-built applications. Use purpose-built, reviewable
processes instead. This applies to `run_process`, generated TI and anything MCP
proposes for a WFP or core process.

The core namespace follows the same boundary: `}IDE.*` processes are hidden
infrastructure. Do not ask the AI to discover them with `list_processes`; expose a
dedicated MCP tool for the operation instead.

---

## Security

What an agent may **read** through the MCP, as whom, what it sees masked, and the record kept.
Writes are unchanged: change-set gated, read-only (PROD-posture) servers refuse them.

### Two modes — `MCP_MODE`

| Mode | Tools offered | Default when |
|------|---------------|--------------|
| `readonly` | the 39 read tools only, or 37 when no target servers are named (see below). Write tools are **not registered**, so the agent never sees them | **always**, unless `MCP_MODE=build` is set |
| `build` | all 67 | only when `MCP_MODE=build` is set |

**Read-only is the default on every server.** An AI connected through this MCP can only read
until someone deliberately turns on building. Set `MCP_MODE=build` only where you build:

- Claude Code: in `.mcp.json`, next to `TM1_MCP_SERVER`: `"MCP_MODE": "${MCP_MODE:-build}"`
- OpenCode: in `opencode.jsonc`, on the DEV entry: `"environment": { "MCP_MODE": "build" }`
  (see `opencode.example.jsonc`)

`MCP_MODE=build` against a read-only server is refused at start-up. Every tool is classified
read or write in `tools/tm1mcp/guard.js`; a new tool that isn't classified stops the MCP at
start-up, so nothing slips in unreviewed.

### Two identities — reads as the user, writes as the builder

| Variable | Meaning |
|----------|---------|
| `TM1_MCP_READ_USER` | TM1 login every **read** runs as. TM1's own cube, dimension, element and cell security then decides what the agent sees — the same as that person sees in PAW. |
| `TM1_MCP_READ_PASSWORD` | Its password (required when the user is set). |
| `TM1_MCP_READ_NAMESPACE` | CAM namespace, for CAM-secured servers. |
| `TM1_MCP_USER` | The developer's name — whose change set a build lands in (unchanged). |

Put these in `.env` (the MCP loads it at start-up) or the shell environment. **Never put the
password in `.mcp.json` or `opencode.jsonc`.** `.mcp.json` is committed to the repository. See
[Where secrets live](../auth/AUTHENTICATION.md#where-secrets-live).

Writes run as the **builder**: the service login configured for the server. Each change-set row
records both the developer (`user`) and that TM1 login (`identity`).

Unset `TM1_MCP_READ_USER` and reads run as the service login — start-up says so plainly. Set it
and the MCP logs in as that user before serving anything; if that can't be honoured (wrong
password, or a server reached through PAW) it stops — it **never** falls back to the service
login. Start-up prints the outcome, e.g.:

```
tm1mcp: connected to "MyServer" — mode readonly, 37 tools (not offered: 26 write tools,
        2 deploy checks — name target servers to offer them);
        reads as TM1 user "east_mgr" (TM1 security applies)
```

Tested on a lab server: the service login sees 36 cubes; a regional manager sees 4, and 4 of 15
organisation elements.

### Scoping and masking — `config/mcp-security.json`

Optional. Copy [`config/mcp-security.example.json`](../../config/mcp-security.example.json).
`"*"` applies to every server; a server's own entry adds to it. `*` is a wildcard; case is
ignored.

```json
{
  "*": {
    "cubes":      { "deny": ["Payroll*"] },
    "processes":  { "deny": ["Security *"] },
    "redact": {
      "cells":      [{ "cube": "Employee*", "members": ["Salary", "Bonus*"], "action": "round:-3" }],
      "attributes": [{ "dimension": "Employee", "attribute": "Home Address*", "action": "mask" }]
    }
  },
  "MyDevServer": { "cubes": { "allow": ["Sales*", "Opex*"] } }
}
```

- **Default: every model cube, dimension and process**, minus the security control objects,
  which are always denied whatever the file says: `}Client*`, `}*Security*`, `}Capabilities`,
  `}Groups*` cubes; `}Clients`, `}Groups` dimensions.
- **Deny / allow** apply to the `cube`, `dimension` and `process` a tool names, to every cube in
  an MDX query's `FROM`, and to the lists (`list_cubes`, `list_dimensions`, `list_processes`,
  usage finders, `search_ti_code`). A refused call never reaches TM1.
- **Cell masking** (`read_cells`, `execute_view`): a rule matches a cube, and optionally members
  (on rows, columns or the `WHERE` slice). `mask` hides the value, `round:N` rounds it
  (`round:-3` = nearest thousand), `block` refuses the whole read. No `members` = the whole cube.
  The parents of a masked member are masked too, so it can't be worked out from a total. Masking
  is cosmetic: see the limits under "Still open" above. TM1 security on the reader login is the
  real control.
- **Attribute masking** (`get_element_attributes`): per dimension and attribute; `mask` or `block`.
- **Recognisable passwords are stripped from every answer**, whatever the tool. There's no
  setting. Masked: the password argument of `ODBCOpen` / `ODBCOpenEx` / `AssignClientPassword`,
  password-named variables (`vPassword = '…'`), `PWD=` / `Password=` in connection strings, and
  password / secret / token fields. It's pattern-based, so a password it doesn't recognise as one
  gets through (see "Still open").
- A policy file that isn't valid JSON, or has an unknown action, stops the MCP — it never
  guesses "no restrictions".

### Read audit

Every read tool call is written to the `read_audit` table in `change_log.db`: time, server,
developer, the TM1 login it ran as, tool, object, rows returned, cells masked, and the outcome
(`ok`, `refused`, `error`). It is a separate table from the change log, so reads never appear in
a change set, diff, package or deploy. Rows older than `TM1_MCP_AUDIT_DAYS` (default 90; `0` =
keep forever) are removed at start-up and once a day.

### Tests

`tests/safety-mcp-*.test.js` — `readonly` exposes no write tools; reads use the user's login and
writes the builder's; a reader that can't be honoured fails closed; denylisted cubes are refused
on every way in; masking masks, rounds and blocks, and covers parents; passwords are stripped
from every answer; reads are audited, kept 90 days, and never touch the change set. Separately,
`safety-mcp-write-tools.test.js` runs every one of the 26 write tools once against a fake TM1, so
a tool that can't run at all (like the old `esc is not defined` bug) fails a test. An optional live check (`TM1_MCP_LIVE_SERVER`,
`TM1_MCP_LIVE_USER`, `TM1_MCP_LIVE_PASSWORD`) proves a restricted user sees fewer cubes than
the service login.

---

## Running it

The MCP connects to **one TM1 server at a time**. The server name must match an
entry in `config/servers.json` exactly (including capitals).

### With Claude Code (the normal way)

The repo ships a project-level MCP config, `.mcp.json`, in the project root:

```json
{
  "mcpServers": {
    "tm1": {
      "type": "stdio",
      "command": "node",
      "args": ["tools/tm1mcp/server.js"],
      "env": {
        "TM1_MCP_SERVER": "${TM1_MCP_SERVER:-}"
      }
    }
  }
}
```

- Out of the box the MCP is **read-only**. To build models, add `"MCP_MODE": "${MCP_MODE:-build}"`
  to the `env` block on your own machine (see [Two modes](#two-modes--mcp_mode)).
- Claude Code picks it up automatically when you open this project. The first time,
  it asks you to approve the `tm1` server. Say yes.
- The path is relative, so it works for anyone who clones the repo, whatever their
  home folder is.
- The MCP is named `tm1`, so tools show up as `mcp__tm1__list_cubes` and so on. The
  tool permissions in `.claude/settings.json` are keyed to that name, so keep it `tm1`.

### Which TM1 server the MCP points at

**By default it follows the IDE.** With nothing set, the MCP uses the server you last
selected in the IDE (saved in `config/forge.json`). Switch server in the IDE, then
restart Claude Code — the MCP only picks its server at startup.

There is deliberately **no hard-coded default server**. One used to sit in `.mcp.json`;
when the work moved to another model nobody changed it, and the MCP stayed aimed at
the old server, where a write could have landed on the wrong model.

**To pin a server instead** (overrides the IDE), set `TM1_MCP_SERVER` before starting
Claude Code:

```bash
TM1_MCP_SERVER=TM1_Test_DEV claude
```

**Checking it:** on startup it prints `tm1mcp: server <name> (from <where>)`, and every
write tool's answer ends with `[ran on <server>]`, so a wrong server shows at once.
If no server is set anywhere (no flag, no env var, nothing selected in the IDE) the
MCP refuses to start and says so.

### Gotcha: a personal entry overrides the project one

If you ever registered the MCP yourself (with `claude mcp add tm1 ...`), that entry
lives in your personal `~/.claude.json` (`~` = your home folder, and the leading `.`
makes it a hidden file). A personal entry with the **same name** (`tm1`) **wins over**
`.mcp.json`, so editing `.mcp.json` appears to do nothing. Fix it by removing the
personal one:

```bash
claude mcp remove tm1 -s local
```

### Running it by hand (testing / other MCP clients)

```bash
# by flag
node tools/tm1mcp/server.js --server MyServer

# or by env var
TM1_MCP_SERVER=MyServer node tools/tm1mcp/server.js
```

On startup it prints `tm1mcp: server <name> (from <where>)` to stderr. Order: `--server`,
then `TM1_MCP_SERVER`, then the IDE's selected server.

### Auth

Writes (and reads, unless `TM1_MCP_READ_USER` is set) use the same login as the IDE with no
signed-in user: the `makeClient(server, null)` path, which signs in with the service login
for that server from `config/servers.json`. See [Security](#security) for reading as a
specific TM1 user. A
brand-new TM1 v11 server starts with `admin` / `apple`, and `tm1s.cfg` has no setting
to change that. Change it after startup if needed (TI `AssignClientPassword`).

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
(default 0.01). Stored in the model's `Applications/Governance/Tests/assertions.json` on migrated
servers (fallback: `config/assertions.json`, keyed by server, plain JSON so it can be hand-edited
and version-controlled). `list_assertions` and `run_assertions` report `source: "model" | "config"`
so it's always clear which store the assertions were read from.

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

## Tool catalog (67: 39 read, 28 write)

In `readonly` mode only the read tools are offered. The split is defined in
`tools/tm1mcp/guard.js` (`READ_TOOLS` / `WRITE_TOOLS`).

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
| `list_baselines` | the server's append-only baseline history, and which one is HEAD |
| `set_baseline_head` | move HEAD back to an earlier baseline |
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
| `build_period_dimension` | run the IDE Period Builder generator and save its three TI processes (does not run them) |
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
| `copy_version` | run the installed core `}IDE.Version.Copy` (requires a change set; no Bedrock) |
| `reprocess_feeders` | reprocess feeders for cubes, e.g. after recreating a cube (no change set needed) |
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

### Lenses
| Tool | Purpose |
|---|---|
| `list_lens_examples` | reference Lenses to learn patterns from (input grid, line items with approval, dashboard, variance, process page, disclosure accounts…) — never copied wholesale |
| `list_lenses` / `get_lens` | Lenses stored in the model, and one Lens's full HTML and settings |
| `save_lens` | save a Lens (own HTML or a template + config) into the model, test-running its queries (change set required) |
| `delete_lens` | delete a Lens from the model (change set required) |

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
