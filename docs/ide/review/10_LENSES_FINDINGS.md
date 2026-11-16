# 10 — Lenses: kit, editor, app, Workforce pages

Read-only review. No code changes, no server restart, no TM1 calls.

Scope: `lens-server.js`, `core/lens_*.js`, `shared/lens-bridge.js`, `shared/lens-kit`,
`shared/lens-examples`, `client/src/components/LensEditor.jsx`, the Lens app pages, and the
claims in `docs/lenses/LENS_APP_PLAN.md` / `LENSES_PLAN.md`.

## Summary

The Lens platform has a clear security model on paper: a Lens is a sandboxed iframe, reads and
writes run as the signed-in TM1 user, a saved Lens declares the cubes it may write and the
processes it may run, and `config.access` lists the TM1 groups allowed to open it. The app
mostly implements that model, but the **status** gate (draft vs published) is only applied on
the home page and the write paths, not on the direct open list, preview, or API routes; and the
generic read bridge calls do not carry a Lens identity at all.

The most serious issues are:

1. draft/unpublished Lenses can be opened or framed by anyone who knows the name;
2. `config.access` is bypassed by direct read bridge calls;
3. a newly saved or renamed Lens keeps using its old `tab.name` for write/run checks;
4. the Lens list has no per-document error isolation, and `/api/lenses` has no async error handler;
5. the Lens app falls back to the example server when its real config is missing.

This review did not use a live TM1 server.

---

## 1. Lens app access control

### 1.1 Draft and unpublished Lenses are exposed by direct routes

**What:** The home page and `/api/lens/lenses` apply `status === 'published' || (showDrafts &&
status === 'draft')`, but the direct viewer and metadata paths do not:
- `/lens/:name`
- `/lens-frame/:name`
- `/api/lens/:name`
- `/api/lenses`
- `/api/lens/lenses`

They check group access through `openable()` (or not at all) but never check the Lens status.
With `showDrafts: false`, a user who knows a draft's name can fetch its HTML or frame it.

**Where:** `lens-server.js:607-679` (`/lens/:name`, `/lens-frame/:name`);
`:700-707` (`/api/lenses`); `:821-830` (`/api/lens/lenses`); `:851-861`
(`/api/lens/:name`); the status filter exists only at `:484-493` (home) and inside
`visibleLens` at `:790-796`.

**Why it matters to a forker:** The documented publish gate is not a gate. A draft can contain
unreviewed queries, names, or write declarations and is visible outside the home page. The
Lens app's own `showDrafts` setting is therefore only cosmetic.

**Suggested fix:** One `visibleLens(req, name)` helper should check status, group access and
toolkit version, and every viewer/API route must use it. Filter `/api/lenses` and
`/api/lens/lenses` by status as well. Add direct draft tests for all five routes.

**Effort:** Small.

### 1.2 Read bridge calls do not carry or check the Lens identity

**What:** `config.access` is enforced for writes, process runs, notes, history and live, but the
generic read routes accept any signed-in session: `/api/lens/exec-mdx`, `/api/lens/read-cell`,
`/api/lens/meta`, `/api/lens/hierarchies`, `/api/lens/element-tree`, and the three
`/api/lens/cell-*` routes. They do not require a `lens` name and never call `openable` or
`visibleLens`.

**Where:** `lens-server.js:709-719, 771-789, 759-770` (write/note paths for contrast);
`shared/lens-bridge.js:106-190` (the host sends the Lens name only for write/run/history,
not for reads).

**Why it matters to a forker:** The plan says Lens access is enforced on "every bridge call:
data, writes, runs, live, history". In code, a restricted user can call the read APIs directly
(TM1 security still applies to TM1, but the app-level Lens restriction does not). A Lens's
`config.access` cannot be used as a per-screen data boundary.

**Suggested fix:** Send the opened Lens name on every bridge call and run the read through
`visibleLens(req, lens)` before dispatch, or bind the session to the currently opened Lens and
reject reads for another Lens. Add a test with a Finance-only Lens and a non-Finance reader for
`execMDX`, `readCell`, `meta` and `elementTree`.

**Effort:** Medium.

### 1.3 The status filter is duplicated rather than owned by one function

