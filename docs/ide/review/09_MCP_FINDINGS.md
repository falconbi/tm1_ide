# 09 — MCP server (`tools/tm1mcp`)

Read-only review. No code changes, no server restart, no TM1 calls.

Scope: `tools/tm1mcp/server.js`, `shared.js`, `registry.js`, `guard.js`, `identity.js`, every
`tools/tm1mcp/tools/*.js` group, and the claims in `docs/ide/MCP_SERVER.md`.

## Summary

The MCP's basic shape is sound: readonly is the default, every tool is classified, the reader
and builder identities are separated, every read is audited, denylisted cubes are checked before
TM1, and password scrubbing is applied to every result. The weak points are in tools that cross
that wrapper's assumptions:

1. `add_assertion` is a **write** tool that runs arbitrary MDX as the **builder** and returns the
   numeric result. It bypasses both the read policy and the reader identity.
2. `run_assertions` runs stored MDX through the reader but never checks the stored MDX against
   the read policy.
3. MCP `close_change_set` does not write the model-owned closed record that the IDE close route
   writes.
4. The MCP build helpers write attribute values without the `ATTRIBUTE_VALUE_SET` entries the
   deploy reconcile needs, even though `set_attribute_values` now logs them.
5. The deploy checks accept any `packageDir` and read it with the target's service login.
6. `check_feeders` is classified read-only but recalculates server-side feeder state.

These are findings, not a security verdict; security is a separate review.

---

## 1. Identity and read policy

### 1.1 `add_assertion` runs arbitrary MDX as the builder and returns the value

**What:** `add_assertion` is classified as a write tool, so the registry runs its handler inside
`identity.asBuilder()`. The handler then calls `client().executeMDX(mdx)` and returns the summed
`actual` value in `check_now`. The read policy is only applied to tools classified as reads, so
there is no `guard.checkArgs()` on the MDX and no reader identity.

**Where:** `tools/tm1mcp/tools/assertions.js:28-41`;
`tools/tm1mcp/registry.js:24-26, 80-100`; `tools/tm1mcp/guard.js:35-49`
(`add_assertion` is in `WRITE_TOOLS`); `tools/tm1mcp/identity.js:45-56` (builder client).

**Why it matters to a forker:** An agent in build mode can ask
`add_assertion({ mdx: 'SELECT ... FROM [A Denied Cube]', ... })` and get a value back using the
service login, even when `TM1_MCP_READ_USER` and `config/mcp-security.json` deny that cube to the
reader. It also works without an open change set (`add_assertion` is in
`UNGATED_WRITE_TOOLS`), so the result and the assertion write are outside the documented
"every metadata write requires a change set" gate. This is the most direct policy bypass in the
MCP.

**Suggested fix:** Do not run arbitrary MDX inside a write tool. Either:
- move the "check now" read into a read tool after writing the assertion, so it uses the reader
  and `guard.checkArgs`; or
- have `add_assertion` validate the MDX against the read policy before executing it and run the
  check as the reader, refusing if the reader cannot see the cube.

Also decide whether assertion writes are a change-set write; if not, document the exception
explicitly. Add a safety test with a denied cube and no change set.

**Effort:** Medium.

### 1.2 Stored assertion MDX is not checked against the read policy

**What:** `run_assertions` is a read tool, so the wrapper runs it as the reader, but
`guard.checkArgs(policy, {})` has nothing to inspect. The actual queries come from the stored
`assertions` array and are passed to `runAssertions()`, which executes them without
`guard.cubesInMdx`/`allowed` checks.

**Where:** `tools/tm1mcp/tools/assertions.js:60-71`;
`tools/tm1mcp/shared.js:82-119` (`runAssertions`); `tools/tm1mcp/guard.js:120-137`.

**Why it matters to a forker:** If the model has an assertion against a cube that the current
reader policy denies (for example, a test added by an earlier admin or agent), `run_assertions`
returns that cube's `actual`/`diff` through the reader login only if TM1 security allows it; the
extra policy layer is skipped. With reads on the service login (no `TM1_MCP_READ_USER`), this is
a direct policy bypass.

