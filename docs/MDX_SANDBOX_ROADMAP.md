# MDX Sandbox Roadmap

**Goal**: Turn the current basic MDX editor into a genuinely excellent, power-user MDX tool for TM1/Planning Analytics developers — one that feels native to the rest of the TM1 IDE.

**Guiding Principles**
- Small, incremental steps (nothing bigger than a focused 1-3 day change)
- Leverage existing tech in the project (Monaco, AG Grid, Zustand, TanStack Query, shadcn)
- Prioritize usability and workflow over flashy features early on
- Keep the experience consistent with the rest of the IDE

---

## Current State (as of late May 2025)

- Monaco editor with basic custom MDX language support
- Static reference panel with MDX snippets
- Very basic HTML table for results
- Simple execution via `/api/mdx/execute`
- Minimal error handling and no query history/saving
- No server-aware IntelliSense

---

## Phased Roadmap

### Phase 0: Hygiene & Quick Wins (Stabilization)

**Goal**: Remove the most painful immediate friction.

| Step | Description | Est. Effort | Notes |
|------|-------------|-------------|-------|
| 0.1 | Replace the basic HTML table result grid with AG Grid (already in the project) | 1-2 days | Big immediate UX improvement. Support column/row headers properly. |
| 0.2 | Add basic CSV export from results | 0.5 day | Very high value for analysts |
| 0.3 | Improve error display (parse TM1 errors, show line numbers, better formatting) | 1 day | Current errors are raw and ugly |
| 0.4 | Add simple in-memory + localStorage query history | 1 day | Prevent losing work |

**Exit Criteria**: Running a query feels noticeably better than before.

---

### Phase 1: Foundation (Make it Reliably Usable)

**Goal**: Reach a state where a TM1 developer would choose this over PAW/Architect for ad-hoc MDX work.

| Step | Description | Est. Effort | Notes |
|------|-------------|-------------|-------|
| 1.1 | Add query history UI (searchable list of past queries with timestamps) | 1-2 days | Builds on 0.4 |
| 1.2 | Allow saving/loading MDX queries to localStorage with names | 1 day | "Save as favorite" |
| 1.3 | Improve MDX language support (better tokenizer + more context-aware completions) | 2-3 days | Focus on common patterns first |
| 1.4 | Add basic "Send to MDX Sandbox" integration from Cube Viewer / Explorer | 1-2 days | Right-click a view or cube → open with pre-filled MDX |

**Exit Criteria**: A developer can comfortably do daily ad-hoc MDX work without major pain.

---

### Phase 2: Core Power Features

**Goal**: Make it feel like a serious analyst/developer tool.

| Step | Description | Est. Effort | Notes |
|------|-------------|-------------|-------|
| 2.1 | Server-aware IntelliSense (fetch dimensions, hierarchies, and members from the connected server) | 3-5 days | Highest leverage feature |
| 2.2 | Support for MDX parameters / variables | 2-3 days | Huge for reusable queries |
| 2.3 | Allow saving `.mdx` files into the project (treat MDX as first-class artifacts) | 2 days | Ties into the "models as code" philosophy |
| 2.4 | Result grid enhancements (member properties, better formatting, cell value copy) | 2 days | On top of AG Grid from Phase 0 |

**Exit Criteria**: Power users start preferring this tool.

---

### Phase 3: Advanced & Differentiating Features

**Goal**: Make it stand out as best-in-class for TM1 MDX work.

| Step | Description | Est. Effort | Notes |
|------|-------------|-------------|-------|
| 3.1 | Query comparison (side-by-side execution + diff) | 3+ days | Very useful for refactoring |
| 3.2 | Query plan / performance analysis (if exposed by the server) | 2-4 days | Advanced but high value |
| 3.3 | Deeper integration with other IDE tools (e.g., Period Builder, Subset Editor) | Ongoing | Example: Generate MDX from Period Builder output |
| 3.4 | Advanced result features (export to Excel with formatting, pivot-style views) | 3+ days | Depends on demand |

---

### Phase 4: Polish & Ecosystem

- Keyboard shortcut power user mode
- Theming / customization of the editor
- Shareable query links (if useful)
- Documentation + onboarding tour inside the sandbox
- Performance & stability hardening

---

## Recommended Starting Path (Small Steps)

We should **not** start with Phase 2 or 3.

**Suggested first 4-5 small steps** (in rough order):

1. **0.1** — Replace result grid with AG Grid (biggest quick win)
2. **0.3** — Improve error messages
3. **0.4 + 1.1** — Add query history (start simple, make it searchable)
4. **1.4** — Add "Send to MDX Sandbox" context menu integration (increases usage)
5. **1.3** — Incremental improvement to MDX language support

After these, we re-evaluate before committing to the heavy lift of server-aware IntelliSense.

---

## Open Questions for Discussion

- How important is **saving queries as project files** vs just local history?
- Should we prioritize **server-aware completions** early (very high effort) or get the basics rock solid first?
- Are there specific pain points you've experienced with the current sandbox that aren't listed?
- Any hard constraints (e.g., we want to keep it lightweight, avoid heavy dependencies)?

---

**Next Action**

Once we align on the first 1-2 small steps, I can create a detailed implementation plan (including file changes, edge cases, testing approach) for the first item.

Which phase or specific small step feels like the right place to start? Or would you like me to adjust the roadmap first?