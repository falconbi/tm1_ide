# Known Issues — TM1 IDE

Generated: 2026-05-23
Updated: 2026-05-23

---

## 1. Server Process Persistence (ONGOING PROBLEM)

**Problem:** The backend (`node server.js`) and frontend Vite dev server (`vite --host`) keep dying when terminal sessions end. Every time we make code changes, I have to restart the Vite server because it serves cached JS.

**Current workaround:** Using `setsid` + `nohup`:
```bash
setsid sh -c 'cd /home/jdlove/apps/tm1_ide && nohup node server.js > /tmp/tm1-backend.log 2>&1' &
setsid sh -c 'cd /home/jdlove/apps/tm1_ide/client && nohup npx vite --host > /tmp/tm1-frontend.log 2>&1' &
```

**Root cause:** No `tmux`, `screen`, or systemd service. Also, Vite caches aggressively in `node_modules/.vite` and browser modules.

**Proper fix needed:**
- Install `tmux` or `screen` and run servers inside a persistent session
- OR create a `systemd` service file for automatic start/restart
- OR install `pm2` (Node process manager)

**Developer impact:** After every code change, need to:
1. Kill old Vite process
2. Restart Vite with `setsid`
3. Hard-refresh browser (`Ctrl+Shift+R`)

---

## 2. Ctrl+S Not Saving Rules (FIXED — awaiting verification)

**Problem:** In the Rules Editor, pressing `Ctrl+S` opened the browser's "Save Page" dialog instead of saving rules to TM1.

**Root cause:** Monaco's `editor.addCommand()` with `KeyMod.CtrlCmd | KeyCode.KeyS` was overridden by the browser's native save shortcut.

**Fix applied:** Switched to `editor.onKeyDown()` handler that calls `e.browserEvent.preventDefault()` and `e.browserEvent.stopPropagation()` before triggering the save mutation.

**File:** `client/src/components/EditorPane.jsx`

**Status:** Fixed in code, but needs browser test after Vite restart.

---

## 3. Area Prefix Capitalization n: → N: (FIXED — awaiting verification)

**Problem:** When Capitalization Style is set to "IBM Official", `n:`, `c:`, `s:` were not being uppercased to `N:`, `C:`, `S:`.

**Root cause:** The `normalizeCapitalization` function only handled `identifier` and `keyword` token types. `area_prefix` was a separate token type that was skipped.

**Fix applied:** Added explicit handling for `token.type === 'area_prefix'` in `normalizeCapitalization`:
```js
if (token.type === 'area_prefix') {
  if (settings.capitalization === 'ibmOfficial') return token.value.toUpperCase()
  // ... etc
}
```

**File:** `client/src/lib/formatters/rules-formatter.js`

**Status:** Fixed in code, but needs browser test after Vite restart.

---

## 4. Format Document Feature (COMPLETE REWRITE — token-aware)

**What was built:**
- New module `client/src/lib/formatters/` with:
  - `tokenizer.js` — character-by-character tokenizer for TM1 rules
  - `rules-formatter.js` — token-aware engine with configurable spacing
  - `presets.js` — Compact, Standard, Expanded presets
  - `settings.js` — localStorage persistence for format options
  - `naming.js` — IBM official naming dictionary (~100 functions), editable by user
  - `colours.js` — per-token syntax colouring for Monaco editor
  - `index.js` — public API

**UI:**
- `FormatSettings.jsx` modal with tabs: General | Rules | TI Process | Colours
- Live Preview showing formatted output in real-time
- Editable Naming Dictionary with import/export JSON
- Colour pickers for each token type (keywords, functions, strings, dim vars, etc.)

**Integration:**
- Replaced old regex formatter in `tm1-functions.js`
- Wired into Monaco `registerDocumentFormattingEditProvider`
- `Ctrl+Shift+F` triggers new formatter

**Status:** Code compiles cleanly. Needs real-world testing on production rules. Area prefix fix pending verification.

---

## 5. Show in Explorer Tree Feature (IMPLEMENTED)

**Feature:** MapPin button in DimensionEditor, SubsetEditor, ViewEditor.

**Files:**
- `client/src/store/index.js` — `revealTarget` state
- `client/src/App.jsx` — auto-show sidebar
- `client/src/components/Explorer.jsx` — auto-expand + scroll + highlight
- `client/src/components/DimensionEditor.jsx` — MapPin
- `client/src/components/SubsetEditor.jsx` — MapPin
- `client/src/components/ViewEditor.jsx` — MapPin

**Status:** Implemented. Needs in-browser testing.

---

## 6. Firefox Cannot Connect to localhost:5173 (RESOLVED)

**Workaround:** Use `http://127.0.0.1:5173/` instead of `localhost`.

**Status:** Confirmed working.

---

## 7. Missing Import in App.jsx (FIXED)

**Problem:** `PanelGroup` not defined — missing import from `react-resizable-panels`.

**Fix:** Added import line.

**Status:** Resolved.

---

## Summary

| Issue | Status | Notes |
|-------|--------|-------|
| Servers dying | Workaround | Needs `tmux`/`systemd`/`pm2` |
| Ctrl+S not saving | **Fixed in code** | Awaiting browser verification |
| n: → N: not working | **Fixed in code** | Awaiting browser verification |
| Format Document | **Rewritten** | Needs real-world rules testing |
| Format Settings UI | **Implemented** | Live preview, naming dict, colours |
| Show in Tree | **Implemented** | Needs browser testing |
| Firefox localhost | Resolved | Use 127.0.0.1 |
| PanelGroup crash | Resolved | Missing import added |

---

## Recommended Actions

1. **Set up persistent servers** — install `tmux` or create systemd service
2. **Hard-refresh browser** (`Ctrl+Shift+R`) after Vite restart
3. **Test Ctrl+S** in Rules Editor
4. **Test n: → N:** with IBM Official capitalization
5. **Test Format Document** on real cube rules
6. **Commit everything** once verified: `git add . && git commit -m "feat: format settings, naming dict, colours, show in tree"`
