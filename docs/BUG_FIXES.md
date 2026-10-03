# Bug fixes

Every bug-fix commit, newest first, by the date it was committed. Generated from the git history;
commits that mixed a fix into a feature are included too. New features are not listed here.

114 fixes from 2026-05-20 to 2026-10-04.

← [Back to README](../README.md)


## October 2026

### 2026-10-04

- **cube-map** — Show contextual dimensions in module/cube focus graphs

### 2026-10-03

- **cube-map** — Case-insensitive module/group keys (prefix casing variants unify)
- **cube-map** — P3 strip comments in TI/rules scanner (no phantom edges)
- **cube-map** — Configurable group regex, minimap toggle, focus crash fix; TI #Region fixes
- **ti** — #Region folding, outline and Regions menu in the TI editor; lint fixes

### 2026-10-02

- **lint** — Ignore commas inside rule area references


## September 2026

### 2026-09-24

- **search** — Don't crash the app when Find & Replace runs
- **server** — Unblock process search; make sessions optional for saves
- **editor** — Render the suggest widget at the cursor and populate the cube list immediately

### 2026-09-23

- **editor** — Let Monaco widgets escape the split-panel clip
- **editor** — Add top padding so hover tooltips render above the first line instead of clipping at the pane edge
- **editor** — Render Monaco widgets in document.body — tooltips were clipped by the nested-split panel's overflow-hidden
- **editor** — Raise Monaco overlay z-index to 9999 — hover/suggest tooltips were rendering beneath the pane edge

### 2026-09-22

- **validator** — TI static validator false positives
- **editor** — Register each Monaco completion provider once — no duplicates

### 2026-09-21

- **editor** — Close a tab in the correct pane when it is mirrored
- **editor** — Closing a mirrored tab no longer kills it in other panes
- **editor** — Revert provider dispose-on-unmount — broke autocomplete
- **snippets** — Restore full snippet panel (reference list shows everything)
- **editor** — Ctrl+/ block comment actually works now
- **rules** — Restore missing cube fetch in save route

### 2026-09-20

- **editor** — Function names now autocomplete inside argument positions
- **editor** — Close quotes on in-quote completions; statements complete as 'NAME;'
- **editor** — Duplicate autocomplete suggestions from provider accumulation
- **trace** — Show [Base] and DB values on the first screen
- **trace** — Strip N:/C:/S: qualifier + ; so expressions parse, render conditions
- **trace** — Maximum call stack from operand parser recursion
- **trace** — Error boundary around trace body so drill crashes are visible
- **grid** — Bold headers on rows — class was shadowed by Tint
- **grid** — Bold headers now applies to the row headings too
- **grid** — Row-label cells (pinned-left member column) now tint with headings
- **grid** — Header tint now reaches row headings (pinned-left headers)
- **grid** — Number format toggle now works on the View pivot
- **grid** — Zero cells with a format no longer show server's 0.00
- **grid** — TM1 number format '1,000' no longer misrenders as '10'
- **grid** — Consolidation emphasis toggle now applies on the View pivot
- **grid** — Zebra striping via theme oddRowBackgroundColor
- **grid** — Appearance settings now apply immediately
- **grid** — Freeze/unfreeze crash — set pinned rows via API, not prop
- **grid** — Unfreeze crash on View pivot — drop getRowId
- **grid** — Freeze-top crash on the View pivot grid

### 2026-09-19

- **catalog** — Subset-name completion, fix SubsetCreate arity, add 2 missing real functions
- **ti-editor** — Remove the whole-catalog Validate button
- **editor** — Stop stale suggestion widget on '('; remove the Patterns feature
- **autocomplete** — Fix broken cube expansion, add area-type + attribute + nested-function completion
- **snippets** — Trim Rules snippet library to verified-correct entries only

### 2026-09-18

- **editors** — Disable Monaco's word-based suggestions in Rules/TI/MDX editors

### 2026-09-17

- **catalog** — Remove remaining GetCurrentUser references missed in the first pass
- **catalog** — Add automated live-validation script; fix a real bug it found immediately
- **catalog** — Remove fictional entries from the casing dictionary, rule tracker, and dead-reference scanners
- **ti** — Remove fictional functions from the debugger simulator, snippets, and pattern generator
- **validators** — Remove TM1_FUNCTIONS fallback and the fictional allowlist
- **catalog** — Remove the second, competing Monaco completion provider

### 2026-09-16

- **docs** — Restore Postman collection to docs/, un-break README link
- **tm1-client** — Stop corrupting Numeric process parameters and dropping Variables

### 2026-09-13

- **views** — Resolve named-subset axis dimension at the source, kill false drift