**What:** The same publish/draft predicate appears in the home page, `/api/lenses`,
`/api/lens/lenses` and `visibleLens`, with different combinations. The recent path changes have
made the copies diverge.

**Where:** `lens-server.js:484-493, 700-707, 790-796, 821-830`.

**Why it matters to a forker:** A new route can easily copy one predicate and miss another, as
the direct routes already do. This is the access-control version of the "one obvious way"
problem.

**Suggested fix:** Move `visibleTo(doc, groups, showDrafts)` into `core/lens_store.js` and have
all list/open paths call it. Include the status and access checks in one tested predicate.

**Effort:** Small.

---

## 2. Lens editor: saved name and identity

### 2.1 After first save or rename, writes/runs still use the old `tab.name`

**What:** `LensEditor` initializes its name from `tab.name` and the host bridge's `getLens` is
`() => tab.name`. `save()` sends the typed `name` to the server but never patches the tab
(`patchTab`) or updates a saved-name state. For a new Lens, `tab.name` is empty before the
first save, so after a successful save the preview still believes there is no saved Lens and
`Lens.save` rejects with "save the Lens first". After a rename, write/run/history checks use the
old Lens document.

**Where:** `client/src/components/LensEditor.jsx:118, 186-192, 230-249`;
`shared/lens-bridge.js:72-175` (`getLens` used for write/run/history).

**Why it matters to a forker:** A Lens that was just saved cannot test its write-back or action
buttons until the tab is closed and reopened; a renamed Lens can accidentally run against the
old document. This is a normal authoring flow, not an edge case.

**Suggested fix:** Keep a `savedName` state; set it from `data.name` after save; use
`getLens: () => savedName`; and `patchTab(tab.id, { name: data.name, label: data.name })` so the
tab, explorer, and later reloads agree. Clear `savedName` only when creating a different Lens.

**Effort:** Small.

### 2.2 "Save draft" silently unpublishes an existing published Lens

**What:** `save(false)` sends `publish: false`; `saveLens` always sets `status = publish ?
'published' : 'draft'` instead of preserving the current status when the user only wants to
save edits.

**Where:** `client/src/components/LensEditor.jsx:230-249`;
`core/lens_store.js:124-145`.

**Why it matters to a forker:** Editing a published Lens and pressing the smaller "Save draft"
button removes it from the Lens app for everyone until it is published again. That may be
intentional, but it is not stated and is easy to do by accident.

**Suggested fix:** Either label the action "Unpublish and save draft", or preserve the existing
status when `publish` is omitted and provide a separate explicit unpublish action. Document the
choice in the editor.

**Effort:** Small.

### 2.3 Lens list loads fail silently in the editor

**What:** The editor's cube, example, Lens and existing-folder fetches use `.then(r => r.json())`
without checking `r.ok`; a 401/500 body becomes `[]` (or an object that `Array.isArray` rejects).
The user sees an empty start page, not an error or a sign-in prompt.

**Where:** `client/src/components/LensEditor.jsx:151-180`.

**Why it matters to a forker:** It hides an expired session or a broken `/api/lenses` route in
the same way the Find & Replace/Data Sources issues were hidden elsewhere. A new Lens appears to
have no examples and no existing Lenses.

**Suggested fix:** Use the shared fetch error wrapper (`extractError`) or check `r.ok`/`d.error`;
show an inline error with a retry/sign-in action. Only use the empty-list fallback after a
successful response.

**Effort:** Small.

---

## 3. Lens store and app error handling

### 3.1 One unreadable Lens document breaks the whole list

**What:** `lensStore.listLenses`/`listLensRuns` read every document in a loop without a
per-document `try/catch`. A corrupt/unreadable Lens document throws out of the loop and fails
the whole list; the home page catches it and shows a 500-style error.

**Where:** `core/lens_store.js:42-75`; home `lens-server.js:480-506`;
`/api/lenses` `lens-server.js:700-707`.

**Why it matters to a forker:** One damaged governance document makes every Lens unavailable,
including the editor's list and the Lens app home. The model-store rule is "missing data fails
loudly", but a single broken item should not take out the navigable list.

