# Lenses — Stage 1 build plan

Branch: `lenses` (off the cube-map commit `8b2c4ec`).

Goal: **describe a screen → AI generates hand-rolled HTML → preview it live on real TM1 data in the IDE → save as a governed lens.** Read-only; no write-back in Stage 1.

## Scope (in)

1. **Storage — files + metadata cube (single source of metadata)**
   - Lens HTML lives in `config/lenses/<name>.html` (git-versionable, avoids TM1 string-cell limits).
   - **Metadata lives ONLY in the `}Lenses` control cube** (name, owner, version, status, updated). Do NOT also write `config/lenses/*.json` — a second metadata copy recreates the duplicate-list problem from the 17 function catalogs. Pick one; the cube is it.
   - `core/lens_store.js` (new): list/read/write lenses + cube metadata.
   - Routes: `GET /api/lenses`, `GET/POST /api/lenses/:name`.

2. **Runtime + bridge — the security core**
   - `GET /lenses/:server/:name` serves the lens inside a sandboxed iframe.
   - Bridge (`core/lens_bridge.js`, new, ~4 calls): `execMDX`, `readCell`, `getMeta`, all via `makeClient(server, req.ideToken)` — **per-user session, never the MCP admin path** (`makeClient(server, null)`).
   - Server-side validation on every bridge call: read-only in Stage 1, server allowlist.

3. **Authoring**
   - `client/src/components/LensEditor.jsx` (tab type `lens`): description → AI (existing `core/ai/registry`) → generated HTML → Monaco → live preview pane.
   - `client/src/lib/lens-bridge.js`: the postMessage contract the generated code calls.
   - `client/src/lib/lens-generator.js`: AI prompt — emits HTML using the bridge + tested query helpers.
   - **Validation gate on save**: parse the frame's bridge calls AND **test-run each query once against the live model** (parsing arbitrary AI-written JS will miss things; running it is the reliable check). Reject bad cube/dim/member names.
   - Wire-up: `EditorPane.jsx` dispatcher, `hooks/useApi.js`, `Explorer.jsx` open.

4. **First data helpers** — a tiny `lens-utils.js` (actual vs budget, variance) so generated numbers are correct, not raw MDX per lens.

## Out of scope (deliberately)

Write-back, sandboxes, filters/navigation, PAW embedding, guard-rail enforcement, MCP lens-builder tool. `/lenses/:name` keeps PAW embedding *possible*, not built.

## Security — non-negotiable

1. **CSP sandbox header on `/lenses/:server/:name`** (in addition to the iframe `sandbox` attribute):
   ```
   Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; connect-src 'none'
   ```
   The iframe `sandbox` attribute only applies inside the iframe. If someone opens the URL directly in a browser tab, AI-written script would otherwise run with full IDE-origin access and read `localStorage['tm1-token']`. The `sandbox` directive enforces the sandbox even at top level.
2. **Never add `allow-same-origin`** — not even "just to get it working". With `allow-scripts` it lets the frame escape the sandbox.
3. **The token never enters the frame.** Bridge messages go frame → IDE page → server. The IDE page attaches `req.ideToken`. The IDE page **checks `event.source === iframe.contentWindow`** and takes the server from the tab, **never from the message**.

## Explicit follow-up task (deploy pipeline)

The change-set pipeline only packages TM1 objects. Files in `config/lenses/` will NOT go with a deploy unless the packager learns about them. Add a task: extend `tools/tm1deploy/src/packager.js` (and diff) to carry lens files. Do not assume it happens.

## Build order

1. `lens_store` + routes (~half day)
2. Sandbox shell + CSP header + bridge + `lens_bridge.js` (2–4 days — the security-sensitive bit)
3. LensEditor tab: Monaco + preview + save (1–2 days)
4. AI generator + validation gate incl. query test-run (1–2 days + tuning loop)
5. Bundled D3/ECharts + `lens-utils` (1 day)

≈ 2 weeks.

## Verified before building (from code review)

- Per-user sessions already exist end-to-end on the route path (`makeClient(server, req.ideToken)`), for both paw-native and direct-v11. The bridge must follow the standard route pattern and never pass a `null` token.
- The MCP (`tools/tm1mcp/shared.js` `client()`) runs as admin/agent — it is the builder identity and must stay separate from the lens render path.
## Publishing a Lens into a PAW book — authentication (agreed 4 Oct 2026)

A Lens embedded in a PAW book (URL/web widget, HTTPS only) has no IDE page around it, so the bridge has no host and
no IDE token exists. Browsers also block cross-site cookies/storage, so a Lens on another server can't reuse the
viewer's PAW login.

**Principle: a published Lens runs as the viewer — never as the author, never as a shared account.** TM1 security
decides what each viewer sees, exactly as for the book around it.

| Option | Use |
|---|---|
| **A. Same origin as PAW** — publish the Lens as static files under PAW's HTTPS address (reverse-proxy path, e.g. `https://paw.company.com/lens/…`); the Lens calls PAW's TM1 API with the viewer's PAW session cookies + CSRF header. IDE not needed at runtime. | Preferred for v11 / on-prem PAW. Feasibility to check on the PAW lab (.37). |
| **B. OAuth authorization code** — Lens registered as a PAW "authorized application"; viewer signs in, token carries their identity (IBM-supported, interactive only). | Preferred for v12 / PAW cloud. |
| **C. Login inside the frame** — the Lens runtime shows its own sign-in; session token held in the frame's (partitioned) storage. | **Agreed fallback**, acceptable in some cases (other origins, quick deployments). Must never retry a rejected password (lockout). |
| D. Token in the URL | ❌ Never — leaks to logs, history, shared links. |
| E. Shared service account | ❌ Bypasses TM1 security — only for genuinely public data, labelled as such. |

Needed whichever option: a standalone **Lens runtime** (does the calls itself instead of via the IDE page), an HTTPS
certificate, and `Content-Security-Policy: frame-ancestors <PAW origin>` on the Lens page.
