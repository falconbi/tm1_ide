// ── In-app contextual help content ──────────────────────────────────────────
//
// One entry per editor/area, shown via HelpPanel.jsx from a '?' toolbar button.
// This is the pilot for replacing docs/index.html (a standalone GitHub Pages
// doc that had drifted — wrong keyboard shortcuts, a removed snippet still
// mentioned): content that ships with the code gets reviewed alongside the
// change that would make it stale, instead of living on a separate page
// nobody remembers to update.
//
// Each entry's `sections` is a list of { heading, body } — body is plain
// strings/JSX-free markdown-lite (rendered by HelpPanel with basic `code`
// span support only), kept deliberately simple rather than pulling in a
// markdown renderer for a handful of paragraphs.

export const HELP_CONTENT = {
  rules: {
    title: 'Rules Editor',
    sections: [
      {
        heading: 'Formatting',
        body: 'Click **Format** in the toolbar to format the entire rules file. To format a single rule, select it first — the formatter applies only to the selection. Formatting preserves regions, comments, and feeders structure.',
      },
      {
        heading: 'Validation',
        body: '**Check** runs the current buffer through the static validator and the live TM1 `CheckRules` endpoint, showing errors inline with a pass/fail glow on the button.',
      },
      {
        heading: 'Cell Trace',
        body: 'The **Trace** panel lets you enter element coordinates and see the full calculation chain — which rules fired, in what order, and what intermediate values were produced.',
      },
      {
        heading: 'Regions',
        body: 'Use `#Region Name` / `#EndRegion` to fold and organise sections. The **Regions** menu jumps to any region; **Collapse/Expand** toggles all of them at once.',
      },
      {
        heading: 'Snippets',
        body: 'The **Snippets** panel lists ready-to-insert templates for element functions, date, and string functions. Type a function name and press Tab to expand it inline.',
      },
      {
        heading: 'Feeders',
        body: '**Fire Feeders** runs `CheckFeedersForRules` for this cube, recalculating feeder propagation. Open a view afterward to see zero-value rule cells highlighted amber.',
      },
    ],
  },

  ti: {
    title: 'TI Process Editor',
    sections: [
      {
        heading: 'Sections',
        body: 'The editor splits into four tabs: **Prolog**, **Metadata**, **Data**, **Epilog** — matching TM1\'s own process structure. A dot on a tab means it has unsaved edits.',
      },
      {
        heading: 'Parameters & variable naming',
        body: 'The **Parameters** panel defines input parameters. All IDE-generated code follows the prefix convention: `p` parameter, `v` string variable, `n` numeric variable, `s` server name, `c` cube name.',
      },
      {
        heading: 'Running',
        body: 'Click **Run** to execute via `tm1.ExecuteWithReturn`, which returns timing and the error log filename inline. Results and any errors appear in the panel below.',
      },
      {
        heading: 'Debugger',
        body: 'Click the gutter next to a line to toggle a breakpoint, then start a debug run. The debugger injects capture statements around each breakpoint and shows variable values at each stop.',
      },
      {
        heading: 'Datasource',
        body: 'The **Datasource** tab configures the TI data source — type (None, ASCII, ODBC, TM1CubeView, TM1DimensionSubset), file path, delimiter, and header row settings.',
      },
      {
        heading: 'Validation',
        body: '**Check** runs the static validator (section structure, IF/WHILE/FOR block matching, argument counts) against the current buffer.',
      },
    ],
  },

  dimension: {
    title: 'Dimension Editor',
    sections: [
      {
        heading: 'Views',
        body: 'Switch between **Tree** (hierarchy), **Flat** (list), **Grid** (structural edit), and **Attrs** (attribute grid) using the view toggle.',
      },
      {
        heading: 'Elements & edges',
        body: 'Right-click an element in the tree for **Add child / rename / delete**. Drag an element onto a consolidation to add it as a child; edit the weight inline.',
      },
      {
        heading: 'Bulk import',
        body: '**Bulk** opens a paste box for a tab-separated element list. The **Attrs** view also accepts pasted or CSV-uploaded attribute values (Element, Attr1, Attr2…).',
      },
      {
        heading: 'Filtering',
        body: 'Filter the element list by an existing subset or free-text search — both apply to Tree, Flat, and Grid views at once.',
      },
      {
        heading: 'Picklists',
        body: 'The **Picklists** button manages string-attribute picklists (constrained value lists) for this dimension.',
      },
      {
        heading: 'Used in',
        body: 'The "Used in N cubes" row expands to show every cube and TI process that references this dimension.',
      },
    ],
  },

  view: {
    title: 'View Editor',
    sections: [
      {
        heading: 'Native views',
        body: 'Drag dimensions between the Row, Column, and Title (filter) axes. Click a dimension pill to assign a subset — a named subset or an inline member selection.',
      },
      {
        heading: 'MDX views',
        body: 'Switch to MDX mode to write a raw MDX query. The result grid renders the same way as a native view, and MDX views save back to the server.',
      },
      {
        heading: 'Writeback',
        body: 'Click a numeric cell to edit it inline — writes go through `tm1.Update`, and the cell flashes green on success. Right-click a cell for trace, transaction log, annotations, and copy-intersection.',
      },
      {
        heading: 'Saving',
        body: 'The **Save** split button offers Save, Save As (new name), and — for MDX views — Save as Native, plus Save as Default View for this cube.',
      },
      {
        heading: 'Auto-refresh',
        body: 'A view auto re-executes when the rules for its cube are saved elsewhere in the IDE, so the grid never shows stale calculated values.',
      },
    ],
  },

  subset: {
    title: 'Subset Editor',
    sections: [
      {
        heading: 'Visual mode',
        body: 'Browse the hierarchy tree and tick members to build a static subset. Converting to MDX from here is one click if you need an expression instead.',
      },
      {
        heading: 'MDX mode',
        body: 'Write an MDX set expression directly. **Preview** executes it against the live server and shows the resulting member list before you save.',
      },
      {
        heading: 'Usage',
        body: '**Scan for usage** lists every cube view and TI process that references this subset, so you can check impact before changing it.',
      },
    ],
  },

  chore: {
    title: 'Chore Editor',
    sections: [
      {
        heading: 'Schedule',
        body: 'Set the start date/time and the recurrence frequency (days, hours, minutes, seconds). Execution mode controls whether steps commit as one transaction or independently.',
      },
      {
        heading: 'Steps',
        body: 'Add TI processes as steps, reorder them, and set per-step parameter values. Steps run top to bottom.',
      },
      {
        heading: 'Active / Inactive',
        body: 'Toggle **Active** to enable or disable the schedule without deleting or reconfiguring the chore.',
      },
    ],
  },

  sql: {
    title: 'SQL Editor',
    sections: [
      {
        heading: 'Connections',
        body: 'Connects to external databases — MSSQL, PostgreSQL, MySQL, SQLite. Manage connections with the **+** button next to the connection dropdown.',
      },
      {
        heading: 'Schema browser',
        body: 'The left panel lists tables and columns for the active connection. Click a table or column to insert its name at the cursor.',
      },
      {
        heading: 'Saved queries',
        body: 'Save a query for reuse per connection, and reload it later from the saved-queries list.',
      },
      {
        heading: 'Post to TI',
        body: 'Copies the current query as a ready-to-paste TI datasource configuration snippet, for pulling this query into a process.',
      },
    ],
  },

  changesets: {
    title: 'Change Sets',
    sections: [
      {
        heading: 'What it tracks',
        body: 'A Change Set is a named session that logs every save you make — rules, TI processes, dimensions, views, subsets — with your user attribution. Saves made without an active Change Set are still applied to TM1 but aren\'t included in a deploy package.',
      },
      {
        heading: 'Start / Close',
        body: 'Click **Change set** in the status bar to start one and give it a name. Click the check mark next to an active set to close it — closing stops tracking new changes but the set stays available to deploy.',
      },
      {
        heading: 'Release',
        body: 'The **Release** button opens the Deploy pipeline pre-scoped to everything changed since the current baseline was seeded — not just one Change Set.',
      },
    ],
  },

  deploy: {
    title: 'Deploy Pipeline',
    sections: [
      {
        heading: 'New Deploy',
        body: 'Pick a closed Change Set as the source and a target server. The pipeline runs **Diff** (what changed vs. target) → **Package** (fetch live objects, write a package) → **Risk** (blockers: rule syntax errors, missing dependencies, chore conflicts) → **Deploy** (push in dependency order — attributes → dimensions → cubes → rules → subsets → views → processes). Run as a Dry Run first.',
      },
      {
        heading: 'History',
        body: 'An archive of past deployments — what was deployed, when, and the diff at the time.',
      },
      {
        heading: 'Import',
        body: 'Import a package built outside this session (e.g. from the CLI) to review or deploy it here.',
      },
      {
        heading: 'Baselines',
        body: 'A baseline is the structural snapshot a diff compares against. Deploys keep it current automatically — this view is for bootstrapping a new one or recovering from a stale/incorrect baseline, not a normal step in every deploy.',
      },
    ],
  },
}
