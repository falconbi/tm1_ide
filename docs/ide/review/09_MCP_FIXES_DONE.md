# 09 — MCP server: fixes done (round 1)

Completed 16 Nov 2026. One commit per step; every commit had all tests passing and client lint at
129 (20 errors, 109 warnings). No push, no server restart, no live TM1/MCP connection.

| Step | Commit | Tests before → after |
|---|---|---|
| 1 — Close the read-policy bypasses | `c91df51` | 460 → 463 (1 skipped) |
| 2 — Delete `check_feeders` | `f112355` | 463 → 464 (1 skipped) |
| 3 — One close path | `a4d372d` | 464 → 466 (1 skipped) |
| 4 — Every MCP attribute-value write logs | `ee0f417` | 466 → 467 (1 skipped) |
| 5 — Related-object filtering | `d1f760c` | 467 → 470 (1 skipped) |
| 6 — Assertion writes ungated but logged | `21c38a6` | 470 → 471 (1 skipped) |
| 7 — Deploy-check packageDir and errors | `d31a53d` | 471 → 473 (1 skipped) |
| 8 — Docs exact and generated tool table | `5b8fbd8` | 473 → 474 (1 skipped) |

Final: **474 tests, 473 pass, 1 skipped, 0 fail**; client lint **129**; **67 tools — 38 read,
29 write**.

- Step 2 removed `check_feeders` from the tool surface, `READ_TOOLS`, `TM1Client` and the docs;
  `tests/mcp-tool-counts.test.js` now derives the documented counts from `guard.js`.
- Step 3 used `core/change-set-service.js` (kept `change_log` a plain log). Both the IDE route
  and MCP `close_change_set` now persist the model-owned record before closing locally.
- Step 4 routed `build_dimension`, `add_elements` and `set_attribute_values` through
  `logAttributeValue`, including default `Format` values.
- Step 5 filters cube dimensions, chore steps and active-thread process/function names. The
  `get_view` / `execute_view` rule — a view on an allowed cube is fully readable — is documented;
  no code change was needed there.
- Step 6 rebuilt and committed `static/`; the two assertion actions render in Change Log.
- Step 7 resolves `packageDir` under the packages root (real path, escape check, manifest
  required) and turns deploy/check failures into protocol errors.
- Step 8 generated the inventory with `node tools/tm1mcp/tool-table.js --write`; a test fails if
  the doc table drifts from `guard.js` / `registry.js`.
- Nothing outstanding from this brief. Live-TM1 verification was intentionally not run under the
  review rules.
