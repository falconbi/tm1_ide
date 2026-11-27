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
        heading: 'Functions & autocomplete',
        body: 'The **Ref** panel (toolbar) is a lookup reference of every TM1 function, grouped by family (Cell, Cube, Dimension, Element, Attribute, Subset, View, Process, Security, Text & Date, Math, ...) with each function\'s signature and description. Structural templates (loops, IF/ELSE, datasource setup) are ready to insert. As you type, **autocomplete** offers any function — select one to insert it; statements complete as `NAME;`. Select a block and press `Ctrl+/` to comment or uncomment it.',
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
        heading: 'Debug capture',
        body: 'Click the gutter next to a line to add a capture point, then run and capture. The process runs to completion; the IDE records the selected watches each time execution reaches a capture point.',
      },
      {
        heading: 'Datasource',
        body: 'The **Datasource** tab configures the TI data source — type (None, ASCII, ODBC, TM1CubeView, TM1DimensionSubset), file path, delimiter, and header row settings.',
      },
      {
        heading: 'Validation',
        body: '**Check** runs the static validator (section structure, IF/WHILE/FOR block matching, argument counts) against the current buffer.',
      },
      {
        heading: 'Functions & autocomplete',
        body: 'The **Ref** panel (toolbar) is a lookup reference of every TM1 function grouped by family, plus ready-to-insert structural templates (loops, IF/ELSE, datasource setup). As you type, autocomplete offers any function or keyword — statements complete as `NAME;`. Select a block and press `Ctrl+/` to comment or uncomment it.',
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
        body: 'Select an element in the tree for **+ Child** and **Del**. Drag an element onto a consolidation to add it there; edit the weight in the element panel.',
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
        heading: 'One place',
        body: '**Change sets** in the header is the single entry point. It shows the current set and previous/deployed sets, and **New** starts another.',
      },
      {
        heading: 'Personal, one at a time',
        body: 'A change set is personal while open: one open set per person, per server. Every save must belong to an open set; if none is open, the IDE asks you to name one. Releases carry one closed set at a time. **Catch-up** is the admin-only exception that can carry several.',
      },
      {
        heading: 'Review and note',
        body: 'Open a set to see its report grouped by cube, dimension and process, with **Diff** on each entry. The note field records why the work exists. Closing records the test result and the exact entries that will ship.',
      },
      {
        heading: 'Two people, same object',
        body: 'There is no merge inside one object. If two people edit the same TI process, DEV keeps the last save. You cannot remove one object from a change set. Stop before building or deploying anything, compare both intentions, have one person save the agreed final process, then ship one set that carries it. Other work in the second set can ship afterwards, once the process no longer differs from the target.',
      },
      {
        heading: 'Deploy',
        body: 'Click **Deploy** on the set row — that is the only way to start the wizard. An open set starts at Test/Close; a closed set starts at Commit. The rest is Commit → Build → Review → Approve → Deploy → Verify.',
      },
      {
        heading: 'Statuses',
        body: 'Open, closed, deployed, covered by an older whole-server release, or phantom (empty, history only). **Resume** is only for a closed, undeployed, non-catch-up set.',
      },
    ],
    docs: [
      { label: 'Shipping a TM1 change', href: 'https://falconbi.github.io/articles/shipping-tm1-changes/' },
      { label: 'Governed TM1 deploys', href: 'https://falconbi.github.io/articles/governed-tm1-deploys/' },
    ],
  },

  deploy: {
    title: 'Deploy',
    sections: [
      {
        heading: 'Start here',
        body: 'Open **Deploy → Ready to deploy**, choose the target in **Ready for**, then open the change set. A closed set goes straight to Build. An open one runs **Tests & close** first.',
      },
      {
        heading: 'Pre-deploy is read-only',
        body: '**Check PROD** asks three questions: is the target idle, has it changed since the last deploy, and what does it have that DEV does not. Nothing is written to PROD or DEV.',
      },
      {
        heading: 'Tests & close',
        body: "The model's **logic** tests run on DEV. A **block** test stops the close — fix it, or set it to **warn** if it is only advice. On success DEV is saved to Git (the DEV After Close commit) and Build Release uses that commit.",
      },
      {
        heading: 'Build & Review',
        body: "A release is the target's **current state plus this change set**. The target's own additions are kept. **Review** shows what changes and asks you to confirm any elements the release removes. **Rebuild** only if the target changed after the build.",
      },
      {
        heading: 'Deploy',
        body: 'Approve, Save Data, take the backup (`}IDE.Backup`), pull, verify. One change set goes to one target at a time. After the pull, logic checks run on the target; data quality is not part of a deploy.',
      },
      {
        heading: 'When DEV and PROD differ',
        body: "**PROD's own changes are kept. A deploy never deletes anything on PROD unless you recorded that deletion on DEV in a change set.**",
        table: {
          columns: ['What you see', 'What it means', 'What you do'],
          rows: [
            ['PROD has an element, subset or view DEV does not', 'The deploy keeps it', 'Nothing — it stays. Sync DEV if DEV needs it. To remove it from PROD, delete it on DEV in a change set and confirm at Review.'],
            ['DEV has something PROD does not', 'That is your change', 'Build → Review → Deploy.'],
            ['Both changed the same thing differently', 'A conflict; there is no default', "Take PROD's (Sync DEV) or keep DEV's (the deploy carries DEV's version)."],
            ['PROD removed something DEV still has', 'The target deleted it', 'Delete it on DEV too (recorded), or keep it — the next deploy restores it on PROD.'],
            ['PROD changed a rule or process', 'Edited by hand on PROD', "Carry-back: copy PROD's version to DEV, then deploy."],
            ['PROD changed a cube structure', 'A deploy must not guess', 'Make the change on DEV in a change set, then deploy it first.'],
            ['PROD changed a dimension this set touches', 'Normal', 'Rebuild the release after a fresh check. Additions are kept; removals are confirmed at Review.'],
            ['PROD changed a dimension this set does not touch', 'The pull skips it', 'Leave it; PROD keeps it.'],
            ['PROD changed a chore schedule', 'Kept', 'Sync copies the schedule to DEV, with the chore switched off.'],
          ],
        },
      },
      {
        heading: 'Sync DEV',
        body: "Copies PROD's own changes onto DEV in a separate `sync` set that is never deployed. Only when DEV has no open change set — it writes to DEV and would move the data under work in progress.",
      },
    ],
    docs: [
      { label: 'Shipping a TM1 change', href: 'https://falconbi.github.io/articles/shipping-tm1-changes/' },
      { label: 'When PROD drifts', href: 'https://falconbi.github.io/articles/deploy-drift-recovery/' },
      { label: 'Deploying Lenses', href: 'https://falconbi.github.io/articles/deploying-lenses/' },
    ],
  },

  gitdeploy: {
    title: 'Git Deploy (TM1 Git)',
    sections: [
      {
        heading: 'What this is',
        body: 'Deploys the model through **TM1\'s own Git integration**, not the classic package pipeline. This screen is the *receive* side: a target server pulls the approved state from the model\'s git repo and applies it. Build + push happen first — build in a Change Set, then push the source server to the repo.',
      },
      {
        heading: 'Target / Branch',
        body: '**Target** is the server receiving the deploy (e.g. PROD). **Branch** is the git branch to pull — `dev` is the working branch; `live-<target>` is that target\'s drift branch and is not used for deploys.',
      },
      {
        heading: 'Prepare',
        body: 'Read-only preview. Shows the target\'s **deployed commit** (what it last received), the **pull plan** (exactly what will change — counts by Create/Update/Delete/Skip), and the commit the target would move to. **Full overwrite** means the target has no deployed commit yet — its first pull replaces every object; that needs a reviewed first-pull, done separately.',
      },
      {
        heading: 'Deploy',
        body: 'Applies the pull to the target, then **control checks** (invariant assertions that must hold on any data) and **reconciles the two gaps TM1 Git can\'t do**: attribute values and object deletes. Expect **Applied — target now at <commit>** and **Control OK**. Deploying is the human approval step — make sure the plan and the Change Set match what was approved.',
      },
    ],
  },

  gitdrift: {
    title: 'Git Drift (live-<target>)',
    sections: [
      {
        heading: 'What this is',
        body: 'Has the target changed since we last deployed to it? The target saves a copy of itself, and we compare that to the commit it last received. Same = clean, different = drift.',
      },
      {
        heading: 'What you see',
        body: '**Deployed** is the commit the target was given. **live-<target>** is the target\'s current live state. Any object that differs is drift.',
      },
      {
        heading: 'When the target has drifted',
        body: 'Deploys are **paused**. Make the intended change on DEV in a change set and release it, or — if the target is unusable — restore its data folder from the backup taken before the last deploy and use **restored from a backup** (this screen, admin only). **Reseed does not clear Git drift.** There is no automated revert.',
      },
    ],
    docs: [
      { label: 'When PROD drifts', href: 'https://falconbi.github.io/articles/deploy-drift-recovery/' },
      { label: 'Shipping a TM1 change', href: 'https://falconbi.github.io/articles/shipping-tm1-changes/' },
    ],
  },
}
