# 02 — `server.js` and `core/`: findings

Reviewed 16 Nov 2026, read-only. Scope: `server.js`, `core/`, `lens-server.js`, and the tests
for that layer. Method: parsed all 242 routes, grepped every path against `client/src`,
`tools/tm1mcp`, `lenses/`, `lens-server.js` and `tests/`, mapped every `core/` file's requires,
and read the routes and modules called out below. No code was changed and no server restarted.

The short version: the architecture is sound (one `TM1Client`, adapters, core shared by three
apps), but the route layer has drifted. There is no single error shape, no single auth/validation
shape, and 23 routes are no longer reachable from this repository. A forker copying neighbouring
routes will copy whichever inconsistency they happen to open first.

## What's good — keep as the model

- **One TM1 client + adapter contract.** `server.js`, `lens-server.js` and `tools/tm1mcp` all
  go through `TM1Client`; no route builds a TM1 URL except the one exception in 1.5.
- **The OData encoders are one place and correct.** `core/odata-key.js` (apostrophes doubled) and
  `core/odata-params.js` (spaces as `%20`) are small, documented and used by all three adapters.
  That is exactly the kind of thing a reference codebase should teach.
- **Core is genuinely shared.** The Lens app and MCP reuse `lens_bridge`, `lens_store`,
  `adapter_registry`, `change_log`, `assertions` — no second TM1 client.
- **Safety tests exist and are honest.** Authorization, change-set ownership, approval linking,
  MCP masking/read-only, deploy commit matching, secret sanitising. They stub TM1, so they are
  fast and deterministic.
- **`readonly.js`, `login-rate-limit.js` and `save_data_all.js`** each put one policy in one
  place; copy those file shapes.

---

## Task 1 — Route consistency

### 1.1 There is no one error or auth shape (worst)

The standard `try { … } catch (e) { res.status(500).json({ error: e.message }) }` is common, but
the exceptions are not rare enough to be exceptions:

- **Failures returned as HTTP 200.** `GET /api/process/log` (`server.js:1003`) catches every
  error and returns `{ log: '' }` with 200. `GET /api/servers` (`server.js:499`) returns
  `[]`; `GET /api/forge` (`server.js:2757`) returns `{}`. A caller cannot tell "empty" from
  "failed".
- **Command-result routes.** `/api/period-builder/run` (`server.js:2738`) returns
  `{ ok: false, error }` with 400/500; `/api/deploy/git/prepare|execute|review`
  (`server.js:3134`, `3142`, `3239`) return result objects that may contain `error` with 200.
  These are deliberate (the UI reads the result), but they are a second contract a forker has
  to learn.
- **No outer try/catch.** `POST /api/process/run` (`server.js:1064`) has no route-level
  `try`; `req.query.name.replace(...)` throws an unhandled type error when `name` is missing,
  before any of its internal `try` blocks.
- **TM1 errors are not normalised.** The direct adapter throws
  `new Error('Request failed with status code 400')` with the response attached
  (`core/adapters/direct_v11.js:84-86`); the two PAW adapters let axios throw the same generic
  message (`core/adapters/paw_native.js:23-25`, `core/adapters/paw_oauth2.js:41-44`). Routes then
  disagree: some read `e.response.data.error.message`, most return `e.message`, and
  `/api/period-builder/run` returns `JSON.stringify(e.response.data)`. The same TM1 failure
  therefore reaches the user as a useful message, a generic message, or raw JSON depending on
  the route.
- **Write gates differ.** `gateWrite` (`server.js:47`) and `gateReadOnly` (`server.js:39`) are the
  only gates. `gateWrite` is mostly `gateReadOnly` plus an optional change-set check
  (`TM1_REQUIRE_SESSION`, default off), so the name promises more than the default posture. Writes that create TM1 objects but use only `gateReadOnly`:
  `/api/sql/post-to-ti` (`server.js:2833`, creates/patches a process),
  `/api/period-builder/run` (`2738`, creates processes),
  `/api/admin/validate-ti-functions` (`3637`, creates and deletes temporary processes).
  Writes with no gate at all: `/api/forge` POST (`2766`, local workspace state),
  the SQL connection/query routes (`2782`, `2796`, `2923`, `2934`), catalog overrides
  (`3626`), and the process-summary PUT (`3750`). Some are local files rather than TM1 writes,
  but there is no written rule saying which gate a local write uses.
- **Debug logging left in.** `/api/cells/write` prints the full request body and TM1 response
  (`server.js:2958`, `2963`); `/api/view/axes` prints view internals (`server.js:1865`), `/api/elements/tree` prints a
  sample (`1399`), `/api/view/save` prints MDX (`1360`); the process-run path prints several
  steps (`server.js:1120-1147`). Useful while building, noisy
  and data-leaking in a reference.

**Why it matters to a forker:** they will copy the nearest route. If it returns 200 on failure,
their first integration silently reports success. If it returns `e.message`, they lose TM1's real
error. The one place to fix this is the adapter/TM1Client boundary, not 242 routes.

**Suggested fix:** normalise in `TM1Client` (or a shared `adapterError` helper): extract
`error.message`, keep `status`/`code`/`response`, and set `e.message` to the TM1 text. Add one
`fail(res, e)` route helper: 400 for validation, 401/403 for auth, 409 for read-only/lock,
500 for TM1/server; make command-result routes an explicitly documented exception. Effort:
**small** for normalisation, **medium** for the 30 odd routes.

### 1.2 Twenty-three routes are unreachable from this repository

Grepped exact paths (parameterised paths reduced to their prefix) across `client/src`,
`tools/tm1mcp`, `lenses/`, `lens-server.js` and `tests/`; these have no caller:

| line | route | likely reason |
|---:|---|---|
| 451 | `GET /api/log/recent` | superseded by the change-log panel |
| 1003 | `GET /api/process/log` | superseded by `/api/process/errorlog/content` |
| 1318 | `POST /api/view/execute` | superseded by `/api/view/axes` |
| 1407 | `GET /api/elements/attributes` | duplicate of `/api/element/attributes` (used) |
| 1936 | `POST /api/view/execute-suppressed` | superseded by `/api/view/axes` |
| 2138 | `GET /api/model/dimensions` | superseded by `/api/dimensions` |
| 2145 | `POST /api/chore/execute` | ChoreEditor runs chores another way |
| 2153 | `POST /api/chore/activate` | no UI |
| 2161 | `POST /api/chore/deactivate` | no UI |
| 2197 | `GET /api/process/errorlogs` | superseded by the single-log route |
| 2218 | `POST /api/cube/feeders` | Cell Context Menu no longer offers it |
| 2225 | `POST /api/cube/breakdown` | superseded by trace |
| 2268 | `POST /api/cube/leaves` | no caller |
| 2347 | `GET /api/cube/annotations` | notes UI removed from the context menu |
| 2354 | `POST /api/cube/annotations` | same |
| 2362 | `DELETE /api/cube/annotations/:id` | same |
| 2942 | `GET /api/whoami` | Lens app has its own |
| 3239 | `POST /api/deploy/git/review` | review is done through `/api/git/drift` |
| 3352 | `POST /api/git/governance/mirror` | no UI |
| 3360 | `POST /api/git/governance/apply` | no UI |
| 3384 | `GET /api/deploy/baselines` | Baselines view uses `/api/deploy/baseline` |
| 3391 | `POST /api/deploy/baseline/head` | MCP moves HEAD through core, not HTTP |
| 3768 | `DELETE /api/process/summary` | no UI |