**Suggested fix:** Before executing each stored assertion, check its `mdx` with
`guard.cubesInMdx` + `guard.allowed`, and either skip the assertion with a clear `redacted`/error
result or refuse the run. Filter `list_assertions` the same way, or mark denied assertions
`not visible`. Add a test with a stored assertion against a denylisted cube.

**Effort:** Small.

### 1.3 Related objects leak names the policy denies

**What:** The policy checks only the object named in the arguments. Several read tools return
other object names without filtering them:
- `get_cube_dimensions` returns every dimension of an allowed cube, even dimensions denied by
  the policy.
- `list_chores` / `get_chore` return process names from chore steps without a process-policy
  filter.
- `get_active_threads` returns thread/process information without a process filter.
- `get_view`/`execute_view` can expose dimension and member names through a view.

**Where:** `tools/tm1mcp/tools/introspect.js:40-53, 190-219`;
`tools/tm1mcp/tools/diagnostics.js:43-53, 85-99`; `tools/tm1mcp/guard.js:115-137`.

**Why it matters to a forker:** The docs present `allow`/`deny` as scoping cubes, dimensions and
processes. A directory-level denial is easy to bypass by reading a parent object (a cube's
dimension list, a chore's steps, or a thread's function) instead of naming the denied object
directly.

**Suggested fix:** Apply the same `may('dimensions'|'processes', name)` filters to returned
relations: filter cube dimensions, chore step processes (and hide steps whose process is denied),
and thread process/function names. Decide explicitly whether `get_view`/`execute_view` need
dimension filtering and document it.

**Effort:** Medium.

### 1.4 `check_feeders` is registered as read-only but mutates server state

**What:** `check_feeders` is in `READ_TOOLS`, so it is offered in `MCP_MODE=readonly` and runs
inside `asReader`. Its handler calls `client().checkFeedersForRules(cube)`, which recalculates
feeder propagation on the server. That is a server-side state change (or at least a potentially
expensive operation), not a pure read.

**Where:** `tools/tm1mcp/guard.js:28-32` (READ_TOOLS includes `check_feeders`);
`tools/tm1mcp/tools/develop.js:143-157`; `tools/tm1mcp/registry.js:76-77`.

**Why it matters to a forker:** Read-only mode is documented as "the 39 read tools only" and
"reads run as the reader". A user who grants a read-only MCP expects no operation that
recalculates or changes server state. The reader may also lack permission to run it, producing a
confusing failure in a supposedly read-only mode.

**Suggested fix:** Classify `check_feeders` as a write/diagnostic operation (or add a separate
`diagnostic` class that is allowed only in build mode and runs as builder), and update the docs
and tool count. If it is truly read-only on supported TM1 versions, rename it to say so and
prove it in a live test.

**Effort:** Small.

---

## 2. Change-set and model ownership

### 2.1 MCP `close_change_set` does not write the model-owned closed record

**What:** The IDE close route calls `core/change-set-model.closeAndPersist()` before
`cl.closeSession()`, which writes the immutable `Applications/Governance/ChangeSets/<id>.json`
record on a migrated server. The MCP `close_change_set` only calls `cl.closeSession()` and reads
the local log. A change set closed by an agent is therefore missing from the model-owned record
on a migrated server, and a fresh IDE cannot list it.

**Where:** `tools/tm1mcp/tools/changeset.js:78-114`;
`server.js:376-406` (IDE close); `core/change-set-model.js:40-48`.

**Why it matters to a forker:** The docs say the IDE and MCP write through the same client and
change log, and that the model owns change sets. Here the two close paths produce different
records. The MCP's change set is real locally but invisible in the model/governance layer.

**Suggested fix:** Reuse the same close service as the IDE (`closeAndPersist` then
`closeSession`) with the agent identity as `closedBy`, or make `changeLog.closeSession` the one
place that performs both writes. Add a test for a migrated model.

**Effort:** Small.

### 2.2 Assertion writes are an undocumented exception to the change-set gate

**What:** The docs say "Every metadata write requires an open change set." `add_assertion` and
`remove_assertion` are in `UNGATED_WRITE_TOOLS` and only call `requireWritable`; they write the
model's assertions document without a change set. `add_assertion` also records its `changeSet`
only if one happens to be open, so the write is not necessarily reviewable.

