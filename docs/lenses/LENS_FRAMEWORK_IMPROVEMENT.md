# Lens framework — improvement proposal

**Status:** proposal (25 Oct 2026). For discussion before build.
**Scope:** how Lenses fetch data, run actions, and stay thin — so MCP can build them
for any TM1 application without application logic living in HTML/JS.
**Related:** `docs/lenses/LENS_APP_PLAN.md`, `docs/models/WORKFORCE_MODEL.md`,
`docs/models/BUILDING_MODELS.md`, `docs/lenses/PIVOT_PLAN.md`, `core/lens_bridge.js`,
`core/lens_store.js`, `shared/lens-kit/`, `shared/pivot/`.

---

## 1. The problem

Workforce was the first real Lens application: 17 pages, a complex lifecycle and a
large model. It exposed the structural weakness:

- Each Lens writes its own **MDX**, filters, escaping, row shaping and business rules.
- Pages call `execMDX` and `writeCells` directly. The only server check is "is this
  cube declared?", not "is this write valid?".
- The same question is answered differently on different pages (roster vs hiring plan).
- Query construction is duplicated, untested, and impossible to review as code.
- Lenses are **code stored as data** in TM1 Applications; the sources are in an ignored
  `tmp/` folder, so there is no diff, review or reproducible build.
- Deployment does not carry Lenses or their config at all.

The result is a capable UI shell whose data layer is not a framework.

**Principle to adopt:** a Lens knows *what to show*, never *what is true* or *how to
fetch it*. Logic lives in the TM1 model and in a typed service catalog; the page only
renders.

---

## 2. Target architecture

```
Lens page (HTML/JS, manifest)
        │  list / describe / query / action
        ▼
Generic Lens bridge (Node)
        │  validates params, compiles, executes
        ▼
TM1 service catalog (model artefacts)
        ├─ query services  → MDX / declarative query spec
        └─ action services → TI processes
```

Three layers, one responsibility each:

| Layer | Owns | Must not own |
|---|---|---|
| TM1 model (rules/TI) | calculations, derived states, validation, writes | presentation |
| Service catalog | query shape, parameters, limits, permissions | layout |
| Lens page | layout, filters, formatting, messages | MDX, cube names, business rules |

The Node bridge is a **generic compiler/validator**, not an application. Moving logic
into Node would just create a second codebase.

---

## 3. The service contract

Every Lens gets the same four calls:

| Call | Returns |
|---|---|
| `services()` | the services this app exposes, with versions |
| `describe(service)` | parameters, result columns, limits, required groups |
| `query(service, params)` | `{ columns, rows, meta }` |
| `action(service, params)` | `{ result, message, detail }` (from `Lens Messages`) |

Errors are one shape: `{ code, message, detail?, retryable? }`.

No `execMDX`, no `writeCells`, no process names in production Lenses. The raw bridge
methods remain available only to IDE preview / developer tooling.

---

## 4. Service catalog

### 4.1 Where it lives

- **Source of truth:** git — `lenses/<app>/services.json`.
- **Runtime:** TM1 — a control dimension + cube (`Lens Service` × measures), so the
  catalog is part of the model, subject to TM1 security and visible to MCP.
- **Deploy:** the pipeline writes the catalog to the target from the git manifest, and
  baselines it like any other object. Direct edits in TM1 show as drift.

This keeps "logic in TM1" while keeping code review in git.

### 4.2 Catalog entry

```json
{
  "name": "wfp.roster",
  "type": "query",
  "version": 1,
  "groups": ["WFP HR", "WFP Finance", "ADMIN"],
  "params": {
    "version":    { "type": "member", "dimension": "WFP Version", "enum": ["Forecast","Budget","Downside"] },
    "costCentre": { "type": "member", "dimension": "WFP Cost Centre" },
    "month":      { "type": "period", "dimension": "WFP Period" }
  },
  "query": {
    "kind": "spec",
    "cube": "WFP Position Map",
    "rows": ["WFP Position"],
    "columns": [],
    "filters": {
      "WFP Version": "{{version}}",
      "WFP Period": "{{month}}",
      "WFP Cost Centre": "{{costCentre}}"
    },
    "measures": ["Seat Status", "Home Entity", "Grade", "Location", "Seat FTE"],
    "limitCells": 20000
  },
  "result": {
    "columns": ["position","status","person","fte","grade","location","plan"],
    "row": "rosterRow"
  }
}
```

### 4.3 Two kinds of query