**Why it matters:** these are exactly the "experiments left in" the standard warns about. They
cost reading time, hide which pattern is current, and some still create/delete TM1 objects or
write files if called.

**Suggested fix:** delete them (preferred) or mark them `// deprecated — use X` with a date and
remove in the next release. Re-run the caller grep after deletion. Effort: **small**.

**Checked and not dead:** `/api/admin/maintenance/enable|disable` have no static caller because
`useMaintenanceMode` builds the path with a template literal (`useApi.js:634`). Not deleted.

### 1.3 Input validation is ad hoc; some inputs go straight to TM1 or the filesystem

There is no shared validator or middleware. The recurring pattern is an inline
`if (!x) return res.status(400).json({ error: '… required' })`, repeated in about 50 routes.
That is an acceptable pattern, but it is not applied consistently:

- **Best examples to copy:** `/api/deploy/package` (`server.js:3429`) validates presence,
  resolves the path, refuses outside `packages/` and returns 403/404; `/api/deploy/package-zip`
  (`3513`) does the same; `/api/deploy/import-zip` (`3448`) has a zip-slip guard;
  `/api/cells/write` (`2950`) checks `server`, `cube`, non-empty `dims`.
- **Unguarded `JSON.parse` on user input:** `/api/transactions` (`2374`), `/api/files/list`
  (`2437`), `/api/files/content` (`2449`), `/api/files/upload` (`2466`), `/api/files` DELETE
  (`2481`). Malformed JSON becomes a 500; it should be a 400.
- **Path from user input without containment:** `/api/deploy/archives/:id` (`3605`) does
  `path.join(config/archives, `${id}.json`)` with no check; the package routes show the right
  pattern. **`/api/admin/catalog-overrides` PUT** (`3626`) writes arbitrary JSON with no schema
  or admin check.
- **TM1 names/filters/MDX:** most names are safe because `TM1Client` wraps them in
  `odataKey`; the exceptions are listed in 3.3. Arbitrary MDX is intentional on
  `/api/mdx/execute`, `/api/view/execute` (dead) and `/api/subset/preview`; they rely on
  `executeMDX`'s 50,000-cell cap, not on input shape. That is a defensible design, but it should
  be stated in the route, not inferred.
- **TI code sent to AI:** `/api/process/summary` (`3717`) sends up to 12,000 characters of
  process code to the configured provider. The MCP has `stripTiCredentials`
  (`tools/tm1mcp/guard.js:361`); this path has no equivalent. Security is reviewed separately,
  but the inconsistency belongs here.

**Suggested fix:** add `requireQuery(req, [...])` / `requireBody(req, [...])` helpers returning
400 `{ error }`; wrap every `JSON.parse` with a 400; use one `withinDir(root, value)` helper for
archives/packages; validate catalog overrides against the same shape the client writes. Effort:
**medium**.

### 1.4 Naming: singular and plural are both used for the same noun

Counts from the 242 routes:

| noun | singular routes | plural routes |
|---|---:|---:|
| dimension | 22 | 2 |
| process | 15 | 2 |
| cube | 14 | 1 |
| view | 10 | 1 |
| subset | 8 | 1 |
| chore | 7 | 1 |
| element | 3 | 3 |
| lens | 11 | 5 |
| server | 3 | 2 |

The splits are not collection-vs-object: `POST /api/dimension/element` creates an element,
`GET /api/elements` lists them, and `GET /api/element/attributes` and
`GET /api/elements/attributes` both exist (the latter is dead). The same resource also has
`/api/dimension/element`, `/api/dimension/edge`, `/api/dimension/component`.

**Rule to adopt:** plural collections (`/api/dimensions`, `/api/cubes`, `/api/processes`,
`/api/lenses`), identity in the path (`/api/dimensions/:dim`), actions as a verb sub-resource
(`/api/chores/:name/execute`). Query parameters are for filters, not identity.

**Renames this implies (first pass):**
- `POST /api/dimension/create` → `POST /api/dimensions`
- `POST /api/process/create` → `POST /api/processes`
- `/api/dimension/element` (POST/DELETE/PATCH) → `/api/dimensions/:dim/elements`
- `/api/dimension/edge` and `/api/dimension/component` → `/api/dimensions/:dim/edges`
- `GET /api/element/attributes` and `GET /api/elements/attributes` → one
  `GET /api/dimensions/:dim/elements/:element/attributes`
- `/api/dimension/hierarchy`, `/api/hierarchy/*`, `/api/hierarchies` →
  `/api/dimensions/:dim/hierarchies/*`
- `/api/chore/execute|activate|deactivate` → `/api/chores/:name/…`
- `/api/lens/*` → `/api/lenses/:name/*` (keep `/api/lenses` for the collection)
- `/api/server/version|save-data-all|simple-mode` → `/api/servers/:name/*` or `/api/admin/*`

**Why it matters:** the route shape is the first thing a forker reads; two names for one thing
means two conventions in their new code.

**Suggested fix:** adopt the rule in `CLAUDE.md`, forbid new routes on the old shape, and either
rename in one release or add aliases for one release and delete the old paths. Effort:
**large** (mechanical but touches most client hooks).

### 1.5 The one direct `api/v1/` call

`GET /api/files/content` (`server.js:2449-2458`) builds
`${PAW_HOST}/api/v0/tm1/${server}/api/v1/${apiPath}` and calls
`getCachedPawSession(...).get(...)` with `ba-sso-authenticity`. It bypasses `TM1Client` and the
adapter, so it works only through PAW; it ignores the v11 `.blob` id and `/Document/Content`
shape that `TM1Client._fileAddress` / `_fileContentUrl` handle (`core/tm1_client.js:1781-1792`).
`TM1Client.getFileContent` (`1803`) exists and is used by `model-store`, `assertions` and
`governance-mirror`, but not by this route.

**Fix:** add a raw/binary read to the adapter contract (e.g. `getBuffer(path)` or
`get(path, params, { binary: true })`) and a `TM1Client.downloadFile(pathParts, name)` that uses
`_fileContentUrl`; make the route stream that. Delete the PAW session/CSRF code from
`server.js`. Effort: **small/medium**.

Checked: no other `api/v1/` literal in `server.js`.

---

## Task 2 — What `server.js` should not be doing

`server.js` is 4,409 lines with 242 routes and 66 `require()` occurrences (28 top-level). The
route shape is one file, by design in `CLAUDE.md`, but several groups carry business logic that
`core/` should own:

1. **Cube Map model — `server.js:3812-4076` (~265 lines).** Rules/TI scanning, quote-aware
   comment stripping, DB() extraction, dimension-write detection from the function catalog,
   graph edges and playback steps. This is model analysis, not HTTP. It also duplicates
   `core/cube_data_sources.js` and `core/rule_lens.js` logic. Move to `core/cubemap.js`. Worst
   example.
2. **Process debug and run — `server.js:779-969` and `1064-1151` (~280 lines).** Breakpoint
   injection, capture parsing, the `__RUN_LOG` attribute, temporary process creation/cleanup,
   error-section mapping. This is TI execution policy; move to `core/process-debug.js` and
   `core/process-run.js` (or `core-ti/`). Second worst.
