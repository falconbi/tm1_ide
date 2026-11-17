# 03 — ProcessEditor split: questions for James

Behaviour questions found while moving code. None were changed in the split.

1. **Empty ASCII file with a header row** — done: `parseAsciiPreview` now returns numbered columns and no rows for an empty file. `parseAsciiPreview` (formerly inline in the preview
   panel) reads `lines[0]` when `asciiHeaderRecords > 0`. An empty file has no first line, so the
   preview throws `Cannot read properties of undefined (reading 'split')` and shows that in the error
   area instead of “0 rows”. The old code did the same; the split preserved it rather than fixing it.
   Suggested fix: when `head > 0` and there is no first line, return numbered columns and no rows.