**Suggested fix:** Catch per document, report the bad name in a structured `errors` array, and
return the readable Lenses. The UI should show a small warning, not an empty/500 page.

**Effort:** Small.

### 3.2 `/api/lenses` has no async error handler

**What:** The route is `async` but has no `try/catch`; a rejected `listLenses` promise is not
handled by Express 4 and the request can hang or surface as an unhandled rejection. The other
Lens routes have try/catch.

**Where:** `lens-server.js:700-707`.

**Why it matters to a forker:** It is the only list route for the editor, and it fails in the
least diagnosable way. A model-store error or an expired session can leave the editor's request
open.

**Suggested fix:** Wrap it like `/api/lens/lenses` and the home route, return 500 (or 401 for a
session error) with a JSON error, and test a rejected `listLenses` stub.

**Effort:** Small.

### 3.3 Missing Lens-app config falls back to the example server

**What:** `loadConfig` catches a missing/unreadable `config/lens-app.json` and uses
`config/lens-app.example.json` (server `24Retail`) rather than failing closed. The doc says the
real config is required.

**Where:** `lens-server.js:38-57`.

**Why it matters to a forker:** Starting the Lens app without configuring it silently targets a
different server; if the example is kept in a repo/deployment, the app may point at an
unintended model rather than refusing to start.

**Suggested fix:** For a production path, fail with the actionable "create config/lens-app.json"
error when the real file is absent; only use the example in an explicit `--demo`/test mode. Add
a test for the missing-config behavior.

**Effort:** Small.

---

## 4. Toolkit and data model

### 4.1 `Lens.rows` does not understand `]]` in dimension names

**What:** `dimOf` extracts the dimension with `/^\[([^\]]+)\]/`, so a TM1 dimension name containing
`]` (escaped as `]]` in the unique name) is truncated. The row object is then keyed by the
partial name, and every grid/pivot built from `Lens.rows` sees the wrong dimension key.

**Where:** `shared/lens-kit/rows.js:12-18`; compare the `]]`-aware parser in
`shared/pivot/cellset.js:16-22`.

**Why it matters to a forker:** TM1 element and dimension names with brackets are valid, and the
rest of the repository already handles them; the toolkit's single data helper should use the
same parser. A forker copying `rows.js` will create subtly wrong table keys.

**Suggested fix:** Use the same `]]`-aware bracket pattern as the shared pivot and add a rows
test with a dimension name containing `]`.

**Effort:** Small.

### 4.2 The Lens app's own page CSS relies on a fallback that may be absent

**What:** The `signOutBar` theme swatches read `THEMES.base.light` and `THEMES.themes`; the mes
are expected to be complete. There is no test asserting every theme has both light and dark
colour keys, nor that every `THEMES.themes` entry has a `label`. A malformed theme file produces
undefined colours in a signed-in page rather than failing at build.

**Where:** `lens-server.js:230-260`; `shared/lens-themes.json`;
`core/lens_prefs.js:46-58` (`themeCss` assumes base + theme keys).

**Why it matters to a forker:** Theme data is a config file; a typo should be caught by a test,
not show undefined CSS variables. The editor and app both depend on these keys.

**Suggested fix:** Add a small test validating every theme's light/dark required keys and label,
and validate once at startup (throw a clear error).

**Effort:** Small.

### 4.3 The Lens toolkit is large and not obviously tree-shaken; check bundle weight as a fork cost

**What:** `shared/lens-kit/index.js` is 1,247 lines and pulls ECharts, AG Grid, React Flow +
dagre, and Alpine into one bundle. The built `static/lens-kit/lens-kit.js` is a multi-megabyte
asset. That is a deliberate toolkit choice, but there is no documented minimum or a smaller
starter for a read-only Lens.

**Where:** `shared/lens-kit/index.js:1-36`; `client/vite.lens-kit.config.js`;
`static/lens-kit/lens-kit.js`.

**Why it matters to a forker:** Every Lens, including a static board pack, loads the full grid,
flow and charting stack. The fork cost is mostly in this bundle, and there is no guidance on
which components to keep.

**Suggested fix:** Document the bundle composition and the supported components in
`docs/lenses/LENSES_PLAN.md`, and consider a smaller `lens-kit-core` entry for read-only Lenses
if the Vite config can split cleanly. Treat this as a feature decision, not a bug.

