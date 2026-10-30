# Formatter, Themes & Settings — Design Document

**Status:** Draft — awaiting sign-off before implementation  
**Author:** OpenCode  
**Date:** 2026-05-23

---

## 1. Goals

- Make formatting a **first-class feature**, not a bolt-on regex hack
- Support **TM1 Rules** and **TI Processes** with separate, purpose-built engines
- Allow **deep customization** — every spacing decision is configurable
- Provide **live preview** so developers see changes before applying
- Persist settings per-user via `localStorage`
- Bundle **editor font/theme options** into the same settings panel for a cohesive experience

---

## 2. Module Structure

```
client/src/lib/formatters/
  index.js              # Public API: format(text, type, options)
  rules-formatter.js    # Token-aware TM1 Rules engine (AST-based)
  ti-formatter.js       # Token-aware TI Process engine
  presets.js            # Built-in presets: Compact, Standard, Expanded, Custom
  settings.js           # localStorage persistence, defaults, validation
  naming.js             # IBM TM1 official naming/capitalization database

client/src/components/
  FormatSettings.jsx    # Settings modal (General / Rules / TI tabs)
  FormatPreview.jsx     # Live before/after Monaco mini-editor
  ThemeSettings.jsx     # Font family, size, line height, UI accent color
```

---

## 3. Rules Formatter Engine

### 3.1 Why Token-Aware?

The current formatter is line-by-line regex. This breaks:
- String literals (`'key=value'` → `'key = value'`)
- `!Dimension` names (`!Account` → `! Account`)
- Multi-char operators (`<>`, `=>`, `>=`)

**Solution:** A lightweight tokenizer that understands TM1 grammar.

### 3.2 Token Types

| Token | Examples |
|-------|----------|
| `AREA_PREFIX` | `N:`, `C:`, `S:` |
| `COMMENT` | `// ...`, `# ...` (but NOT `#Region` / `#EndRegion`) |
| `DIRECTIVE` | `#Region`, `#EndRegion` |
| `STRING` | `'Single-quoted string'` |
| `DIM_VAR` | `!organization`, `!Month`, `!Version` |
| `NUMBER` | `100`, `-0.5`, `1E6` |
| `OPERATOR` | `=`, `<>`, `>=`, `<=`, `=>`, `+`, `-`, `*`, `/`, `%`, `&`, `\|` |
| `PUNCTUATION` | `(`, `)`, `[`, `]`, `{`, `}`, `,`, `;` |
| `IDENTIFIER` | `DB`, `ATTRS`, `IF`, `CONTINUE`, cube names, member names |
| `KEYWORD` | `IF`, `ELSEIF`, `ELSE`, `ENDIF`, `FEEDERS`, `SKIPCHECK` |

### 3.3 Parse Strategy

Each line is parsed independently into:
```
[AreaPrefix] [Expression] [Semicolon] [Comment]
```

The **Expression** is parsed into a tree for formatting decisions:
- Simple value: `100`
- Function call: `DB('cube', !dim1, 'member')`
- Binary expression: `x <> 0`
- IF call: `IF(condition, trueExpr, falseExpr)`
- Nested combinations of the above

### 3.4 Formatting Options (Rules)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `indentStyle` | `spaces2` \| `spaces4` \| `tab` | `spaces2` | Indent character |
| `areaPrefixSpacing` | `none` \| `single` \| `double` | `single` | `N:IF` vs `N: IF` vs `N:  IF` |
| `functionCallSpacing` | `compact` \| `standard` \| `expanded` | `standard` | `DB(a,b)` vs `DB(a, b)` vs `DB( a, b )` |
| `commaSpacing` | `none` \| `single` | `single` | `,` vs `, ` |
| `semicolonSpacing` | `none` \| `single` | `none` | `;` vs `; ` |
| `operatorSpacing` | `compact` \| `standard` | `standard` | `x=0` vs `x = 0` |
| `alignEquals` | `boolean` | `false` | Vertically align `=` within a `#Region` block |
| `lineWrap` | `off` \| `80` \| `120` \| `160` | `off` | Max line length before breaking |
| `wrapIndent` | `same` \| `hanging` | `hanging` | How to indent wrapped lines |
| `ifFormatting` | `inline` \| `multiline` | `inline` | Keep `IF(a, b, c)` on one line or break |
| `capitalization` | `asIs` \| `ibmOfficial` \| `lower` \| `upper` | `asIs` | See §4 |
| `preserveComments` | `boolean` | `true` | Never alter comment content |
| `preserveStrings` | `boolean` | `true` | Never alter string literal content |

