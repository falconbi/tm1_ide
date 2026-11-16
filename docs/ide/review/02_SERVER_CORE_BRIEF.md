# 02 — `server.js` and `core/`: review brief

Read `00_STANDARD.md` first. Read-only. Findings to `docs/ide/review/02_SERVER_CORE_FINDINGS.md`.

What you are reviewing: `server.js` (4,409 lines, 242 routes, 46 requires), `lens-server.js`
(884 lines) and the 40 files in `core/` (13,400 lines in all; `tm1_client.js` is 2,021). This is
the layer every forker reads first and copies most, so consistency matters more here than anywhere.

Facts already known, to start from rather than rediscover:
- `CLAUDE.md` says all routes live in `server.js`, every TM1 call goes through `TM1Client`, and the
  route shape is `app.METHOD('/api/noun/verb', async (req, res) => { try … catch { 500 } })`.
- One place in `server.js` builds a TM1 `api/v1/` URL itself (`grep -n "api/v1/" server.js`).
- Route prefixes mix singular and plural for the same thing: `element` and `elements`, `process`
  and `processes`, `lens` and `lenses`, `server` and `servers`.
- `core/` mixes two file-naming styles: snake_case (`tm1_client.js`, `paw_connect.js`,
  `lens_bridge.js`, `cube_data_sources.js`) and kebab-case (`change-set-model.js`, `git-release.js`,
  `rules-lint.js`).
- The deploy pipeline moved to TM1 Git; the `deploy` prefix still has 26 routes, `git` has 11.

## Task 1 — route consistency

Build a table of all 242 routes: method, path, which `core/` functions it calls, whether it has
the standard try/catch and error shape, whether it checks auth / server / change set the same way
its neighbours do, and whether anything in `client/src`, `tools/tm1mcp`, `lenses/` or
`lens-server.js` calls it (grep the path). Then report:
- routes nothing calls
- routes that break the `/api/noun/verb` shape or the singular/plural convention, with the one
  naming rule you would adopt and the list of renames it implies
- routes whose error handling differs from the standard (no try/catch, different status, error
  text leaked from TM1 unchanged, success returned on failure)
- any route that validates its input, and the pattern it uses; and the routes that take user input
  into a TM1 name, filter or MDX without checking it
- the one direct `api/v1/` call and what it should be instead

## Task 2 — what `server.js` should not be doing

`server.js` has 46 requires and 4,409 lines. Without proposing a framework, say which groups of
routes carry logic that belongs in `core/` (business rules, TM1 shaping, file handling) and give
the three worst examples with line ranges. Say where helper functions are defined in `server.js`
that `lens-server.js` or `tools/tm1mcp` re-implement. Note `CLAUDE.md`'s rule is "no router files";
respect it, but say honestly whether one 4,400-line file is still the right call for a reference
codebase, and what the smallest change would be if not (for example, one file per noun under
`routes/`, each exporting a function that takes `app`).

## Task 3 — `core/tm1_client.js`

2,021 lines, one class. Report: methods never called from anywhere; methods that duplicate each
other (same endpoint, different shaping); how errors from TM1 are turned into JS errors and
whether it is done one way; how OData parameters are encoded (there is a known rule: spaces must
be `%20`, not `+`) and whether every method follows it; how control objects (`}` prefix) are
filtered and whether it is consistent; and any method whose name does not say what it does.
Say whether a forker could add a new TM1 call in five minutes by copying a neighbour, and which
neighbour you would point them to.

## Task 4 — `core/` as a whole

For each of the 40 files: one line on what it is for, what requires it (server, lens-server,
MCP, tests, nothing), and its naming style. Then:
- files nothing requires
- the two naming styles, and the rename list for the one you would keep (kebab-case is what
  the newer files use)
- state kept on disk: list every file `core/` reads or writes under `config/`, `data/`,
  `.tm1baseline/`, `packages/` or elsewhere, and whether it is config, runtime state, or a cache.
  This feeds the root clean-up in `01_FRONT_DOOR_FINDINGS.md`.
- the adapter layer (`adapter_registry.js`, `adapters/`): is the adapter contract written down
  (`docs/auth/ADAPTER_INTERFACE.md`) and do the three adapters actually honour it?
- `git-*.js` (12 files): is there one shared way to run git, read state and lock, or several?

## Task 5 — `lens-server.js`

884 lines, a second Express app. Report what it shares with `server.js` (requires the same `core/`
files?), what it duplicates (auth, static serving, error handling, TM1 calls), and whether the
split is explained anywhere a forker would find it.

## Task 6 — tests for this layer

Which `core/` files have a test, which do not, and which tests need a live TM1 server. Name the
five untested functions whose failure would hurt most (auth, change-log writes, deploy gates,
cell writes, encoding).

## Out of scope

The client, the MCP tool implementations (area 09), the Lens pages (area 10), security (James).
