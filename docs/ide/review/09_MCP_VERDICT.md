# 09 — MCP server: checked verdict

Claude checked OpenCode's `09_MCP_FINDINGS.md` against the code on 16 Nov 2026. James agreed the
round 1 brief (`09_MCP_FIXES.md`) the same day.

## What was checked

| Claim | Result |
|---|---|
| `add_assertion` runs arbitrary MDX via `client().executeMDX` as the **builder**, no `guard.checkArgs`, returns the value (`tools/assertions.js:28-41`); in `WRITE_TOOLS` and `UNGATED_WRITE_TOOLS` | **Confirmed** — the one direct read-policy bypass |
| `check_feeders` is in `READ_TOOLS` (`guard.js:30`) | **Confirmed** — and the endpoint it calls (`tm1.CheckFeedersForRules`) does not exist on v11 (found 15 Nov): misclassified and dead |
| MCP `close_change_set` calls `cl.closeSession` only; the IDE route calls `closeAndPersist` first (`tools/changeset.js:78-114`) | **Confirmed** |
| `build_dimension` writes attribute values and default Formats without `ATTRIBUTE_VALUE_SET` (`tools/build.js:64-107`) | **Confirmed** — a hole in area 07's Rule 1 fix for agent-built models |

Not re-verified: 1.2, 1.3, 2.2, 4.1, 4.2, 5.1. Consistent with the code read.

## Ranked (see the fix brief for detail)

1. Close the policy bypasses (`add_assertion` writes only; checks run as the reader; stored MDX
   honours the read policy). 2. Delete `check_feeders`. 3. One close path shared with the IDE.
4. Every MCP attribute-value write logs. 5. Related-object filtering. 6. Assertion writes
ungated but logged and documented. 7. `packageDir` guarded; failures as `isError`. 8. Docs
exact with counts derived by a test.

## Keep as the model (agreed)

Readonly by default, build refused on a read-only server, every tool classified or the server
won't start, reader identity fails closed, denylist before TM1, masking and scrubbing with
their own tests, read audit separate from the change log.