### 3.5 Example Outputs

**Input:**
```tm1
['Indirect COGS'] = n:IF(DB('Supply Chain', !organization, !Channel, !product, !Month, !Year, 'Units Sold', !Version) <> 0, DB('Supply Chain', !organization, !Channel, !product, !Month, !Year, 'Indirect Costs', !Version), CONTINUE);
```

**Compact preset:**
```tm1
N:IF(DB('Supply Chain',!organization,!Channel,!product,!Month,!Year,'Units Sold',!Version)<>0,DB('Supply Chain',!organization,!Channel,!product,!Month,!Year,'Indirect Costs',!Version),CONTINUE);
```

**Standard preset:**
```tm1
N: IF(DB('Supply Chain', !organization, !Channel, !product, !Month, !Year, 'Units Sold', !Version) <> 0, DB('Supply Chain', !organization, !Channel, !product, !Month, !Year, 'Indirect Costs', !Version), CONTINUE);
```

**Expanded preset (inline):**
```tm1
N: IF(
  DB('Supply Chain', !organization, !Channel, !product, !Month, !Year, 'Units Sold', !Version) <> 0,
  DB('Supply Chain', !organization, !Channel, !product, !Month, !Year, 'Indirect Costs', !Version),
  CONTINUE
);
```

**Expanded preset (multiline):**
```tm1
N: IF(
  DB(
    'Supply Chain',
    !organization,
    !Channel,
    !product,
    !Month,
    !Year,
    'Units Sold',
    !Version
  ) <> 0,
  DB(
    'Supply Chain',
    !organization,
    !Channel,
    !product,
    !Month,
    !Year,
    'Indirect Costs',
    !Version
  ),
  CONTINUE
);
```

---

## 4. IBM TM1 Official Naming / Capitalization

### 4.1 Problem

IBM has changed capitalization conventions over time:
- `DB()` → `Db()` → `DB()`
- `CellGetN()` → `CellGetn()` → `CellGetN()`
- `ATTRS()` → `Attrs()` → `ATTRS()`
- `IF` vs `If` vs `if`

Developers often inherit code written in different eras and want a quick way to normalize to "current IBM official" style.

### 4.2 Solution: A Naming Dictionary

A hardcoded mapping of **canonical IBM official names** for:
- **Rule functions:** `DB`, `ATTRS`, `ATTRN`, `IF`, `ELSEIF`, `ELSE`, `ENDIF`, `CONTINUE`, `FEEDERS`, `SKIPCHECK`, `STET`, etc.
- **TI functions:** `CellGetN`, `CellGetS`, `CellPutN`, `CellPutS`, `ASCIIOutput`, `ProcessBreak`, `ItemReject`, etc.
- **Keywords:** `BREAK`, `WHILE`, `DO`, `END`, `IF`, `ELSEIF`, `ELSE`, `ENDIF`

**Capitalization options:**

| Option | Behavior | Example |
|--------|----------|---------|
| `asIs` | Leave identifiers exactly as typed | `Db('cube')` stays `Db('cube')` |
| `ibmOfficial` | Map to IBM's current official capitalization | `Db('cube')` → `DB('cube')`, `cellgetn` → `CellGetN` |
| `lower` | Force all identifiers to lowercase | `DB('cube')` → `db('cube')` |
| `upper` | Force all identifiers to uppercase | `Db('cube')` → `DB('CUBE')` |

**Important:** Only applies to **known TM1 identifiers**. User-defined names (cube names, dimension names, member names, variable names) are never altered.

### 4.3 Implementation