- **Declarative spec (default).** Cube, rows, columns, filters, measures. The bridge
  compiles it with the shared pivot MDX builder. Safe, no interpolation of raw text.
- **MDX template (complex only).** A named MDX string with typed placeholders
  (`{{period}}`, `{{cc}}`). The bridge substitutes only validated members. Use when the
  question cannot be expressed as a spec (multi-cube, conditional sets).

Both are catalog artefacts. Neither is written by the page.

### 4.4 Actions

Actions map a service name to a TI process and a parameter schema:

```json
{
  "name": "wfp.assign",
  "type": "action",
  "version": 1,
  "groups": ["WFP HR", "WFP Finance"],
  "process": "WFP Assign Person",
  "params": {
    "version":  { "type": "member", "dimension": "WFP Version" },
    "position": { "type": "member", "dimension": "WFP Position" },
    "employee": { "type": "member", "dimension": "WFP Employee", "optional": true },
    "name":     { "type": "string", "max": 80, "optional": true },
    "from":     { "type": "period" },
    "fte":      { "type": "number", "min": 0.1, "max": 1 },
    "salary":   { "type": "number", "min": 0, "optional": true }
  },
  "result": "lensMessage"
}
```

All validation, guards and writes stay in the TI. The page only supplies parameters.

---

## 5. The Lens

### 5.1 Manifest, not hand-built queries

```json
{
  "app": "workforce",
  "uses": ["wfp.roster", "wfp.assign", "wfp.end", "wfp.transfer", "wfp.move"],
  "pages": [{
    "name": "roster",
    "layout": ["filters", "table", "actions"],
    "bindings": {
      "filters": ["version", "costCentre", "month"],
      "table": "wfp.roster",
      "actions": ["wfp.assign", "wfp.end", "wfp.transfer", "wfp.move"]
    }
  }]
}
```

The framework renders the manifest from components: table/pivot, KPI, chart, form,
timeline, filters, action bar. Flexibility comes from layout and bindings, not from
each page inventing data access.

A page can bind **several services** — one per widget (KPI, chart, table). A
**composite service** may return a page bundle for latency, but it is still a catalog
service, not logic in the page.

### 5.2 Escape hatch

Hand-written HTML is allowed for a one-off layout, but it may call only `query` and
`action`. It gets no raw MDX or cell writes. This keeps the framework honest without
making every visual a component.

### 5.3 Config vs environment

Keep them apart:

- **Behaviour/config in the Lens:** layout, bindings, labels, declared services.
- **Environment overlay:** default version, cost centre, home target, access groups,
  approvers. In `config/lens-env/<server>.json`, applied at deploy.

Never deploy dev group names or a dev cost centre as production config.

---

## 6. Parameters, limits and safety

- Parameter types: `member` (dimension-scoped), `period`, `enum`, `number`, `string`,
  `memberList`. Every member is resolved against its dimension before use.
- No raw text interpolation into MDX. Tokens are replaced with validated member
  literals using one builder.
- Limits per service: max rows/cells, timeout, optional cache TTL. The bridge enforces
  the 20k-cell ceiling and returns `truncated` as an error, never partial data.
- Every query declares its result columns; the page renders those names, not raw axes.
- Unknown parameters, missing required values and out-of-range values are refused
  server-side.

---

## 7. Security

- Services run with the **signed-in user's TM1 session**. TM1 security remains the data
  boundary.
- Catalog `groups` is a second gate; the bridge refuses a service the user may not use.
- A Lens declares the services it uses; the bridge refuses anything not declared.
- Production Lenses cannot call `execMDX` or `writeCells`.
- Lens documents and the service catalog live in TM1 Applications / control objects;
  only admins author them. The Lens app remains read/serve plus declared actions.
- Config is UI policy, not data permission. Never store credentials or tokens in it.

---

## 8. Deployment and versioning

Add two object types to the existing git deploy pipeline (`tools/tm1deploy`):

- `lens` — the Lens document (HTML + config + metadata), fetched from the source
  server's Applications store and saved on the target.
- `lens-service` — a catalog entry, generated from `services.json`.

Both join the baseline, diff, risk check and package. `DEPLOY_ORDER` runs them **last**,
after cubes, processes, views and subsets so every declared dependency exists.

Versioning:

- **Toolkit version** (already exists) — the page can refuse a bridge it cannot run.
- **Service contract version** — a Lens declares `requires: { serviceApi: 1 }`; the
  bridge refuses a mismatch.
- **Config overlay** per target (section 5.3).

