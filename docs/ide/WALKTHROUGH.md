# TM1 IDE — first walkthrough

A first end-to-end pass through the IDE. It assumes a working TM1 server and the setup in
[SETUP.md](SETUP.md).

> **v1.0 scope.** This is a reference release, not a supported product. Windows is untested, the
> live deploy checks are still for James to run, and Lenses remain in development.

## 1. Start the IDE

```bash
npm ci
cd client && npm ci && cd ..
npm start
```

Open <http://127.0.0.1:8083>. The frontend is pre-built; developers rebuild it with
`cd client && npm run build`.

## 2. Connect to a server

1. Choose the server in the selector.
2. Sign in with your own TM1 login. Each server has its own sign-in; the IDE never reuses one
   server's credentials against another.
3. The status bar shows the server and the user the change log will attribute edits to.

If the server is read-only, the IDE says so and refuses writes. That is intentional.

## 3. Find your way around

The Explorer is the object tree: cubes, dimensions, processes, chores, views, subsets, rules,
Lenses. Tabs open beside it. Drag a tab to reorder it; right-click for split, move and close
options.

## 4. Edit Rules

1. Open a cube → **Rules**.
2. Edit the rule and feeder text. The static validator marks argument-count and syntax problems;
   **Check Now** also asks TM1's own compiler.
3. **Format** applies the rules formatter. `#Region` / `#EndRegion` fold.
4. **Save**. With a change set open, the save is recorded with before/after state.

Right-click a calculated cell in a View to trace the rule chain, or open **Rule Lens** to read the
rules by measure.

## 5. Edit a TI process

Open a process and use the Prolog / Metadata / Data / Epilog tabs. The parameter and datasource
editors are below the code. **Run** executes it; the error log is shown inline. Breakpoints and
watches are available in the debugger.

## 6. Build a small model

- **Dimensions:** create a dimension, add elements, attributes and alternate hierarchies; import
  elements or attribute values from CSV.
- **Cubes:** create a cube and choose its dimensions.
- **Views and subsets:** build a native view with the row/column/title editor, or write MDX.
  The grid supports drill-down and write-back where TM1 allows it.
- **Chores:** create a schedule and add the processes it runs.

## 7. Understand the model

- **Cube Map:** every cube and the data movement between them, with a run sequence.
- **Data Sources:** the TI writers, readers and rule dependencies for a cube.
- **Model Health:** cubes without a default view, dimensions without a default subset, stale
  references and assertion results.
- **Transaction Log:** recent writes, with restore available to TM1 admins.

## 8. Govern a change

1. Start a **change set** in the Change Log.
2. Make edits. Every save is recorded against that set.
3. Add **assertions** — known-right answers stored in the model and run on close and on demand.
4. Close the change set. Block-severity assertion failures stop the close.
5. Use the Deploy workflow: test → close → build release → review → approve → deploy → verify.
   The release travels through TM1's built-in Git; the IDE keeps the governance, approvals,
   drift checks and history.

The live deploy verification is listed in
[07_DEPLOY_FIXES_DONE.md](review/07_DEPLOY_FIXES_DONE.md#behaviour-james-should-verify-live-he-runs-live-checks).

## 9. Build with an AI agent (optional)

Start the MCP server with `npm run tm1mcp`. Read
[MCP_SERVER.md](MCP_SERVER.md) first: reads run as the configured reader, writes use the builder
inside an open change set, and the policy file controls what the agent may see or change.

## 10. Lenses (in development)

`npm run lens` starts the Lens app. Lenses are separate HTML screens stored in the model; the IDE
edits and previews them. They are still being tested and are not required for the IDE workflow.

## Where to go next

- [FEATURES.md](FEATURES.md) — every editor and tool
- [ARCHITECTURE.md](ARCHITECTURE.md) — the three programs and the folder layout
- [CLAUDE.md](../../CLAUDE.md) — the working map for contributors