**Where:** `tools/tm1mcp/registry.js:20-26`; `tools/tm1mcp/tools/assertions.js:28-41, 53-58`;
`docs/ide/MCP_SERVER.md:339-364`.

**Why it matters to a forker:** The central safety claim of the MCP — a model change is captured
in a change set — is false for the assertions document. An agent can change the tests that gate
close/deploy without a change-set record. That may be intentional (assertions are governance),
but it must be stated and tested rather than hidden in a set named `UNGATED`.

**Suggested fix:** Decide the policy: require a change set for assertion writes and log them, or
document them as a separate governance area with an explicit gate. In either case, make the
exception visible in `MCP_SERVER.md` and the tool description.

**Effort:** Small.

---

## 3. MCP build helpers bypass attribute-value logging

### 3.1 `build_dimension` and `add_elements` write attribute values without change-log entries

**What:** `set_attribute_values` was changed to log `ATTRIBUTE_VALUE_SET`, but the other MCP
paths that write `Format` and supplied attribute values still write them directly:
`build_dimension.attribute_values` and its default Format loop, and `add_elements`' default/
explicit Format loop. They log only `DIMENSION_CREATED`/`ELEMENT_ADDED`, so `getSessionManifest`
has no element/attribute pairs for those writes.

**Where:** `tools/tm1mcp/tools/build.js:64-95, 101-111` (build_dimension);
`:157-180` (add_elements); compare the fixed `set_attribute_values` at `:261-282`.

**Why it matters to a forker:** An agent can build a complete dimension with `build_dimension`
and attribute values, then release it; the release's manifest does not contain those values, and
the deploy reconcile cannot copy them to the target. The IDE's own attribute-value route now logs
them, so MCP and IDE paths disagree again.

**Suggested fix:** Use one `logAttributeValue` helper (or `logChange('ATTRIBUTE_VALUE_SET', ...)`)
in every MCP attribute-value write, reading the previous value first. Include the default Format
writes. Add a test that `build_dimension` with two attribute values produces two manifest pairs.

**Effort:** Medium.

---

## 4. Deploy-check tools

### 4.1 `check_deploy_risk` / `check_target_drift` accept arbitrary local `packageDir`

**What:** Both tools accept a `packageDir` string from the agent and pass it to the deploy
tooling, which reads `manifest.json` and package files. There is no check that the path is under
the IDE's `packages/` directory (the IDE route has that check for package reads), and the tools
use the target's service login (`analyzeRisk(..., null)` / `driftCheck(..., null)`).

**Where:** `tools/tm1mcp/tools/deploy.js:10-32, 36-58`;
`server.js:3120-3133` for the path guard the IDE uses; `tools/tm1deploy/src/risk.js` and
`tools/tm1deploy/src/diff.js` for the readers.

**Why it matters to a forker:** The tool is advertised as "read-only" but can be pointed at an
arbitrary local directory containing a manifest and package-shaped files, with the target
service login doing the subsequent reads. At minimum that is an unexpected local-file read
surface; in a hostile prompt it is a path the agent can choose. The target allowlist protects
the server name, not the package path.

**Suggested fix:** Resolve `packageDir` against the known packages root and refuse anything
outside it (the same guard as `/api/deploy/package`). Prefer passing a package id returned by
`package_change_set`, or validate that an existing manifest was created by this IDE. Document the
target service-login behavior next to the tool.

**Effort:** Small.

### 4.2 Deploy-check failures are returned as successful `ok()` text

**What:** `check_deploy_risk`, `check_target_drift`, and several other MCP tools catch a failure
and return `ok('... failed: ...')`. The registry only marks a result as an error when the handler
throws; these responses are therefore ordinary successful content with a sentence inside.

**Where:** `tools/tm1mcp/tools/deploy.js:17-32, 43-58`;
similar patterns in `changeset.js` and `lenses.js`.

**Why it matters to a forker:** An agent reading tool results by `isError` will treat a failed
risk check or drift check as a successful check. The failure text is visible only if the model
reads the prose, not if the client relies on the protocol error flag.

