# 10 — Lenses round 2: patterns, and model content out of the IDE repo

Completed 17 Nov 2026. One commit per step; every commit had all tests passing, both lint ratchets
at their baselines (client 129, backend 87), and a successful client build where source changed.

| Step | Commit | Tests before → after |
|---|---|---|
| 1 — Rename examples to patterns | `99bf655` | 505 → 505 pass (1 skipped) |
| 2 — The IDE stops copying patterns | `aff89d5` | 505 → 505 pass (1 skipped) |
| 3 — Workforce Lenses leave the repo | `1a4e3f2` | 505 → 505 pass (1 skipped) |
| 4 — Docs say pattern and Lens | `7c0f7b5` | 505 → 505 pass (1 skipped) |

Final: **506 tests, 505 pass, 1 skipped, 0 fail**.

- Step 1 renamed `shared/lens-patterns/`, `core/lens_patterns.js`, the routes and
  `list_lens_patterns`; each JSON's `example` key is now `sample`; tests are `lens-patterns-*`.
- Step 2 removed the copy-an-example path. New Lenses start blank or from one of your own Lenses;
  Patterns open in a read-only modal with code and description. The modal has no copy button.
- Step 3 copied the Workforce Lenses to **`/home/jdlove/apps/wfp-lenses`** (outside git) before
  `git rm -r lenses/workforce`; `lenses/` is now gone. README, architecture, FEATURES and the
  Lenses docs no longer point at it.
- Step 4 updated the active docs from “examples” to “patterns” and from Lens “pages” to Lenses,
  leaving dated historical text with a note where it uses the old word.

Not done: the pattern modal shows code and description only — it has no live preview. That would
need the bridge host wired for a read-only pattern, and the brief made preview optional. No live
TM1 verification was used.