### 2026-09-12

- **change-sets** — Deployed-session detection using baseline position, not approval session-id
- **deploy-history** — Dimension structural signature, stray 0, misleading bracket, silent gap
- **deploy-ui** — Diff buttons inside Deploy Center actually open a diff
- **deploy-ui** — Import Package now only lists actual imports

### 2026-09-09

- **validator** — False "Unclosed string" on comment apostrophes
- **ui** — Guard the "close change set" control against misclicks
- **view** — Persist suppress-empty and totals-position across reopen
- **deploy** — Drift check for native views compared incompatible shapes
- **change-sets** — Close the Change Sets panel when opening a deploy/release tab

### 2026-09-08

- **subset** — SaveStaticSubset replaces members instead of appending (v11)
- **deploy** — Drift check reads static-subset members; deployer removes dropped elements
- **security · direct-v11** — Add tls "chain-only" mode for the stock IBM TM1 cert
- **security · direct-v11** — Verify TM1 TLS certificates instead of disabling globally
- **security** — Adopt local single-user model (loopback bind, login throttle, token idle expiry)
- **deploy** — DeploySubset replaces static members instead of appending

### 2026-09-07

- **deploy** — Package static subset MEMBERS, not an empty list
- **deploy** — Rules risk check false-BLOCKER on package-added elements
- **deploy** — Rules diff false-DRIFT on MCP-authored rules
- **deploy** — V11 API compatibility + package correctness

### 2026-09-06

- **deploy** — Risk check no longer blocks on deps the package itself creates
- **deploy** — Drift check prefers the target's own baseline over the package-bundled one

### 2026-09-04

- **deploy** — Target dropdown was rendering blank options
- **deploy** — Wire the Approve and Results screens to real data + archive

### 2026-09-01

- **fix** — ViewEditor crash and c:/b: format prefix display bugs


## June 2026

### 2026-06-22

- **docs** — Comprehensive auth section + fix PAW book-usage for direct-v11

### 2026-06-21

- **fix** — Full auth header sweep + stuck loading toasts + alias display
- **fix** — Diff icon emerald in DeployHistory
- **fix** — Diff icon colour, toast dedup, Format attr docs, alias convert guard
- **fix** — Restore TraceSidePanel drill-down trace + strip cell right-click to Trace only

### 2026-06-19

- **fix** — Expand TI validator allowlist + add ProcessError guard after attr delete
- **fix** — Use DimensionElementDelete on }ElementAttributes_ to delete attr — DimensionElementAttributeDelete does not exist in TM1 TI
- **fix** — Attr-select filter handles full TM1 type names (String/Alias not S/A)

### 2026-06-16

- **docs** — Connection architecture design + PAW_LOGIN_SERVER fix
- **fix** — Use REST API for user creation instead of TI, add multi-user login docs

### 2026-06-14

- **fix** — Skip suppressed rows in HierarchyGrid cartesian product
- **fix** — Zero suppression for native views with string measures

### 2026-06-10

- **fix** — Include pages (filter) axis dims in format attr lookup
- **fix** — Format attribute reading fails when TM1 returns Value:null for string cells
- **fix** — Format attribute lookup broken by alias substitution

### 2026-06-02

- MDX Editor U[date and Bug Fix ]


## May 2026

### 2026-05-30

- **Debugger** — Fix parser for concatenated capture blocks, document String param type bug

### 2026-05-29

- TI Debugger: breakpoint injection, variable watch capture, save fix

### 2026-05-28

- MDX Builder: editable view MDX editor, time series dim picker + subset patterns, * crossjoin, fix double braces

### 2026-05-23

- **feat** — Format document, show in tree, stale rules cache fix

### 2026-05-22

- Fix view type detection — check MDX property instead of @odata.type
- Fix MDX parser to support ON 0 / ON 1 axis notation from PAW
- Fix server crash on native view  fallback
- Fix getView to expand subset definitions in native views
- Fix view loading to preserve native view subset definitions
- Fix ViewEditor MDX subset syntax and zero value display

### 2026-05-20

- **fix** — Wrap ghost element in array when calling onAdd
- **fix** — Σ forces flat list (only place totals-at-bottom makes visual sense)
- **fix** — Σ toggles totals-at-bottom without forcing flat list
- **fix** — Σ switches to flat list so consolidated-at-bottom is visible
- **refactor** — Clean up SubsetVisualEditor — remove dead code, fix Σ toggle
- **fix** — Σ toggle bypasses tree view to show sorted flat list
- **fix** — Σ toggle pushes consolidated elements to bottom of subset list
- **fix** — Subset tree expandable consolidations + compact tab bar with hide toggle
