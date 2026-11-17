# 12 — Repo tidy: fixes done

Completed 17 Nov 2026. One commit per step. Final tests: **526 total, 525 pass, 1 skipped, 0
fail**; root lint **0**; client lint **118**.

| Step | Commit |
|---|---|
| 1 — Remove the temp photos | `4dae827` |
| 2 — Remove the archive | `82b9423` |
| 3 — Fold `scripts/` into `tools/` | `436d5c4` |
| 4 — Rename `core-ti/` to `ti-processes/` | `937be37` |
| 5 — Make `.mcp.json` an example | `f39a393` |
| 6 — Clean `.gitignore` and local leftovers | `f0fdc0e` |
| 7 — Match the docs to the tree | `bf5add6` |

- Removed `docs/Temp files/` (two WhatsApp images).
- Removed `docs/Archive/` (34 files), its two `docs/README.md` references and its
  `docs/ide/MCP_SERVER.md` link. The still-true Workforce deployment fact now links to
  `docs/models/WORKFORCE_MODEL.md`.
- Moved `scripts/seed-test-db.js` to `tools/seed-test-db.js`; removed the personal `scripts/push.sh`
  and its `SETUP.md` row; removed the now-empty `scripts/`.
- Renamed `core-ti/` to `ti-processes/`, updated the `TM1Client` require, docs and the folder README,
  including the requested scope sentence.
- Added `.mcp.example.json` with placeholder env values; untracked local `.mcp.json` and ignored it.
  Updated MCP/auth setup wording and `CONTRIBUTING.md`.
- Deleted local `venv/`, `tm1_deploy/`, `server.log` and the stray `core/__pycache__/` (not tracked).
  Removed from `.gitignore`: `docs/Archive/writeback_debug_log.txt`, `venv/`, `__pycache__/`,
  `*.py[cod]`, `*$py.class`, `*.egg-info/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`,
  `/Bedrock` and `tm1_deploy/`. Added `.mcp.json`.
- `CLAUDE.md`, `docs/ide/ARCHITECTURE.md` and `CONTRIBUTING.md` now list the current top-level
  folders. Every root folder is either in that list or ignored.

Not done: the branch was not pushed, per the brief. No TM1 or server restart was used.