Drift: a Lens or service edited directly in TM1 is detected against the baseline,
exactly like a rule.

---

## 9. Testing and observability

- **Service tests are model assertions.** Each service has at least one query and
  expected rows/values; they run with the normal assertion suite.
- **Query builder tests** use fixtures (no server); the MDX and row mapping are unit
  tested.
- **No live scripts in `npm test`.** Live integration scripts are `live-*.js` and
  require `LIVE=1` (this rule is now in `BUILDING_MODELS.md`).
- One log line per invoke: app, service, params, ms, rows, outcome. Errors include
  service, params and TM1 message.
- Optional cache and dedupe keyed by service + params; invalidated by writes to the
  affected cubes (or a short TTL).

---

## 10. MCP workflow

1. **Introspect** cubes, dimensions, measures, rules and public views.
2. **Propose services** (spec or MDX + parameter schema) and result columns.
3. **Create catalog entries** in dev and a service test.
4. **Generate the Lens** from components and the service bindings.
5. **Save** the Lens and run its service tests.
6. **Publish**: export `services.json` and the Lens sources to git; the deploy pipeline
   writes them to test/prod.

The framework is application-agnostic; only the catalog and the pages are
application-specific.

---

## 11. Migration plan

**Phase 1 — one vertical slice**
- Add the catalog (control objects) and the generic `query`/`action` bridge.
- Implement **`wfp.roster`** and render the Position roster read-only from it.
- Success: no MDX in that page; same numbers as today; one service test.

**Phase 2 — actions and the rest of Workforce**
- Implement `wfp.assign`, `wfp.end`, `wfp.transfer`, `wfp.move`, `wfp.approve` as
  catalog actions.
- Migrate the remaining pages; delete raw MDX and direct `writeCells` from production
  Lenses.
- One lifecycle page; the roster/hiring/leavers/transfers views bind to the same
  services.

**Phase 3 — deployment**
- Add `lens` / `lens-service` to the deploy pipeline and baseline.
- Move Lens sources into `lenses/<app>/`; CI builds the HTML; deploy the built files.
- Environment config overlays.

**Phase 4 — second application**
- Prove the framework, not the app: a small second TM1 app built entirely by MCP from
  the same catalog + components.

---

## 12. Rules and anti-patterns

1. **No MDX in a Lens page.** If a page needs a query, it is a service.
2. **No business rule in JS.** Rules, derived states and validation live in TI/rules.
3. **No direct cell writes in production.** Writes are actions.
4. **No cube or process names in a page.** Only service names.
5. **No page-specific logic in the bridge.** The bridge compiles and validates; it does
   not know Workforce.
6. **No secrets in config.** Ever.
7. **No live scripts in unit tests.**
8. **No Lens deployed with dev config.** Use the environment overlay.

---

## 13. Open decisions

1. **Catalog storage:** control dimension/cube (recommended) vs JSON files in
   Applications. Control objects are easier to secure and deploy; JSON is easier to
   diff.
2. **Declarative spec vs MDX templates:** spec for the common case; how much template
   escape hatch is allowed before it becomes the default?
3. **Composite services:** one call per page for latency, or keep one service per
   widget? (Recommend widget services first, composite only where measured.)
4. **Caching:** TTL vs invalidation on write; per-user vs shared (security-sensitive).
5. **Lens HTML:** generate from a manifest, or keep hand-written HTML with bindings?
   (Recommend manifest for standard pages, escape hatch for one-offs.)
6. **Write concurrency:** do services require an expected version/timestamp, or is TI
   validation enough?
7. **Transactional workflow state:** TM1 or SQL? If approvals/audit must be
   transactional, SQL is the better system of record.

---

## 14. Appendix — what stays, what changes

| Today | Target |
|---|---|
| `Lens.pivot` with a spec | keep; becomes the server-side spec compiler |
| `Lens.grid`, `Lens.run`, `Lens.save` | keep as components; `query`/`action` underneath |
| `call('execMDX')` in pages | developer preview only |
| `Lens.save` `writeCells` in business Lenses | removed; actions only |
| `tmp/workforce/lens/build.js` | moves to `lenses/<app>/` and runs in CI |
| Lenses in TM1 Applications only | git source + TM1 runtime + deploy pipeline |
| `config` (all settings) | behaviour config + per-target environment overlay |
| bespoke jsdom checks | service tests + query builder unit tests + fixtures |
| `npm test` running live scripts | scoped to `tests/`; live scripts `LIVE=1` |
