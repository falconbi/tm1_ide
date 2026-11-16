# 11 — Build, tests, lint, CI, docs: checked verdict

Claude checked OpenCode's `11_BUILD_FINDINGS.md` against the code on 17 Nov 2026.

## What was checked

| Claim | Result |
|---|---|
| CI runs `npm test` before the build, and the Lens/pivot jsdom tests load the committed `static/lens-kit/lens-kit.js`; nothing checks `static/` is current | **Confirmed** (`.github/workflows/ci.yml` step order) |
| CI baseline is still 133; the code is at 129 | **Confirmed** — four lint problems can land green |
| Only `client/` is linted | **Confirmed** — no root ESLint config or script |
| CI runs Node 22 only; Setup says 20+; no `engines` | **Confirmed** |
| `format-sweep.test.mjs` passes "over 0 format strings" when the private baseline is missing | **Confirmed** (`catch { }` then an empty loop) |
| Admin/catalog/session-start route tests match source text | **Confirmed** for the three named tests |
| `playwright` still in devDependencies and CI env | **Confirmed** — also in the 01 brief step 5; moved here |
| No contributor guide; `LINT.md` unlinked | **Confirmed** |

## Ranked

1. **CI proves `static/` is the build of the source.** Build first, then test, then
   `git diff --exit-code -- static`. *Small. The worst one: green CI on a stale bundle.*
2. **The lint baseline comes from one file** (129). *Small.*
3. **The false-green test skips loudly.** *Small.*
4. **Playwright out; Node 20 is the tested minimum** (matrix 20 + 22, `engines`, `.nvmrc`). *Small.*
5. **Lint the backend too** with its own recorded baseline. *Medium.*
6. **Behaviour tests for the three text-matching route tests.** The full route-factory move
   belongs to the `routes/` split, not this round. *Medium.*
7. **`CONTRIBUTING.md`.** *Small.*

## Keep as the model

One `npm test` over the whole repo with no live TM1. jsdom for the real grid and toolkit. Explicit
skips that say why. Vite writing straight into `static/`.
