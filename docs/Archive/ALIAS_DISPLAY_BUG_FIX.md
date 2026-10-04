# Alias Display Bug Fix

## Problem

Selecting an alias attribute on a row dimension pill in ViewEditor did not update
the HierarchyGrid cell labels. The alias values were fetched from the TM1 API but
never appeared in the grid, despite repeated attempts over several days.

## Root Cause

**Missing auth header on the alias-values API call.**

ViewEditor.jsx has `handleAliasChange`, an async callback that:

1. Updates `dimAliases` state (dimension → alias attribute name)
2. Fetches alias values from `GET /api/dimension/alias-values`
3. Stores the result in `aliasValueMaps` (keyed by `"dim:attr"`)

The fetch at step 2 used a plain `fetch(url)` call with **no `x-ide-token` header**.
The Express backend has a middleware (server.js:68-77) that checks for this header
on every `/api/*` route and returns **401 Unauthorized** if missing.

All other API calls in the app (e.g. `useApi.js:15-18`) go through helper functions
(`get`, `post`, etc.) that automatically set the header:

```js
const authHeader = () => ({ 'x-ide-token': localStorage.getItem('tm1-token') ?? '' })
const get = (url) => fetch(url, { headers: authHeader() }).then(...)
```

Because `handleAliasChange` used a raw `fetch()` without this header, the server
rejected the request. The `catch {}` block was **empty**, silently swallowing the
error — no toast, no console warning, nothing visible to the user.

The downstream code in `displayHierarchies` → `applyAliasToNodes` was correct;
it just never received any alias data because `aliasValueMaps` remained empty.

## Fix

**File:** `client/src/components/ViewEditor.jsx`

Added the `x-ide-token` header from localStorage to the fetch call inside
`handleAliasChange`:

```js
const token = localStorage.getItem('tm1-token') ?? ''
const r = await fetch(
  `/api/dimension/alias-values?server=${encodeURIComponent(tab.server)}&dimension=${encodeURIComponent(dim)}&alias=${encodeURIComponent(attr)}`,
  { headers: { 'x-ide-token': token } }
)
```

## Lesson

Every new `fetch()` call in the frontend must include the `x-ide-token` header,
either by using the `get`/`post`/`patch`/`del` helpers from `useApi.js`, or by
manually setting it. An empty `catch {}` block should be avoided — at minimum
the error should be logged with `console.warn`.