**Effort:** Medium (optional).

---

## 5. Docs and tests

### 5.1 The plan says access is enforced on every route; the code does not

**What:** `LENS_APP_PLAN.md` says Lens access (TM1 groups) is enforced on "every request
(home list, open, preview, and every bridge call: data, writes, runs, live, history)". The
implementation enforces it on some routes, not on direct draft open/preview/list or read bridge
calls.

**Where:** `docs/lenses/LENS_APP_PLAN.md:74`; `lens-server.js:607-861`.

**Why it matters to a forker:** The doc is the security contract a forker will copy; the code
currently gives a false assurance. Either implement the contract or narrow the doc to the paths
that are actually enforced.

**Suggested fix:** After fixing 1.1/1.2, the sentence can become true; add a test for each route
named in it. Until then, mark the unimplemented routes explicitly.

**Effort:** Small (doc change) plus the access fix above.

### 5.2 Tests cover the happy path and group access, but not draft/direct or bridge access

**What:** `lens-app.test.js` covers home draft hiding, toolkit version refusal, CSP, idle
sessions and group-filtered lists. It does not fetch a draft via `/lens/:name`,
`/lens-frame/:name`, `/api/lens/:name`, `/api/lenses` or `/api/lens/lenses`. It does not call
`exec-mdx`/`read-cell`/`meta` with a restricted Lens or no Lens. `lens-store.test.js` covers
save status but not a rename-after-save editor flow.

**Where:** `tests/lens-app.test.js:163-235`; `tests/lens-app-security.test.js:183-232`;
`tests/lens-store.test.js:30-55`.

**Why it matters to a forker:** The security suite's name suggests "every route" is checked,
but the bypass paths are untested. The LensEditor saved-name bug is also outside the server
tests.

**Suggested fix:** Add route tests for each direct draft endpoint and each bridge read with a
Finance-only Lens; add a small editor/state test (or pure helper) for the saved-name transition.

**Effort:** Medium.

### 5.3 The Workforce `tmp/` fixtures are not a reference path

**What:** `tmp/workforce/lens/out/*.html` contains real generated WFP Lens outputs. It is useful
as a lab record but is outside the documented `docs/lenses`/`shared/lens-examples` path, so a
forker may not find it, or may assume it is a supported template.

**Where:** `tmp/workforce/lens/out/`; the documented examples are in `shared/lens-examples`.

**Why it matters to a forker:** The real Workforce pages are the most useful examples of what a
Lens should look like, but they are in a temporary directory. That is an honest-docs/discoverability
gap for the area.

**Suggested fix:** Keep the generated output in `tmp/` (it is clearly temporary) but reference
one or two of the WFP Lenses from `docs/lenses/` as worked examples, or move a sanitized
example into `shared/lens-examples`.

**Effort:** Small.

---

## 6. Checked and found nothing (worth calling out)

- The Lens frame is served with its own CSP (`sandbox allow-scripts`, `connect-src 'none'`) and
  never `allow-same-origin`; the Lens app's iframe has `allow-scripts allow-modals` and no
  same-origin. The CSP/sandbox tests cover this.
- The bridge host answers only the exact iframe `event.source`, takes the server from host
  configuration, never from the message, and posts with `'*'`; the shared script is one copy for
  the IDE and Lens app.
- `writeCells` checks the saved Lens's declared cubes, full coordinates, numeric/text kind,
  calculated cells, duplicate cells, expected-value conflicts and the max cell count; it refuses
  the whole save on any error and runs as the signed-in user.
- `runProcess` checks the saved Lens's declared processes, validates parameter names/types and
  runs as the signed-in user; `addCellNote` checks declared cubes and cell readability.
- `canOpenLens` is case-insensitive and always allows ADMIN; empty `config.access` means everyone.
- Read/write/run/note activity is logged to `data/lens-activity.jsonl`; the cache/preferences are
  per-user and the live hub stamps sender identity and rate-limits events.
- Lens documents are stored in the model, not the IDE repo; `saveLens` validates names, folders,
  icons, colours, image types/size and config shape.
- No live TM1 server or REST call was used in this review.