```js
// naming.js
const IBM_OFFICIAL = {
  // Rules
  'DB': 'DB',
  'Db': 'DB',
  'db': 'DB',
  'ATTRS': 'ATTRS',
  'Attrs': 'ATTRS',
  'attrs': 'ATTRS',
  'ATTRN': 'ATTRN',
  'IF': 'IF',
  'If': 'IF',
  'if': 'IF',
  'ELSEIF': 'ELSEIF',
  'ElseIf': 'ELSEIF',
  'elseif': 'ELSEIF',
  'ELSE': 'ELSE',
  'Else': 'ELSE',
  'ELSE': 'ELSE',
  'ENDIF': 'ENDIF',
  'EndIf': 'ENDIF',
  'endif': 'ENDIF',
  'CONTINUE': 'CONTINUE',
  'Continue': 'CONTINUE',
  'continue': 'CONTINUE',
  'FEEDERS': 'FEEDERS',
  'Feeders': 'FEEDERS',
  'feeders': 'FEEDERS',
  'SKIPCHECK': 'SKIPCHECK',
  'STET': 'STET',
  // TI
  'CellGetN': 'CellGetN',
  'CellGetn': 'CellGetN',
  'cellgetn': 'CellGetN',
  'CellGetS': 'CellGetS',
  'CellPutN': 'CellPutN',
  'CellPutS': 'CellPutS',
  'ASCIIOutput': 'ASCIIOutput',
  'ASCIIOUTPUT': 'ASCIIOutput',
  'ProcessBreak': 'ProcessBreak',
  'PROCESSBREAK': 'ProcessBreak',
  'ItemReject': 'ItemReject',
  // ... etc
}
```

When `capitalization: 'ibmOfficial'` is set, every identifier token is looked up in this map. If found, it's replaced with the canonical form. If not found (user-defined name), it's left as-is.

### 4.4 User-Editable Naming Dictionary

The IBM naming dictionary is **not hardcoded** — it ships with a default set, but developers can:

1. **Add new mappings** — e.g., your team uses `GetCubeN` as a custom alias for `CellGetN`
2. **Edit existing mappings** — e.g., prefer `Db()` over `DB()` if that's your house style
3. **Remove mappings** — if you don't want a particular identifier normalized
4. **Import / Export** — share a `.tm1names.json` file across your team

**localStorage schema:**
```js
{
  version: 1,
  customEntries: {
    'GetCubeN': 'CellGetN',      // your team's alias
    'Db': 'DB',                  // override: you prefer DB
  },
  disabledDefaults: ['STET'],   // don't normalize STET
}
```

**Merge logic at runtime:**
1. Start with the built-in `IBM_OFFICIAL` defaults
2. Override with user's `customEntries`
3. Remove any keys in `disabledDefaults`

**UI:** A small "Edit Naming Dictionary" button in the Format Settings modal opens a panel with:
- A table: `Input form` → `Normalized form` (editable rows)
- "Add row" / "Remove row" / "Reset to defaults"
- Import / Export JSON buttons

---

## 5. TI Process Formatter

### 5.1 Differences from Rules

- No area prefixes (`N:`, `C:`, `S:`)
- No `=` assignment in rules sense — uses `=` for variable assignment and equality
- More procedural: loops, conditionals, file I/O
- Has `#****Begin:` / `#****End:` metadata blocks that must be preserved exactly

### 5.2 Token Types

| Token | Examples |
|-------|----------|
| `COMMENT` | `# ...` |
| `METADATA_BLOCK` | `#****Begin: Metadata` |
| `STRING` | `'...'` |
| `NUMBER` | `100`, `-0.5` |
| `VARIABLE` | `vValue`, `pParam` |
| `OPERATOR` | `=`, `<>`, `>=`, `+`, etc. |
| `IDENTIFIER` | `CellGetN`, `ASCIIOutput`, cube names |
| `KEYWORD` | `IF`, `WHILE`, `DO`, `BREAK`, `END`, `ELSEIF`, `ELSE` |

### 5.3 Formatting Options (TI)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `indentStyle` | `spaces2` \| `spaces4` \| `tab` | `spaces2` | Indent character |
| `keywordCase` | `asIs` \| `ibmOfficial` \| `lower` \| `upper` | `asIs` | Same naming normalization |
| `functionCallSpacing` | `compact` \| `standard` \| `expanded` | `standard` | Same as rules |
| `commaSpacing` | `none` \| `single` | `single` | Same as rules |
| `operatorSpacing` | `compact` \| `standard` | `standard` | Same as rules |
| `lineWrap` | `off` \| `80` \| `120` \| `160` | `off` | Max line length |
| `preserveMetadataBlocks` | `boolean` | `true` | Never reformat `#****Begin/End` lines |
| `alignAssignments` | `boolean` | `false` | Align `=` in consecutive variable assignments |