3. **PAW book usage — `server.js:2022-2137` (~116 lines).** Walks the PAW content tree, extracts
   tabs/views, matches a cube/view, caches. PAW-specific traversal belongs in
   `core/paw_books.js`; the route should call one function. Third worst.
4. **View axes — `server.js:1858-1934`.** Parses native/MDX axes and inline subset expressions;
   contains a duplicate of `TM1Client._extractMembersFromExpression`. Move to
   `core/view_axes.js` or make `TM1Client.getViewAxes`.
5. **SQL post-to-TI — `server.js:2833-2901`.** Builds the ODBC datasource body, parses
   `?param?` tokens, merges parameters and creates/patches the process. Move to
   `core/sql_client.js` or a small `core/ti-generate.js`.
6. **Process summaries — `server.js:3676-3777`.** Builds the AI prompt, code excerpt and
   obfuscation map; `core/process_summaries.js` already owns the cache/hash. Move the prompt
   there so the MCP and IDE can share it.

**Helpers defined in `server.js` that duplicate `core/` or `TM1Client`:**
- `extractMembersFromExpression` (`server.js:1850`) is byte-for-byte the same as
  `TM1Client._extractMembersFromExpression` (`core/tm1_client.js:1262`).
- `stripComments` (`server.js:3822`) duplicates `core/cube_data_sources.js:17` and
  `core/rule_lens.js:8` (three variants, different comment rules).
- `parseDbRefs` (`server.js:1959`) duplicates the DB() scan inside
  `core/cube_data_sources.js`.
- Login rate limiting is correctly shared through `core/login-rate-limit.js` — that is the model
  to copy.

**On the "no router files" rule:** one 4,400-line file is no longer the right call for a
reference codebase. The smallest honest change is one file per noun under `routes/`, each
exporting `function register(app, deps)` and mounted from `server.js`; no framework, no magic.
`CLAUDE.md` should say that, not "all routes in server.js". Effort: **large**, mechanical.

---

## Task 3 — `core/tm1_client.js`

2,021 lines, 138 async methods. The class is approachable: `get/post/patch/delete/put` delegate
to the adapter, then each method is one endpoint plus shaping.

### 3.1 Error handling

All adapters throw, but none normalises:
- `direct_v11._settle` (`core/adapters/direct_v11.js:84-86`) throws
  `Request failed with status code N` and attaches the response.
- `paw_native` and `paw_oauth2` let axios throw the same generic message.

`TM1Client` does not wrap them. Routes then choose between `e.message` (generic) and
`e.response.data.error.message` (useful) in an ad-hoc way. The fix belongs once, in the adapter
or a `TM1Client._call` wrapper: `e.message = tm1Message`, plus `e.status`, `e.code`,
`e.original`. This is the single highest-leverage change in the layer. Effort: **small**.

### 3.2 Dead and duplicate methods

- **Never called:** `probeAttributeValueWrite` (`core/tm1_client.js:408`) and
  `probeAttributeWrite` (`440`). They are lab probes left in the class; delete.
- **Duplicated reads:**
  - `getElements` (`68`), `getElementsWithTree` (`83`) and `getElementsWithAttributes`
    (`102`) all read the same collection with different fallbacks. `GET /api/elements` still
    passes `index === '1'` as a third argument (`server.js:1391`), but `getElements` no longer
    takes it — the flag is a no-op (Index is always selected). `getElementsWithAttributes`
    returns `Attributes: {}` because PAW cannot expand them — the name promises data it never
    returns.
  - `getView` (`1144`), `getViewWithSubsets` (`1153`) and `_getViewWithSubsetsRaw` (`1186`)
    are three entry points over several fallback reads; consumers must know whether to read `Rows` or `_rows`.
  - `scanDimensionUsage` (`912`), `scanCubeUsage`, `scanProcessUsage`, `scanSubsetUsage`
    (`778`) and `scanViewUsage` each fetch every process and scan the same code separately.
    They should share one process-code cache/index.
- **Side effect hidden in a name:** `executeViewWithSuppression` (`1433`) **writes** the view
  (`PATCH SuppressEmptyRows`) before executing it. A caller expecting a read changes the saved
  view.
- **Duplicated name shadows:** `setDefaultView` (`1910`) uses a local `esc` for quotes instead of
  `odataKey`; `previewMDX` (`1106`) catches the primary error and silently falls back, so a bad
  MDX expression can surface as a session-subset error rather than the real one.

### 3.3 OData encoding

Query parameters are encoded correctly and centrally: all three adapters pass
`paramsSerializer` from `core/odata-params.js` (`direct_v11.js:145`, `paw_native.js:25`,
`paw_oauth2.js:43`), so spaces are `%20`, not `+`. Path keys mostly use `odataKey`.
Exceptions found:
- `core/git-release.js:288, 292, 303, 317-320` uses `encodeURIComponent` for cube, dimension,
  subset, view, chore and process names. `encodeURIComponent` does not double `'`, so a name
  with an apostrophe breaks the OData key literal; this is the same bug class `odata-key.js`
  exists to prevent.
- `core/tm1_client.js:1535` (annotation id), `1553` (job id), `1875` (session id), `1886`
  (thread id) use `encodeURIComponent`; ids are GUIDs today, but it is a different rule.
- `server.js:3658, 3662` deletes temporary process names with `encodeURIComponent`;
  `core/tm1_client.js:1921` uses a local quote-only `esc` for a process name. Both should be
  `odataKey`.
- `server.js:2084` double-encodes the PAW **Assets** path, which is a different API; leave it,
  but comment why.

**Suggested fix:** add a grep/CI check that `Dimensions('…')`, `Cubes('…')`, etc. interpolate
`odataKey` (or a literal), and replace the exceptions. Effort: **small**.

### 3.4 Control objects (`}` prefix)

Checked the collection getters: `getDimensions` (`562`), `getCubes` (`609`), `getProcesses`
(`634`), `getChores` (`725`), `getSubsets` (`1077`) and `getViews` (`1134`) all filter
`!name.startsWith('}')`; `getControlObjects` (`567`) deliberately returns the inverse. No
inconsistency here. `getElements` does not filter `}` element names, which is correct —
control cubes are dimensions, control *elements* are rare and legitimate.

### 3.5 Could a forker add a TM1 call in five minutes?

Yes for reads. Copy `getChore` or `getSubsets`: build the path with `odataKey`, pass `$select`,
map the `value` array. For writes copy `updateEdgeWeight` or `writeCellValue`; for binary copy
`putFileContent` (but it needs a real adapter method, not the PAW bypass in 1.5). Point them at
`getChore` and `updateEdgeWeight`, and tell them the error shape comes from the adapter, not the
method.

---

## Task 4 — `core/` as a whole

Fifty-two JS files, 8,368 lines (the brief said 40 files / 13,400 lines — it is stale). All are required by something; the "nothing requires it" check
found no orphan file. The dead code is methods, not files (`probeAttribute*` above).

### 4.1 File-by-file

