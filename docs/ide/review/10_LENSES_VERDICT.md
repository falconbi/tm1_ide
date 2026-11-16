# 10 — Lenses: checked verdict

Claude checked OpenCode's `10_LENSES_FINDINGS.md` against the code on 17 Nov 2026. Nothing fixed
yet. James decides.

## What was checked

| Claim | Result |
|---|---|
| `/lens/:name`, `/lens-frame/:name`, `/api/lens/:name` check groups (`openable`) but never status; `/api/lens/lenses` filters groups only | **Confirmed** (`lens-server.js:607-670, 821-830, 851-861`). With `showDrafts: false` a draft opens for anyone who knows its name |
| `/api/lenses` misses the status filter | **Wrong** — it does filter status (`:703`). Its real fault is 3.2: no `try/catch` on an async route |
| Read bridge routes (`exec-mdx`, `read-cell`, `meta`, `hierarchies`, `element-tree`, `cell-*`) never check the Lens | **Confirmed** (`:709-719, 754-789`). The host bridge sends the Lens name only for write/run/history (`shared/lens-bridge.js:155-184`). TM1 security still applies to the data; the Lens access rule does not |
| The status predicate is copied four times | **Confirmed** (`:485, 703, 792`; missing at `:821`) |
| Editor keeps `tab.name` after save / rename; `getLens: () => tab.name`; no `patchTab` | **Confirmed** (`LensEditor.jsx:118, 191, 230-252`). A new Lens can't test write-back until the tab is reopened |
| "Save draft" turns a published Lens back into a draft | **Confirmed** (`core/lens_store.js:130` `status: publish ? 'published' : 'draft'`) |
| One bad document fails the whole list | **Confirmed** (`core/lens_store.js:40-62`, no per-document catch) |
| Missing `config/lens-app.json` falls back to the example (`24Retail`) | **Confirmed** (`lens-server.js:46-52`, a warning only) |
| `Lens.rows` `dimOf` truncates at `]` | **Confirmed** (`shared/lens-kit/rows.js:14-18`); `shared/pivot/cellset.js:16` already exports a `]]`-aware `dimOf` |

Not re-verified: 2.3, 4.2, 5.2. Consistent with the code read.

**Gap in the findings:** the brief asked for the committed Workforce pages in `lenses/workforce`
(15 pages + `save.js` + README). OpenCode reviewed `tmp/workforce/lens/out` instead, so 5.3 is
about the wrong folder. The real pages are already in the repo and documented. Workforce page
quality is still to be reviewed (round 2, or folded into area 11).

## Ranked recommendations

1. **One publish gate.** `lensStore.visibleTo(doc, groups, { showDrafts })` (status + access) is
   used by every list and open route. Tests for a draft on all five routes. *Small. The
   documented publish gate isn't a gate today.*
2. **Every bridge call names its Lens.** This is the design James decided on 14 Oct ("enforced on
   every request ... every bridge call"). The host already knows the Lens. Send it on reads too,
   and have the Lens app's read routes run `visibleLens` (cached per session + Lens). *Medium.*
3. **The editor follows the saved name.** Keep `savedName` from the save response, use it in
   `getLens`, and `patchTab` the tab name and label. *Small. Breaks normal authoring.*
4. **Lists don't fall over.** Catch per document and return `{ lenses, errors }`. `/api/lenses`
   gets `try/catch`. The editor's start-page fetches check `r.ok` and show an error with Retry.
   *Small.*
5. **The Lens app refuses to start without its own config.** The example is used only with an
   explicit `--demo`. *Small. Today it silently points at another server.*
6. **Saving keeps the status.** Leaving `publish` out keeps the current status. Publish and
   Unpublish are explicit actions. *Small.*
7. **`Lens.rows` uses the pivot's `dimOf`.** Add a test with `]` in the name. *Small.*
8. **Theme file tested.** Every theme has its light/dark keys and a label, and the app checks
   once at start-up. *Small.*
9. **Docs.** The `LENS_APP_PLAN.md` access sentence is true once 1 and 2 land, with a test per
   route it names. `docs/lenses/` points at `lenses/workforce` as the worked example. Toolkit
   bundle composition gets one paragraph. *Small.* A smaller read-only kit (4.3) is a feature
   decision for later, not this round.

## Keep as the model (agreed)

The sandboxed frame with its own CSP and no `allow-same-origin`. The bridge answering only its
exact iframe and taking the server from the host, never from the message. Write-back checked
against the **saved** Lens's declared cubes, with conflicts, calculated cells and limits refused
as a whole. Runs limited to declared processes, as the signed-in user. Lenses stored in the model.
Activity logged.