---

## 6. UI Design

### 6.1 Entry Points

**Editor toolbar:**
```
Format ▼
  ├─ Format Document          (Ctrl+Shift+F)
  ├─ Format Selection
  ├─ ─────────────────────
  └─ Format Settings…
```

**App header gear icon:**
```
Settings
  ├─ Editor (font, theme, tab size)
  ├─ Formatting (rules + TI presets/options)
  └─ Shortcuts
```

### 6.2 Settings Modal Layout

```
┌────────────────────────────────────────────────────────────┐
│  Format Settings                                    [×]    │
├────────────────────────────────────────────────────────────┤
│  Preset: [ Standard ▼]  [Compact] [Expanded] [Custom]     │
├───────────────────┬────────────────────────────────────────┤
│  General          │  Live Preview                          │
│  ───────────────  │  ┌──────────────────────────────────┐  │
│  [●] Rules        │  │  Before                          │  │
│  [ ] TI Process   │  │  N:IF(DB('a',!b),CONTINUE);     │  │
│                   │  │  ──────────────────────────────  │  │
│  Rules            │  │  After                           │  │
│  ───────────────  │  │  N: IF(DB('a', !b), CONTINUE);  │  │
│  Indent: [2sp ▼] │  └──────────────────────────────────┘  │
│  Area prefix:     │                                        │
│    ○ N:IF        │                                        │
│    ● N: IF       │                                        │
│    ○ N:  IF      │                                        │
│                   │                                        │
│  Function calls:  │                                        │
│    ○ Compact     │                                        │
│    ● Standard    │                                        │
│    ○ Expanded    │                                        │
│                   │                                        │
│  [●] Align =     │                                        │
│  [ ] Line wrap   │  [80 / 120 / 160]                     │
│                   │                                        │
│  Capitalization:  │                                        │
│    ● As-is       │                                        │
│    ○ IBM Official│                                        │
│    ○ lowercase   │                                        │
│    ○ UPPERCASE   │                                        │
│                   │                                        │
│  [ Reset to Defaults ]  [ Save ]                           │
└────────────────────────────────────────────────────────────┘
```

### 6.3 Live Preview

A Monaco mini-editor (read-only, ~8 lines tall) showing:
- **Before:** A representative sample of TM1 rules/TI code
- **After:** The same sample formatted with current settings

Updates in real-time as the user changes options.

---

## 7. Fonts & Themes

### 7.1 Editor Fonts

| Option | CSS `font-family` |
|--------|-------------------|
| Geist Mono (default) | `'Geist Mono', monospace` |
| Fira Code | `'Fira Code', monospace` |
| JetBrains Mono | `'JetBrains Mono', monospace` |
| Cascadia Code | `'Cascadia Code', monospace` |
| Consolas | `Consolas, monospace` |
| Courier New | `'Courier New', monospace` |
| Custom | User-entered string |

**Settings:**
- Font size: 10–18px slider
- Line height: 1.2–2.0 slider

### 7.2 Monaco Themes

- `vs` (light)
- `vs-dark` (dark) — default
- `hc-black` (high contrast)

### 7.3 UI Accent Colors

Swap the primary color hue:
- Blue (current)
- Green
- Orange
- Purple
- Red

This just rotates the `--primary` HSL in the CSS variables.

---

## 8. Data Persistence