| file | what it is for | style | used by |
|---|---|---|---|
| `tm1_client.js` | TM1 REST calls and shaping; the one client | snake | server, lens-server, MCP, tests |
| `lens_bridge.js` | read/write/trace/notes bridge for Lenses | snake | server, lens-server, MCP, tests |
| `change_log.js` | SQLite change log and change sets | snake | server, MCP, tests, deploy |
| `cube_data_sources.js` | scans TI/rules for cube reads/writes | snake | server, MCP |
| `adapter_registry.js` | picks an adapter from `servers.json` | snake | server, lens-server, MCP, tools |
| `sql_client.js` | MSSQL/PG/MySQL/SQLite connections and queries | snake | server |
| `adapters/direct_v11.js` | direct TM1 REST, Basic auth | snake | adapter_registry |
| `adapters/paw_native.js` | PAW cookie + CSRF | snake | adapter_registry |
| `adapters/paw_oauth2.js` | PAW OAuth2 bearer token | snake | adapter_registry |
| `paw_connect.js` | PAW sign-in, cookies, CSRF, per-user state | snake | adapter_registry, server |
| `lens_store.js` | Lenses stored in the model (Applications) | snake | server, lens-server, MCP, tests |
| `hierarchy_gen.js` | builds an ALT H from an attribute via TI | snake | tm1_client, MCP, tests |
| `rule_lens.js` | static rules review parsing | snake | server, MCP, tests |
| `lens_live.js` | live channel for people on the same Lens | snake | lens-server, tests |
| `process_summaries.js` | AI/human process summary cache | snake | server, MCP, tests |
| `lens_activity_log.js` | write/run activity JSONL | snake | server, lens-server, tests |
| `lens_prefs.js` | per-person Lens theme | snake | lens-server |
| `ide_modes.js` | Simple-mode overrides | snake | server, adapter_registry, tests |
| `save_data_all.js` | admin SaveDataAll route helper | snake | server, tests |
| `lens_examples.js` | reference Lenses for the toolkit | snake | server, MCP, tests |
| `assertions.js` | model assertions and migration | simple | server, MCP |
| `ai/registry.js` | provider-agnostic AI completion | simple | server |
| `ai/obfuscate.js` | fake names for AI calls | simple | server |
| `ai/anthropic.js` | Anthropic wire format | simple | ai/registry |
| `ai/gemini.js` | Gemini wire format | simple | ai/registry |
| `readonly.js` | read-only (PROD posture) refusal | simple | server, adapter_registry |
| `git-release.js` | change-set-scoped release commit | kebab | server, MCP, tests |
| `git-deploy.js` | prepare/execute a Git deploy | kebab | server, tests |
| `rules-lint.js` | server-side Rules static lint | kebab | server, MCP, tests |
| `git-readiness.js` | pre-push readiness check | kebab | server, MCP |
| `model-store.js` | governance documents in the model | kebab | server, tests |
| `git-reconcile.js` | fix deletes/attributes after pull | kebab | server, tests |
| `governance-mirror.js` | mirror governance into Applications | kebab | server |
| `ti-lint.js` | server-side TI static lint | kebab | server, MCP, tests |
| `git-review.js` | content diff for a deploy review | kebab | server |
| `model-health.js` | one-screen model health check | kebab | server |
| `git-drift.js` | prod drift check | kebab | server, MCP |
| `git-restore.js` | apply subsets/views after pull | kebab | server, tests |
| `git-approvals.js` | recorded deploy approvals | kebab | server, MCP, tests |
| `test-results.js` | assertion run history in a control cube | kebab | server, MCP |
| `git-lock.js` | one deploy per target | kebab | server, tests |
| `change-set-model.js` | closed change sets in the model | kebab | server |
| `login-rate-limit.js` | sign-in throttles (IDE + Lens) | kebab | server, lens-server |
| `git-setup.js` | guarded first-time Git setup | kebab | server, tests |
| `git-state.js` | what each server last received | kebab | server, MCP, tests |
| `git-secrets.js` | Git token store | kebab | server |
| `catalog-arity.js` | arity table from the function catalog | kebab | rules-lint, ti-lint |
| `ai/openai-compat.js` | OpenAI-compatible wire format | kebab | ai/registry |
| `odata-params.js` | `%20` query encoding | kebab | all adapters, tests |
| `git-repo.js` | shared git command + URL sanitising | kebab | git-drift, git-release, git-review |
| `odata-key.js` | OData key encoder | kebab | everything, tests |
| `git-identity.js` | Git author identity | kebab | git-* |

### 4.2 Naming

Three styles: 20 `snake_case`, 26 `kebab-case`, 6 single-word (`assertions`, `readonly`, the
`ai/*` files). The newer work is kebab (`git-*`, `*-lint`, `model-*`, `odata-*`). Keep kebab
and rename:

`tm1_client` → `tm1-client`; `lens_bridge` → `lens-bridge`; `change_log` → `change-log`;
`cube_data_sources` → `cube-data-sources`; `adapter_registry` → `adapter-registry`;
`sql_client` → `sql-client`; `adapters/direct_v11` → `direct-v11`; `paw_connect` → `paw-connect`;
`lens_store` → `lens-store`; `hierarchy_gen` → `hierarchy-gen`; `rule_lens` → `rule-lens`;
`adapters/paw_oauth2` → `paw-oauth2`; `lens_live` → `lens-live`; `process_summaries` →
`process-summaries`; `lens_activity_log` → `lens-activity-log`; `adapters/paw_native` →
`paw-native`; `lens_prefs` → `lens-prefs`; `ide_modes` → `ide-modes`; `save_data_all` →
`save-data-all`; `lens_examples` → `lens-examples`.

Update every `require`, test path, docs link and `CLAUDE.md` name. Note `CLAUDE.md` currently
uses `paw-native.js` while the real file is `paw_native.js`; after the rename both agree.
Effort: **medium**.

### 4.3 State kept on disk

| path | written by | type |
|---|---|---|
| `config/servers.json` | admin/UI | **secret** + config (gitignored) |
| `config/forge.json` | `/api/forge` (`server.js:66`, `2766`) | runtime workspace state (gitignored) |
| `config/ide-modes.json` | `core/ide_modes.js:14` | config/runtime (gitignored) |
| `config/sql-connections.json` | `core/sql_client.js:8` | **secret** (gitignored) |
| `config/sql-queries.json` | `core/sql_client.js:215` | user data (tracked) |
| `config/deploy-hooks.json` | packager (`tools/tm1deploy/src/packager.js:11`) | config (tracked) |
| `config/function-catalog-overrides.json` | `/api/admin/catalog-overrides` (`server.js:3614`) | user config (tracked) |
| `config/assertions.json` | `core/assertions.js:21` | legacy state/migration marker (gitignored) |
| `config/model-migration.json` | `core/model-store.js:27` | runtime state (gitignored) |
| `config/deploy-approvals.json` | `core/git-approvals.js:15` | runtime state (gitignored) |
| `config/git-deploy-state.json` | `core/git-state.js:18` | runtime state (gitignored) |
| `config/git-secrets.json` | `core/git-secrets.js:12` | **secret** (gitignored) |
| `config/lens-app.json` | lens-server (`lens-server.js:39`) | **secret** + config (gitignored; example tracked) |
| `config/certs/` | server TLS (`server.js:4402`) | **secret** (gitignored) |
| `config/archives/` | deploy history/retention (`server.js:3579`, `3607`; `tools/tm1deploy/src/retention.js:17`) | runtime archive (gitignored) |
| `config/frames/`, `config/lenses/` | old Lens feature | empty leftovers (gitignored), delete |
| `config/servers.json.bak-tls` | old backup | **secret** leftover (gitignored), delete |
| `data/lens-activity.jsonl` | `core/lens_activity_log.js:10` | runtime log (gitignored) |
| `data/lens-prefs.json` | `core/lens_prefs.js:10` | runtime prefs (gitignored) |
| `data/process-summaries.json` | `core/process_summaries.js:13` | cache (gitignored) |
| `data/demo-hr.db`, `data/tm1_test.db` | demo/test | runtime DBs (`*.db` ignored) |
| `change_log.db` | `core/change_log.js:5` | runtime DB (`*.db` ignored) |
| `packages/` | deploy packager (`server.js:3434`, `tools/tm1deploy`) | runtime packages (ignored) |
| `.tm1baseline/` | `tools/tm1deploy/src/baseline-paths.js:14` | deploy baselines (ignored) |

