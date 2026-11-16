# 09 — MCP server: fix brief (round 1)

Build brief for OpenCode. Source: `09_MCP_VERDICT.md`, agreed by James 16 Nov 2026. Read
`09_MCP_FINDINGS.md` for line numbers.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass). `cd client && npx eslint src` stays at 129 or
  fewer. Only step 6 touches `client/src` (rebuild and commit `static/` there).
- Do not push. Do not restart any server. **Do not connect the MCP to any TM1 server.** Every
  test uses `tests/_mcp-harness.js` and the fakes the `safety-mcp-*` tests already use.
- Questions go in `docs/ide/review/09_MCP_FIXES_QUESTIONS.md`, never into guesses.
- `docs/ide/BUG_FIXES.md` line for steps 1, 2, 3 and 4.
- Every step that changes a tool, a count or a rule also changes `docs/ide/MCP_SERVER.md` in the
  same commit.

## Step 1 — Close the read-policy bypasses (bug)

- `tools/tm1mcp/tools/assertions.js` `add_assertion` (~28-41): remove the `executeMDX` call and
  the `check_now` result. It writes the assertion and returns `{ added, next: 'run_assertions
  with ids: [<id>] to check it' }`.
- `run_assertions` (~60-71) and `shared.js` `runAssertions` (~82-119): accept an optional `ids`
  filter; before running each stored assertion, check its `mdx` with `guard.cubesInMdx` +
  `guard.allowed` against the current read policy. A denied assertion is returned as
  `{ id, status: 'not visible' }` and is not executed. `list_assertions` applies the same filter
  (denied ones listed as `not visible`, MDX redacted).
- Safety tests (`tests/safety-mcp-assertions.test.js`): `add_assertion` never executes MDX (the
  fake client records calls); `run_assertions` with a stored assertion on a denylisted cube
  returns `not visible` and makes no TM1 call; an allowed one runs as the reader.

## Step 2 — Delete `check_feeders` (dead on v11, misclassified)

Remove the tool from `tools/develop.js:143-157`, from `READ_TOOLS` in `guard.js`, from
`TM1Client.checkFeedersForRules` if nothing else uses it (grep), from the tool list in
`MCP_SERVER.md`, and from any test that names it. `reprocess_feeders` stays as the write tool.
Update the counts in `MCP_SERVER.md` (write 29, read 38) and add
`tests/mcp-tool-counts.test.js` that derives the numbers from `guard.js` and asserts the doc
states them, so they cannot drift again.

## Step 3 — One close path (bug)

Move the IDE close route's sequence (`csm.closeAndPersist(...)` then `cl.closeSession(...)`,
from `server.js` `/api/sessions/close`) into one function
`core/change_log.closeChangeSet(id, { user, tests, ideToken, client })` (or a new
`core/change-set-service.js` if `change_log` must stay a plain log). The IDE route and MCP
`close_change_set` (`tools/changeset.js:78-114`) both call it; the MCP passes `AGENT_USER`.
Test on the migrated fake: closing through the MCP writes the model record.

## Step 4 — Every MCP attribute-value write logs (bug)

`tools/tm1mcp/shared.js`: add `logAttributeValue(client, dim, element, attribute, value,
{ hierarchy })` that reads the current value, writes it, and calls
`logChange('ATTRIBUTE_VALUE_SET', …)` with `before`/`after` in the shape area 07 step 3
defined. Use it in `build_dimension` (`tools/build.js:68-71` and the default Format loop
`:83-94`), `add_elements` (`:157-180`), and `set_attribute_values` (replace its inline logging
so there is one implementation). Test: `build_dimension` with two values and one default Format
→ three manifest pairs.

## Step 5 — Related-object filtering

`tools/introspect.js` (`get_cube_dimensions` ~40-53; `get_view` ~190-219) and
`tools/diagnostics.js` (`list_chores`/`get_chore` ~43-53; `get_active_threads` ~85-99): apply
`guard.may(policy, 'dimensions'|'processes', name)` to names in the result; denied dimensions
are omitted from a cube's list; chore steps whose process is denied show
`process: '(not visible)'`; thread process/function names likewise. For `get_view` /
`execute_view`: one rule — recommended: a view on an allowed cube is readable in full, and the
doc says so. Tests for each.

## Step 6 — Assertion writes: ungated but logged, exception documented

`add_assertion` and `remove_assertion` stay in `UNGATED_WRITE_TOOLS`, but each calls
`logChange('ASSERTION_ADDED' | 'ASSERTION_REMOVED', 'assertion', id, { detail })` so the change
log shows them under the open change set if any. Add the two actions to `ACTION_META` in
`ChangeLogPanel.jsx` (rebuild and commit `static/`). `MCP_SERVER.md` "Every metadata write
requires an open change set" gains one sentence naming the exception and why. Both tool
descriptions say "does not require an open change set; the write is logged".

## Step 7 — Deploy-check tools

`tools/deploy.js`: resolve `packageDir` against the packages root (the same resolution
`server.js` uses for package reads) and refuse any path outside it (4.1). In `deploy.js`,
`changeset.js` and `lenses.js`, replace `return ok('… failed: …')` in catch blocks with `throw`
so the registry marks `isError` (4.2); keep the explanatory text in the thrown message. Tests: a
`packageDir` outside the root is refused; a failing check surfaces `isError: true`.

## Step 8 — Docs exact

`docs/ide/MCP_SERVER.md`: "keyed by server + developer (`TM1_MCP_USER`, default `ai-agent`)"
replaces the "keyed by server (not user)" sentence (~373-374); the write-tool test description
says 29 (~239). One table of every tool with its class (read/write), gate (change set /
ungated) and identity (reader/builder), generated from `guard.js` + `registry.js` by a small
script in `tools/` so it stays true.

## When finished

`docs/ide/review/09_MCP_FIXES_DONE.md`: one line per step, commit hash, tests before and after,
lint, the final tool counts, anything not done and why.