```js
// settings.js — localStorage schema
const STORAGE_KEY = 'tm1-ide-format-settings'

const defaultSettings = {
  version: 1,
  rules: {
    preset: 'standard',
    indentStyle: 'spaces2',
    areaPrefixSpacing: 'single',
    functionCallSpacing: 'standard',
    commaSpacing: 'single',
    semicolonSpacing: 'none',
    operatorSpacing: 'standard',
    alignEquals: false,
    lineWrap: 'off',
    wrapIndent: 'hanging',
    ifFormatting: 'inline',
    capitalization: 'asIs',
  },
  ti: {
    preset: 'standard',
    indentStyle: 'spaces2',
    keywordCase: 'asIs',
    functionCallSpacing: 'standard',
    commaSpacing: 'single',
    operatorSpacing: 'standard',
    lineWrap: 'off',
    preserveMetadataBlocks: true,
    alignAssignments: false,
  },
  editor: {
    fontFamily: 'Geist Mono',
    fontSize: 13,
    lineHeight: 1.5,
    monacoTheme: 'vs-dark',
    uiAccent: 'blue',
  },
}
```

---

## 9. Presets Definition

```js
// presets.js
export const PRESETS = {
  compact: {
    name: 'Compact',
    description: 'Minimal spacing, dense lines',
    rules: {
      areaPrefixSpacing: 'none',
      functionCallSpacing: 'compact',
      commaSpacing: 'none',
      semicolonSpacing: 'none',
      operatorSpacing: 'compact',
      alignEquals: false,
      lineWrap: 'off',
      ifFormatting: 'inline',
    },
    ti: {
      functionCallSpacing: 'compact',
      commaSpacing: 'none',
      operatorSpacing: 'compact',
      lineWrap: 'off',
    },
  },
  standard: {
    name: 'Standard',
    description: 'Balanced readability',
    rules: {
      areaPrefixSpacing: 'single',
      functionCallSpacing: 'standard',
      commaSpacing: 'single',
      semicolonSpacing: 'none',
      operatorSpacing: 'standard',
      alignEquals: false,
      lineWrap: 'off',
      ifFormatting: 'inline',
    },
    ti: {
      functionCallSpacing: 'standard',
      commaSpacing: 'single',
      operatorSpacing: 'standard',
      lineWrap: 'off',
    },
  },
  expanded: {
    name: 'Expanded',
    description: 'Generous spacing, multi-line',
    rules: {
      areaPrefixSpacing: 'single',
      functionCallSpacing: 'expanded',
      commaSpacing: 'single',
      semicolonSpacing: 'none',
      operatorSpacing: 'standard',
      alignEquals: true,
      lineWrap: '120',
      wrapIndent: 'hanging',
      ifFormatting: 'multiline',
    },
    ti: {
      functionCallSpacing: 'expanded',
      commaSpacing: 'single',
      operatorSpacing: 'standard',
      lineWrap: '120',
    },
  },
}
```

---

## 10. Implementation Order

**Phase 1 — Foundation:**
1. Create module structure (`lib/formatters/`)
2. Build tokenizer for Rules
3. Build `rules-formatter.js` with all options
4. Create `presets.js` and `settings.js`
5. Add `FormatSettings.jsx` modal with Rules tab + Live Preview

**Phase 2 — TI:**
6. Build tokenizer for TI
7. Build `ti-formatter.js`
8. Add TI tab to settings modal

**Phase 3 — Polish:**
9. Add IBM naming dictionary (`naming.js`)
10. Add font/theme settings panel
11. Wire up to editor context menu and toolbar
12. Add keyboard shortcuts (Ctrl+Shift+F, Ctrl+K Ctrl+F for selection)

---

## 11. Open Questions

1. **Should we support `.editorconfig`-style project-level formatting configs?** (e.g., a `.tm1format` JSON file in the project root)
2. **Should the formatter handle `#Region` alignment?** (e.g., align all `=` signs within a single `#Region` block, or only consecutive lines?)
3. **Should we offer a "Format on Save" toggle?**
4. **For TI metadata blocks (`#****Begin: Metadata`), should we indent their contents or leave them flush-left?**
5. **Should we ship a "team defaults" mechanism?** (e.g., a shared `tm1format.json` that new developers import to get the team's preset)

---

## Sign-off

**Your call — approve this design and I'll start Phase 1, or tell me what to change?**

**Phase 1 deliverables:**
- `lib/formatters/` module structure
- Token-aware Rules formatter engine
- `presets.js`, `settings.js`, `naming.js`
- `FormatSettings.jsx` modal with Rules tab + Live Preview + editable naming dictionary
- Keyboard shortcuts wired up (Ctrl+Shift+F)