This confirms the root clean-up in `01_FRONT_DOOR_FINDINGS.md`: runtime belongs under `data/`,
not the repo root or beside live secrets. Effort: **medium** (path changes in code + `.gitignore`).

### 4.4 Adapter layer

The contract is written down in `docs/auth/ADAPTER_INTERFACE.md:34-51` — and it does not match
the code. The doc says `authenticate(credentials)`, `request(method, path, { body, params })` and
`isAuthenticated()`. Every real adapter implements `get/post/patch/delete/put` instead
(`direct_v11.js:174-192`, `paw_native.js:23-48`, `paw_oauth2.js:41-69`; `direct_v11` also has
`closeSession`). The doc also says `paw-native` is "available but not used" (lines 22-26), but
`adapter_registry.js` uses it for PAW V11 connections, and says direct is preferred while
`config/servers.json` decides. The constructor section is now accurate (`TM1Client(server,
adapter)` is implemented), but the interface section is stale.

**Fix:** rewrite the interface section to the real five verbs (+ optional `closeSession`), add a
one-page contract test that each adapter exposes them, and make the "which adapter" table match
`adapter_registry`. Effort: **small**.

### 4.5 `git-*.js`

One shared runner: `core/git-repo.js:9-21` (`git`, `authUrl`, `sanitize`). `git-drift`,
`git-release` and `git-review` use it. `git-deploy`, `git-setup` and `git-readiness` mostly talk
to TM1's Git REST API, not a local clone — that boundary (TM1 Git vs throwaway clone) is not
written down. Two small defects: `git-review.js:10` imports `execFileSync` but never uses it;
`git-release.js:288-320` uses `encodeURIComponent` for TM1 names (see 3.3). `git-lock` and
`git-state` each own one file and are used consistently. Effort: **small**.

---

## Task 5 — `lens-server.js`

884 lines, a second Express app. It shares the right core: `adapter_registry`, `lens_store`,
`lens_bridge`, `lens_live`, `lens_prefs`, `lens_activity_log` and `login-rate-limit`
(`lens-server.js:26-40`). It does not call `server.js` routes; it calls core directly. That is
the correct split.

It duplicates, by design or drift:
- **Auth/session:** its own cookie session (`lens_session`, HttpOnly/SameSite), sign-in/sign-out
  routes (`381-467`), rate limiting (`313`), while the IDE uses `x-ide-token` (`server.js:196`).
- **Static serving:** `/lens-kit` and the bridge script (`677-683`) vs the IDE's `static/`
  (`server.js:99`).
- **API surface:** `/api/lens/exec-mdx`, `read-cell`, `write-cells`, `run-process`, `add-note`,
  `hierarchies`, `element-tree`, `meta`, `history` exist in both `server.js:4234-4374` and
  `lens-server.js:709-851`. The logic is shared through `lens_bridge`, but the route/auth/error
  wrapping is written twice.
- **Error shape:** lens-server mostly returns 400 `{ error }` for bridge failures
  (`709-756`), while the IDE returns 500 for the same failures.

The split is explained well in `docs/lenses/LENS_APP_PLAN.md` (14-22, 105-117, 128-140), but
not in `README.md` or `docs/ide/ARCHITECTURE.md`; `01_FRONT_DOOR_FINDINGS.md` already records
that. A forker reading the root docs sees two servers and no map.

**Suggested fix:** add one paragraph and a three-box diagram (IDE / Lens app / MCP → core →
TM1) to `ARCHITECTURE.md`; document the two auth models as intentional. Do not merge the
servers: the Lens app is deliberately independent at runtime. Effort: **small** docs; **large**
to unify APIs (not recommended).

---

## Task 6 — Tests for this layer

63 test files. Direct coverage of `core/` is uneven:

**Tested directly:** `adapter_registry` (safety-mcp-identity, simple-mode), `change_log`
(partial, safety-mcp-audit), `cube_data_sources`, `git-approvals`, `git-deploy`, `git-release`, `git-repo` (sanitize), `git-restore`,
`hierarchy_gen`, `ide_modes`, `lens_activity_log`, `lens_bridge` (5 tests), `lens_examples` (3),
`lens_live`, `lens_store` (4), `model-store`, `odata-key`, `odata-params`, `process_summaries`,
`rule_lens`, `save_data_all`, `ti-lint`, `tm1_client` (rename/sessions/provision/save-data).

**No direct test (some are exercised indirectly, e.g. `catalog-arity` through `ti-lint`):** `adapters/direct_v11.js`, `paw_native.js`, `paw_oauth2.js`,
`ai/anthropic.js`, `ai/gemini.js`, `ai/obfuscate.js`, `ai/openai-compat.js`, `catalog-arity.js`,
`change-set-model.js`, `git-identity.js`, `git-readiness.js`, `git-review.js`, `git-secrets.js`,
`governance-mirror.js`, `lens_prefs.js`, `login-rate-limit.js`, `model-health.js`,
`paw_connect.js`, `rules-lint.js`, `sql_client.js`, `test-results.js`.

**Live TM1:** none by default. Only `tests/safety-mcp-identity.test.js` has a live check, and it
is skipped unless `TM1_MCP_LIVE_SERVER` is set. `never-deploy.test.js` skips when `packages/` is
absent. Everything else stubs the client/adapter, which is why the suite is fast and safe.

**Five untested functions whose failure would hurt most:**
1. `core/paw_connect.js` — `createSession` / `attachPawSession` / `setServerCredentials`.
   Auth and per-user credential state; a mistake locks people out or crosses users.
2. `core/git-readiness.js` — the pre-push readiness check. A false pass lets a broken model
   reach the repo; the deploy tests start after that gate.
3. `core/git-secrets.js` — token read/write. A failure leaks or loses the Git token.
4. `core/tm1_client.js` — `writeCellValue` / `updateCells`. Cell writes are the product; only
   lensBridge writes are tested, with stubs.
5. `core/adapters/direct_v11.js` — `_request` / `_settle` / `_authHeaders`. Auth, `%20`
   encoding and error shape for the adapter most labs use.

Honourable mentions: `core/login-rate-limit.js` (auth throttle), `core/sql_client.js` (SQL
execution), `core/rules-lint.js` (server-side validation).

**Suggested tests:** a fake-adapter unit test for cell writes and error normalisation; a table
test for the approval gate (no approval / wrong target / wrong commit / expired); a contract test
that all three adapters expose `get/post/patch/delete/put` and encode spaces; a path-containment
test for archives/packages; a rate-limit test. Effort: **small/medium**.

---

## Appendix A — all 242 routes

