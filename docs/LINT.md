# Lint baseline

The client (`client/`) is linted with ESLint (`client/eslint.config.js`). This file
records the current baseline so the number can only go **down**.

Run it from `client/`:

```bash
npm run lint          # eslint .            — exits non-zero while any error remains
npm run lint:count    # prints the total number of lint problems
```

## Baseline

| | problems | errors | warnings |
|---|---|---|---|
| Before phase 1 | **324** | 219 | 105 |
| After phase 1  | **133** | 30 | 103 |

Phase 1 (mechanical, behaviour-neutral) cleared every one of:

- `no-unused-vars` (132) — unused locals/args/state setters/imports removed;
  where a value came from a call, only the binding was dropped and the **call kept**
  (e.g. `const saveView = useSaveView()` → `useSaveView()`), and omitted object keys
  were kept as `_name` so `...rest` still omits them.
- `react-hooks/rules-of-hooks` (18) — the Format Settings and Editor Preferences
  modals are now mounted only while open (`{open && <Modal … />}`) instead of bailing
  with `if (!open) return null`, so their hooks always run on mount.
- `react-hooks/static-components` (9) — `Status` (ModelHealth) and `GroupHeader`
  (Explorer) hoisted to top level; they hold no state, so props carry what they need.
- `no-empty` (17) — empty `catch {}` blocks now say why ignoring is safe.
- `no-useless-escape` (6), `no-case-declarations` (3), `no-undef` (3),
  `no-useless-assignment` (1).

## Phase 2 (left for later — needs per-case judgement + a click-through)

These can change when a screen refreshes or re-renders, so they are **not** part of
the mechanical baseline above:

- `react-hooks/exhaustive-deps` (56)
- `react-hooks/set-state-in-effect` (47)
- `react-hooks/refs` (20)
- `react-hooks/purity` (3)
- `react-hooks/preserve-manual-memoization` (3)
- `react-hooks/immutability` (1)
- `react-refresh/only-export-components` (3, warnings)

When fixing phase 2, commit file by file (as phase 1 did) and lower the "After
phase 1" row above to the new total.
