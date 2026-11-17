# 02 — Core rename and logic move

Completed 17 Nov 2026 on `core-rename`. Module names are now kebab-case throughout; business
logic that was still in routes moved into `core/`.

| Commit | Change |
|---|---|
| `543c41e` | Renamed 20 `core/` modules from `snake_case` to `kebab-case`; updated requires, tests, MCP inventory and live docs. The `change_log.db` filename stays as-is. |
| `531ea50` | Moved the process-summary code/prompt into `core/process-summaries.js`; routes use it through the existing module. |
| `31f8f7d` | Moved SQL-to-TI datasource/process generation into `core/ti-generate.js`. |
| `21ffe95` | Moved PAW book/content traversal into `core/paw-books.js`. |
| `da2c531` | Moved view-axis parsing into `core/view-axes.js`; `TM1Client` reuses the same member parser. |
| `5a8e958` | Moved TI debug and run into `core/process-debug.js` and `core/process-run.js`. |

Final: **566 tests, 565 pass, 1 skipped, 0 fail**; root lint **0**; client unchanged.
Nothing pushed, no server restart, no TM1 access.
