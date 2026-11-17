# 03 — Rules editor split: questions

## CellTracePanel vs `view-editor/trace/`

Both call `/api/cube/trace` through `useTraceCellCalc`, but they are two different surfaces built
for two different jobs. This round does not merge them.

### What the Rules editor's `CellTracePanel` shows that the View editor trace does not

- **A tuple you can edit before tracing.** One row per cube dimension with an `ElementPicker`
  (search the dimension's elements, Enter commits the last row and traces). The View editor starts
  from the cell the user right-clicked and has no element pickers.
- **Per-tab memory.** The typed tuple (`rows`) and the last traced cell (`lastPairs`) are kept in
  the in-memory rules session under `tabId::trace`; returning to the tab re-traces the same cell.
  Closing the tab clears it. The View trace panel is transient and has no per-tab session.
- **An inline panel.** It sits in the Rules editor's own side-panel row (`w-80`, border-left) next
  to Lineage and Rule Lens. The View trace is a fixed right-hand overlay (`440px`, `z-index: 9000`).
- **Transaction history from a leaf.** A leaf result node has a History button that opens a
  `transactionlog` tab for `Cube` + `Tuple`.
- **A recursive tree of the whole result.** `TraceNode` renders `Type`, the source cube, the tuple,
  every `Statements` line and `Value`, expanding by default two levels. It is deliberately plain:
  no badges or formatted values.

### What the View editor trace shows that `CellTracePanel` does not

- **Drill navigation.** A result component can be clicked to trace a new cell in the same or
  another cube; a breadcrumb stack and Back go through the trail, fetching the target cube's
  dimensions on demand.
- **Rule operand resolution.** `RuleBreakdown` parses the result's statements, removes guard
  statements and duplicate lines, and resolves `ATTRS(...)`, `DB(...)` and `IF(...)` operands to
  their values. It shows which coordinates were derived from attributes ("Mapped from attributes")
  and can drill into a `DB` target.
- **Presentation.** `TypeBadgeTrace` badges (RULE/CONSOLIDATED/FEEDER/BASE), `fmtTraceValue`, an
  "Stored input: this is the source" explanation when nothing calculates the cell, and a
  `TraceErrorBoundary` with Retry.
- **Refresh without losing the stack.** A nonce re-traces the current frame; the Rules panel has
  Refresh for the one typed cell.

### Could the Rules trace use `view-editor/trace/` without changing what the user sees?

**No, not today.** `TraceSidePanel` is a fixed overlay with a stack/breadcrumb and no tuple editor;
reusing it would replace the inline `CellTracePanel`, lose the per-tab typed tuple and session,
lose the leaf History action, and add drilling, badges, formatted values and operand breakdown that
the Rules panel does not show. It would also auto-fetch through `useTraceData` instead of waiting
for the Trace button.

`RuleBreakdown` and `TypeBadgeTrace` could be reused *inside* a future shared panel, but that would
be a deliberate UI change (new value formatting and operand detail), not a behaviour-preserving
move, so it is out of scope for this split.

## Behaviour note found while moving

`mergeCheckErrors` keeps today's treatment of a non-numeric TM1 `LineNumber`: `Number(x) || 0`
makes it line 0, so every static finding is filtered out and only the TM1 error remains. That is
now covered by a test rather than changed. If TM1 ever returns a missing/odd `LineNumber`, the
static findings will disappear until the next edit; fixing it would be a behaviour change, not
part of this split.