**Suggested fix:** Let the error propagate (the wrapper will turn it into `isError: true` and a
clear message), or return `{ content: ..., isError: true }` explicitly. Keep the explanatory text
in the error message. Reserve `ok()` for a completed check, including a check that legitimately
has blockers.

**Effort:** Small.

---

## 5. Documentation and test claims

### 5.1 `MCP_SERVER.md` still says 26 write tools and server-keyed change sets

**What:** The docs say `safety-mcp-write-tools.test.js` runs "every one of the 26 write tools",
but `guard.WRITE_TOOLS` and the tool registrations contain 29. The workflow section says
"Because `getActiveSession` is keyed by server (not user)", but `core/change_log.getActiveSession`
takes `(server, user)` and the MCP passes `AGENT_USER`.

**Where:** `docs/ide/MCP_SERVER.md:176, 239, 373-374`;
`tools/tm1mcp/guard.js:34-49`; `tools/tm1mcp/shared.js:128-140`;
`core/change_log.js:86-100`.

**Why it matters to a forker:** The counts and the change-set ownership rule are the parts a
forker uses to reason about isolation. The current text gives the wrong isolation model and a
stale test promise.

**Suggested fix:** Derive the count in the docs from the catalog/tool sets (or update it once and
test the count), and say "keyed by server + developer (`TM1_MCP_USER`, default `ai-agent`)".
Update the write-tool test description to 29.

**Effort:** Small.

### 5.2 The policy bypasses have no safety tests

**What:** The safety tests cover readonly mode, reader/builder identities, read policy, masking,
password scrubbing, audit and the write-tool smoke test, but there is no test for:
`add_assertion` against a denied cube; `run_assertions` with a stored denied MDX; MCP close
writing a model record; `build_dimension` attribute values producing manifest pairs; or
`check_feeders` mutating in readonly mode.

**Where:** `tests/safety-mcp-*.test.js` (the existing coverage); the gaps are in
`tools/tm1mcp/tools/assertions.js`, `build.js`, `changeset.js`, and `guard.js`.

**Why it matters to a forker:** Those are exactly the paths where the wrapper's assumptions are
crossed, so the tests currently prove the safe paths and leave the bypass paths unproven. A green
suite can be mistaken for "the MCP cannot be talked into reading denied data".

**Suggested fix:** Add focused tests with the existing `tests/_mcp-harness.js` fake:
- `add_assertion` with a denylisted cube returns a refusal and writes no assertion;
- `run_assertions` skips/marks a denied stored assertion;
- MCP `close_change_set` calls the model close path on a migrated fake;
- `build_dimension` logs `ATTRIBUTE_VALUE_SET` for each value and default Format;
- `check_feeders` is not registered in readonly mode (or is explicitly allowed with a
  documented read-only meaning).

**Effort:** Medium.

---

## 6. Checked and found nothing (worth calling out)

- `guard.classify` classifies all 68 registered tools; no tool is unclassified, and the
  `READ_TOOLS`/`WRITE_TOOLS` counts match the registrations (39/29).
- `MCP_MODE` defaults to readonly on every server; `MCP_MODE=build` is refused on a read-only
  server, and write tools are not registered in readonly mode.
- The reader identity fails closed: a configured `TM1_MCP_READ_USER` that cannot be honoured
  (missing password, PAW connection) stops the MCP rather than falling back to the service login.
- `guard.checkArgs` covers the named cube/dimension/process, `args.cubes`, and every cube in an
  MDX `FROM` for `read_cells`, `execute_view` and similar reads; denylisted calls are refused
  before TM1.
- Cell and attribute masking, parent widening, the built-in control-object deny list, TI password
  stripping, and answer-wide `scrubResult` are present and have dedicated safety tests.
- The read audit is separate from the change log and is pruned by `TM1_MCP_AUDIT_DAYS`.
- `save_data_all` checks the admin group, and `check_deploy_risk`/`check_target_drift` use the
  target allowlist; the target service-login behavior is disclosed in `MCP_SERVER.md`.
- `get_transaction_log` can return old/new values without cell masking; this is explicitly
  documented as a known limitation in `MCP_SERVER.md`, not a new finding here.
- No live TM1 server or REST call was used in this review.
