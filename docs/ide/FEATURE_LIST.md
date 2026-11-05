# TM1 IDE — Feature list

Every feature in one numbered list. For detail and screenshots see [Features](FEATURES.md).

## Editors

1. **Rules Editor** — Monaco editor with TM1 syntax highlighting, live validation (CheckRules) plus static analysis (argument counts, keywords), Check Now, formatter, folding and regions.
2. **TI Editor** — Prolog / Metadata / Data / Epilog tabs, parameter and datasource editors, CSV upload to the server, run with output log, inline TM1 error log, IF/WHILE block checks.
3. **TI Debugger** — breakpoints in any section, variable capture, watch panel, section-by-section run.
4. **Dimension Editor** — hierarchy tree with CRUD, attribute grid, element search, bulk CSV import, attribute columns that drag wider (widths remembered), one-click String → Alias, Format picker.
5. **Alternate Hierarchies** — "+ Hierarchy → From an attribute" builds one plus the TI process that keeps it in step; each gets its own Default subset.
6. **Subset Editor** — MDX code view and visual element tree, static or MDX save, MDX preview.
7. **View Editor** — native and MDX views, grid with writeback, refreshes when the cube's rules are saved, feeders check; a dimension can use an Alternate Hierarchy.
8. **Pivot drill-down** (View Editor and Lenses) — open any total even beyond the query, heading right-click menu (expand, collapse, leaves only, keep only), Freeze top.
9. **Guided MDX Builder** — axis-by-axis view builder, subset filter builder, ad-hoc MDX editor with result grid.
10. **Chore Editor** — schedules, steps, activate / deactivate / run now.
11. **Cube Editor** — create and delete cubes, assign dimensions.
12. **SQL Editor** — SQL Server, PostgreSQL, MySQL, SQLite; schema browser, saved queries, post as a TI datasource.
13. **Period Builder** — wizard for a time dimension with computed attributes, three generated TI processes and subsets.

## Understanding the model

14. **Cube Map** — graph of every cube and how data moves (rule references, feeders, TI writes); run-sequence playback, transitive dependency highlight, keeps its place per tab.
15. **Rule Lens** — a cube's rules read by measure: what each rule writes, reads and feeds.
16. **Data sources** — every TI writer, reader and copy process for a cube, in the Rules editor.
17. **Process summaries and runbooks** — plain-English "what does this process do", and phased reviews of a model update.
18. **Cell Trace** — right-click → Trace: the rule chain behind a value with live values, drill-down and breadcrumb.
19. **Used In** — impact analysis: TI processes and PAW books (PAW only) that reference a cube or view.
20. **Transaction Log** — who changed what and when, for a cube or a single cell.
21. **Cross-Object Search** (Ctrl+Shift+F) — full-text search across all rules and TI code.

## Testing and governance

22. **Assertions** — the model's known-right answers, stored in TM1, checked after every build and deploy.
23. **Change Sets** — every save tracked; change logs grouped by action; open any changed object.
24. **Deploy through TM1 Git** (preview) — test → close → build release → review → approve → deploy → verify, with drift checks.
25. **Deploy History** — permanent record of every deployment: approvals, manifests, before/after snapshots with diffs.
26. **Earlier REST deploy pipeline** — Diff → Package → Risk → Approve → Deploy; kept for history and the admin CLI.

## AI

27. **MCP server** — ~65 operations an AI agent (e.g. Claude Code) uses to build dimensions, cubes, rules and processes inside change sets; includes version copy and period builder tools.
28. **Built-in AI assistant** — generates views and subsets from a description (Anthropic API key).

## Lenses (in development)

29. **Lenses and the Lens Editor** — single-file HTML apps on live TM1 data with governed write-back, built and previewed in the IDE. Current set: the 14-page Workforce planning model.

## Server and operations

30. **Jobs Monitor** — live background jobs, 4-second refresh, one-click cancel.
31. **Sessions Monitor** — sessions by user with threads; thread cancel and session disconnect.
32. **Server Admin** — sessions and server configuration; on V12, live metrics and maintenance mode (TM1 12.6+).
33. **Save data** — admin-only SaveDataAll with confirm and last-saved time.
34. **File Manager** — browse, upload, download and delete in the TM1 server's file space.

## Editing comfort

35. **Autocomplete and intelligence** — cube, dimension and function completions, signature help, hover docs with V11/V12 compatibility and deprecation, for Rules, TI and MDX.
36. **Function Catalog and Catalog Admin** — editable catalog behind completions and validation; Validate tests every function against the live server; overrides kept separate.
37. **Naming Dictionary** — the casing map the formatter uses (e.g. `subnm` → `SUBNM`).
38. **Cell Formatting** — a `Format` attribute controls number, percentage and coloured-string display.
39. **Explorer** — browse every TM1 object type with full create / edit / delete.
40. **Tabs and split panes** — drag to reorder, split right or down, move between panes, layout remembered.
41. **Keyboard shortcuts** — F1 or Ctrl+Shift+K in the app.

## Connectivity

42. **Direct or through PAW** — connects over the TM1 REST API directly or through PAW, on v11 and v12.