Mechanical inventory. `callers` = static references in `client/src`, `tools/tm1mcp`, `lenses/`,
`lens-server.js` and `tests/`; dynamic template-literal calls are undercounted (maintenance is
one). `gate` = `W` gateWrite, `RO` gateReadOnly, `S` requireSession, `-` none detected. `error`
is the mechanical check for try/catch + 500 + `{ error }`, not a judgement. `TM1Client` column is
best-effort (inline `makeClient(...).x()` calls appear as `—`).

| line | route | TM1Client methods | callers | gate | error shape | note |
|---:|---|---|---:|---|---|---|
| 106 | POST /api/auth/login | — | 4 | - | ok |  |
| 143 | POST /api/auth/logout | — | 3 | - | try=0 catch=0 err=0  |  |
| 152 | GET /api/config | — | 3 | - | try=0 catch=0 err=0  |  |
| 165 | POST /api/auth/setup-login | — | 3 | - | try=1 catch=1 err=0  |  |
| 183 | POST /api/auth/local-session | — | 3 | - | try=0 catch=0 err=1 403/401 |  |
| 241 | GET /api/auth/servers | — | 2 | - | try=0 catch=0 err=0  |  |
| 251 | POST /api/auth/server-login | — | 2 | - | ok |  |
| 284 | GET /api/auth/method | — | 2 | - | ok |  |
| 292 | POST /api/auth/server-logout | — | 2 | - | ok |  |
| 336 | POST /api/servers/setup | — | 1 | - | try=1 catch=1 err=0  |  |
| 353 | POST /api/sessions/start | — | 2 | RO | ok |  |
| 364 | POST /api/sessions/close | — | 5 | - | ok |  |
| 397 | POST /api/sessions/resume | — | 1 | - | ok |  |
| 405 | GET /api/sessions/active | — | 2 | - | ok |  |
| 413 | GET /api/sessions | — | 7 | - | ok |  |
| 436 | GET /api/sessions/:id/log | — | 7 | - | ok |  |
| 441 | GET /api/sessions/:id/log/verbose | — | 7 | - | ok |  |
| 446 | PATCH /api/sessions/:id/description | — | 7 | - | ok |  |
| 451 | GET /api/log/recent | — | 0 | - | ok | **DEAD** |
| 456 | GET /api/log/object | — | 1 | - | ok |  |
| 461 | POST /api/log/rollback | patch, saveSubset, saveStaticSubset | 1 | RO | ok |  |
| 499 | GET /api/servers | — | 5 | - | try=1 catch=0 err=0  |  |
| 505 | GET /api/cubes | getCubes | 2 | - | ok |  |
| 515 | POST /api/dimension/create | — | 1 | W | ok |  |
| 530 | POST /api/dimension/bulk-import | bulkSetElements, addEdge | 1 | W | ok |  |
| 561 | POST /api/dimension/bulk-attr-import | writeElementAttribute | 1 | W | ok |  |
| 578 | GET /api/dimensions | getDimensions | 4 | - | ok |  |
| 587 | DELETE /api/dimension | deleteDimension | 7 | W | ok |  |
| 599 | POST /api/cube | createCube | 8 | W | ok |  |
| 616 | DELETE /api/cube | deleteCube | 8 | W | ok |  |
| 626 | DELETE /api/subset | deleteSubset | 6 | W | ok |  |
| 637 | GET /api/processes | get, getProcesses | 1 | - | ok |  |
| 653 | DELETE /api/process | deleteProcess | 6 | W | ok |  |
| 664 | GET /api/chores | getChores | 1 | - | ok |  |
| 673 | GET /api/chore | getChore | 1 | - | ok |  |
| 680 | PATCH /api/chore | updateChore | 1 | RO | ok |  |
| 689 | DELETE /api/chore | deleteChore | 1 | RO | ok |  |
| 699 | GET /api/rules | getCube | 3 | - | ok |  |
| 709 | POST /api/rules | getCube, patch | 3 | W | ok |  |
| 725 | POST /api/rules/check | post | 1 | - | ok |  |
| 738 | GET /api/process | getProcess | 6 | - | ok |  |
| 779 | POST /api/process/debug | get, post, createOrReplaceProcess | 1 | RO | ok |  |
| 970 | GET /api/processes/search | get | 1 | - | ok |  |
| 1003 | GET /api/process/log | get | 0 | - | try=1 catch=1 err=0  | **DEAD** |
| 1014 | POST /api/process/create | post | 1 | W | ok |  |
| 1032 | POST /api/process | getProcess, patch | 6 | W | ok |  |
| 1064 | POST /api/process/run | post, executeProcess, executeMDX | 1 | RO | ok |  |
| 1152 | GET /api/cube/dimensions | getCube | 4 | - | ok |  |
| 1164 | GET /api/dimension/attributes | getElementAttributes | 2 | - | ok |  |
| 1174 | GET /api/dimension/alias-values | getAliasValues | 3 | - | ok |  |
| 1184 | GET /api/dimension/cubes | getCubesForDimension | 1 | - | ok |  |
| 1194 | GET /api/dimensions/format-attrs | getAliasValues, getFormatAttrs | 2 | - | ok |  |
| 1214 | GET /api/dimension/attr-grid | getElementAttributes, getElements, getEdges | 1 | - | ok |  |
| 1235 | POST /api/dimension/attribute-def | — | 1 | W | ok |  |
| 1247 | DELETE /api/dimension/attribute-def | — | 1 | W | ok |  |
| 1259 | POST /api/dimension/attribute/convert-to-alias | getElements, getElementAttributeValues, deleteElementAttribute | 1 | W | ok |  |
| 1288 | POST /api/element/attribute | — | 2 | RO | ok |  |
| 1300 | GET /api/views | getViews | 1 | - | ok |  |
| 1309 | GET /api/view | getView | 3 | - | ok |  |
| 1318 | POST /api/view/execute | executeView | 0 | - | ok | **DEAD** |
| 1327 | POST /api/view/preview-records | — | 2 | - | ok |  |
| 1336 | POST /api/view/save | getView, saveNativeView, saveView | 1 | W | ok |  |
| 1364 | POST /api/view/set-default | setDefaultView | 1 | W | ok |  |
| 1377 | DELETE /api/view | deleteView | 3 | W | ok |  |
| 1388 | GET /api/elements | getElements | 3 | - | ok |  |
| 1397 | GET /api/elements/tree | getElementsWithTree | 1 | - | ok |  |
| 1407 | GET /api/elements/attributes | getElementsWithAttributes | 0 | - | ok | **DEAD** |
| 1416 | GET /api/element/attributes | getElementAttributeValues | 2 | - | ok |  |
| 1425 | GET /api/edges | getEdges | 1 | - | ok |  |
| 1435 | POST /api/dimension/element | addElementAt | 1 | W | ok |  |
| 1452 | DELETE /api/dimension/element | deleteElement | 1 | W | ok |  |
| 1463 | PATCH /api/dimension/element | renameElement | 1 | W | ok |  |
| 1474 | POST /api/dimension/edge | addEdge | 1 | W | ok |  |
| 1484 | POST /api/dimension/component | setComponent | 1 | W | ok |  |
| 1496 | PATCH /api/dimension/edge | updateEdgeWeight | 1 | W | ok |  |
| 1505 | DELETE /api/dimension/edge | deleteEdge | 1 | W | ok |  |
| 1516 | GET /api/hierarchies | getHierarchies | 1 | - | ok |  |
| 1523 | GET /api/subset/usage | scanSubsetUsage | 1 | - | ok |  |
| 1530 | GET /api/view/usage | scanViewUsage | 1 | - | ok |  |
| 1537 | GET /api/view/source-usage | — | 1 | - | ok |  |
| 1544 | GET /api/dimension/usage | scanDimensionUsage | 1 | - | ok |  |
| 1551 | GET /api/cube/usage | scanCubeUsage | 1 | - | ok |  |
| 1558 | GET /api/process/usage | scanProcessUsage | 1 | - | ok |  |
| 1565 | POST /api/dimension/hierarchy | — | 1 | W | ok |  |
| 1577 | GET /api/hierarchy/info | — | 1 | - | ok |  |
| 1584 | GET /api/element/hierarchy-parents | — | 1 | - | ok |  |
| 1591 | POST /api/hierarchy/from-attribute | — | 1 | W | ok |  |
| 1603 | DELETE /api/dimension/hierarchy | — | 1 | W | ok |  |
| 1614 | GET /api/search/index | getCubes, getProcesses, getCube | 1 | - | ok |  |
| 1647 | GET /api/subsets | getSubsets | 2 | - | ok |  |
| 1654 | GET /api/subset | getSubset | 6 | - | ok |  |
| 1661 | POST /api/subset | getSubset, saveSubset | 6 | W | ok |  |
| 1677 | GET /api/subset/elements | getSubsetElements | 3 | - | ok |  |
| 1686 | POST /api/subset/static | getSubsetElements, saveStaticSubset | 1 | W | ok |  |
| 1703 | GET /api/dimension/attribute-values | getElements, getElementAttributeValues | 1 | - | ok |  |
| 1724 | POST /api/subset/preview | previewMDX, getElementAttributeValues | 3 | - | ok |  |
| 1748 | POST /api/subset/generate | getElements | 1 | - | ok |  |
| 1788 | POST /api/mdx/generate | getCube, getElements | 2 | - | ok |  |
| 1858 | GET /api/view/axes | executeView, getViewWithSubsets | 1 | - | ok |  |
| 1936 | POST /api/view/execute-suppressed | executeViewWithSuppression | 0 | - | ok | **DEAD** |
| 1948 | POST /api/mdx/execute | executeMDX | 3 | - | ok |  |
| 1967 | GET /api/lineage | getCube | 1 | - | ok |  |
| 1996 | GET /api/lineage/consumers | getCubes, getCube | 1 | - | ok |  |
| 2022 | GET /api/paw/book-usage | — | 3 | - | ok |  |
| 2132 | GET /api/model/cubes | — | 1 | - | ok |  |
| 2138 | GET /api/model/dimensions | — | 0 | - | ok | **DEAD** |
| 2145 | POST /api/chore/execute | — | 0 | RO | ok | **DEAD** |
| 2153 | POST /api/chore/activate | — | 0 | RO | ok | **DEAD** |
| 2161 | POST /api/chore/deactivate | — | 0 | RO | ok | **DEAD** |
| 2169 | POST /api/chore | — | 1 | RO | ok |  |
| 2178 | GET /api/jobs | — | 1 | - | ok |  |
| 2189 | POST /api/job/cancel | — | 1 | - | ok |  |
| 2197 | GET /api/process/errorlogs | — | 0 | - | ok | **DEAD** |
| 2203 | GET /api/process/errorlog/content | — | 1 | - | ok |  |
| 2211 | POST /api/cube/trace | — | 2 | - | ok |  |
| 2218 | POST /api/cube/feeders | — | 0 | - | ok | **DEAD** |
| 2225 | POST /api/cube/breakdown | getElementChildren, executeMDX | 0 | - | ok | **DEAD** |
| 2268 | POST /api/cube/leaves | getElementChildren, getEdges, executeMDX | 0 | - | ok | **DEAD** |
| 2332 | POST /api/cube/rules/check-references | — | 1 | - | ok |  |
| 2339 | POST /api/process/check-references | — | 1 | - | ok |  |
| 2347 | GET /api/cube/annotations | — | 0 | - | ok | **DEAD** |
| 2354 | POST /api/cube/annotations | — | 0 | RO | ok | **DEAD** |
| 2362 | DELETE /api/cube/annotations/:id | — | 0 | RO | ok | **DEAD** |
| 2374 | GET /api/transactions | getCubeLoggingOff, getTransactionLog | 1 | - | ok |  |
| 2401 | POST /api/transactions/restore | get, post, writeCellValue | 1 | RO | ok |  |
| 2437 | GET /api/files/list | — | 2 | - | ok |  |
| 2449 | GET /api/files/content | _contentsPath | 2 | - | ok |  |
| 2466 | POST /api/files/upload | createFileDocument, putFileContent | 2 | RO | ok |  |
| 2481 | DELETE /api/files | — | 3 | RO | ok |  |
| 2492 | GET /api/tm1-sessions | getSessions | 1 | - | ok |  |
| 2503 | DELETE /api/session | — | 7 | - | ok |  |
| 2510 | GET /api/threads | getThreads | 1 | - | ok |  |
| 2518 | POST /api/thread/cancel | — | 1 | - | ok |  |
| 2526 | GET /api/admin/metrics | — | 1 | - | ok |  |
| 2533 | GET /api/admin/configuration | getActiveConfiguration | 1 | - | ok |  |
| 2544 | GET /api/server/version | getProductVersion | 1 | - | ok |  |
| 2555 | POST /api/server/save-data-all | — | 1 | - | try=0 catch=0 err=0  |  |
| 2564 | POST /api/server/simple-mode | — | 1 | - | ok |  |
| 2584 | PATCH /api/admin/configuration | — | 1 | RO | ok |  |
| 2599 | POST /api/admin/maintenance/enable | — | 0 | RO | try=1 catch=1 err=0  |  |
| 2606 | POST /api/admin/maintenance/disable | — | 0 | RO | try=1 catch=1 err=0  |  |
| 2617 | POST /api/users/provision | — | 2 | RO | ok |  |
| 2634 | POST /api/users/:name/password | — | 2 | RO | ok |  |
| 2652 | GET /api/users | — | 2 | - | ok |  |
| 2659 | POST /api/users | — | 2 | RO | ok |  |
| 2668 | PATCH /api/users/:name | — | 2 | RO | ok |  |
| 2678 | DELETE /api/users/:name | — | 2 | RO | ok |  |
| 2687 | GET /api/groups | — | 1 | - | ok |  |
| 2694 | GET /api/users/:name/groups | — | 2 | - | ok |  |
| 2701 | POST /api/users/:name/groups | — | 2 | RO | ok |  |
| 2715 | DELETE /api/users/:name/groups/:group | — | 2 | RO | ok |  |
| 2726 | GET /api/control/objects | getControlObjects | 1 | - | ok |  |
| 2738 | POST /api/period-builder/run | createOrReplaceProcess | 1 | RO | ok |  |
| 2757 | GET /api/forge | — | 1 | - | try=1 catch=0 err=0  |  |
| 2766 | POST /api/forge | — | 1 | - | ok |  |
| 2778 | GET /api/sql/connections | — | 1 | - | try=0 catch=0 err=0  |  |
| 2782 | POST /api/sql/connections | — | 1 | - | ok |  |
| 2796 | DELETE /api/sql/connections/:id | — | 1 | - | ok |  |
| 2803 | POST /api/sql/test | — | 1 | - | ok |  |
| 2812 | POST /api/sql/execute | — | 1 | - | ok |  |
| 2825 | GET /api/sql/schema/:id | — | 1 | - | ok |  |
| 2833 | POST /api/sql/post-to-ti | post, getProcess, patch | 1 | RO | ok |  |
| 2902 | POST /api/sql/preview-datasource | — | 1 | - | ok |  |
| 2918 | GET /api/sql/queries | — | 1 | - | try=0 catch=0 err=0  |  |
| 2923 | POST /api/sql/queries | — | 1 | - | ok |  |
| 2934 | DELETE /api/sql/queries/:id | — | 1 | - | ok |  |
| 2942 | GET /api/whoami | getCurrentUser | 0 | - | ok | **DEAD** |
| 2954 | POST /api/cells/write | writeCellValue | 3 | RO | ok |  |
| 2993 | GET /api/deploy/object-diff | getCube, getProcess, getSubset | 1 | - | ok |  |
| 3028 | GET /api/deploy/baseline | — | 1 | - | ok |  |
| 3036 | POST /api/deploy/pre-delete-check | — | 1 | - | ok |  |
| 3050 | GET /api/git-readiness | — | 1 | - | ok |  |
| 3070 | POST /api/model-health | — | 2 | - | ok |  |
| 3082 | GET /api/assertions | — | 5 | - | ok |  |
| 3089 | POST /api/assertions | — | 5 | RO | ok |  |
| 3096 | PATCH /api/assertions/:id | — | 5 | RO | ok |  |
| 3105 | DELETE /api/assertions/:id | — | 5 | RO | ok |  |
| 3113 | POST /api/assertions/run | — | 3 | - | ok |  |
| 3121 | GET /api/assertions/history | — | 1 | - | ok |  |
| 3134 | POST /api/deploy/git/prepare | — | 2 | - | ok |  |
| 3142 | POST /api/deploy/git/execute | — | 2 | - | ok |  |
| 3157 | POST /api/deploy/git/push | — | 3 | RO | ok |  |
| 3179 | POST /api/deploy/git/release | — | 1 | - | ok |  |
| 3197 | POST /api/deploy/git/approve | — | 2 | - | ok |  |
| 3232 | GET /api/deploy/git/approval | — | 1 | - | ok |  |
| 3239 | POST /api/deploy/git/review | — | 1 | - | ok | **DEAD** |
| 3249 | POST /api/git/drift | — | 4 | - | ok |  |
| 3258 | GET /api/git/lock | — | 1 | - | ok |  |
| 3268 | POST /api/git/lock/clear | — | 1 | - | ok |  |
| 3288 | GET /api/git/setup/status | — | 1 | - | ok |  |
| 3297 | POST /api/git/setup/token | — | 1 | - | ok |  |
| 3304 | GET /api/git/setup/readiness | — | 1 | - | ok |  |
| 3313 | POST /api/git/setup/init | — | 1 | - | ok |  |
| 3326 | POST /api/git/setup/first-push | — | 1 | - | ok |  |
| 3339 | POST /api/git/setup/first-pull | — | 1 | - | ok |  |
| 3352 | POST /api/git/governance/mirror | — | 0 | - | ok | **DEAD** |
| 3360 | POST /api/git/governance/apply | — | 0 | RO | ok | **DEAD** |
| 3371 | POST /api/deploy/seed | — | 2 | - | ok |  |
| 3384 | GET /api/deploy/baselines | — | 0 | - | ok | **DEAD** |
| 3391 | POST /api/deploy/baseline/head | — | 0 | - | ok | **DEAD** |
| 3399 | POST /api/deploy/diff | — | 1 | - | ok |  |
| 3412 | POST /api/deploy/package | — | 2 | - | ok |  |
| 3429 | GET /api/deploy/package | — | 2 | - | ok |  |
| 3448 | POST /api/deploy/import-zip | — | 1 | - | ok |  |
| 3492 | GET /api/deploy/packages | — | 1 | - | ok |  |
| 3513 | GET /api/deploy/package-zip | — | 1 | - | ok |  |
| 3536 | POST /api/deploy/drift-check | — | 2 | - | ok |  |
| 3545 | POST /api/deploy/risk | — | 1 | - | ok |  |
| 3553 | POST /api/deploy/verify | — | 1 | - | ok |  |
| 3562 | POST /api/deploy/scoped-snapshot | — | 1 | - | ok |  |
| 3573 | POST /api/deploy/archive | — | 2 | - | ok |  |
| 3587 | GET /api/deploy/archives | — | 2 | - | ok |  |
| 3605 | GET /api/deploy/archives/:id | — | 2 | - | ok |  |
| 3620 | GET /api/admin/catalog-overrides | — | 2 | - | ok |  |
| 3626 | PUT /api/admin/catalog-overrides | — | 2 | - | ok |  |
| 3637 | POST /api/admin/validate-ti-functions | post, delete | 1 | RO | ok |  |
| 3708 | GET /api/process/summaries | — | 3 | - | ok |  |
| 3717 | POST /api/process/summary | getProcess | 1 | - | ok |  |
| 3768 | DELETE /api/process/summary | — | 1 | - | ok | **DEAD** (path shared with POST) |
| 3778 | GET /api/cube/rules-lens | getCube, getElements, getAllCubesWithRules | 1 | - | ok |  |
| 3801 | GET /api/cube/data-sources | — | 1 | - | ok |  |
| 3812 | GET /api/cubemap/model | getAllCubesWithRules, getDimensions, get | 2 | - | ok |  |
| 4089 | GET /api/lens-examples | — | 1 | - | ok |  |
| 4092 | GET /api/lens-examples/:name | — | 1 | - | ok |  |
| 4101 | GET /api/lenses | — | 6 | - | ok |  |
| 4112 | GET /api/lens/process-usage | — | 1 | - | ok |  |
| 4128 | GET /api/lenses/:name | — | 6 | - | ok |  |
| 4138 | POST /api/lenses/:name | — | 6 | W | ok |  |
| 4157 | DELETE /api/lenses/:name | — | 6 | W | ok |  |
| 4169 | POST /api/lenses/generate | — | 1 | - | ok |  |
| 4234 | POST /api/lens/exec-mdx | — | 4 | - | ok |  |
| 4244 | POST /api/lens/read-cell | — | 1 | - | ok |  |
| 4259 | POST /api/lens/write-cells | — | 3 | RO | ok |  |
| 4279 | GET /api/lens/history | executeMDX | 1 | - | ok | keep: shared/lens-bridge.js calls it |
| 4303 | GET /api/lens/whoami | — | 2 | - | ok | keep: shared/lens-bridge.js calls it |
| 4312 | POST /api/lens/run-process | — | 1 | RO | ok |  |
| 4339 | POST /api/lens/add-note | — | 1 | RO | ok |  |
| 4353 | GET /api/lens/hierarchies | — | 1 | - | ok |  |
| 4364 | GET /api/lens/element-tree | — | 1 | - | ok |  |
| 4374 | GET /api/lens/meta | — | 3 | - | ok |  |
| 4386 | GET /{*path} | — | 0 | - | try=1 catch=1 err=0  |  |