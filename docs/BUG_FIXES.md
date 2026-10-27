# Bug fixes

Every bug-fix commit, newest first, by the date it was committed. Generated from the git history;
commits that mixed a fix into a feature are included too. New features are not listed here.

166 fixes from 2026-05-20 to 2026-10-10, plus 46 entries for 11–27 October. Last updated 2026-10-27.

← [Back to README](../README.md)


## October 2026

### 2026-10-27

- **cube-map** — Playback and focus state was lost when switching tabs or splitting; map scope, phase, visibility, zoom and deep links now restore, and deep links fire once
- **cube-map** — Focused-map visibility controls and the right-hand trace controls disagreed; Rules / Feeders / All TI now drive one trace-kind state, and TI/dimensions hide correctly
- **rules** — Rule lineage disappeared when the pane was split or the tab switched; the editor now saves and restores the lineage session
- **transaction-log** — The log grid was narrow and crushed its columns; it now fills the pane, keeps cells on one line, adds the cell column and cube heading, filters by text and user, and opens without a split

### 2026-10-26

- **ide** — Opening a TI process marked it dirty immediately; opening no longer changes the process
- **dimension-editor** — Dragging an attribute column wider snapped back; the width now persists per browser
- **core-ti** — `}IDE.Version.Copy` now skips rule-owned cells, fails on any cube failure, refuses a static copy outside Non-Calculating, and ends without `ProcessQuit`
- **deploy** — Bedrock objects are no longer shipped; recalculation is scoped to the version being changed

### 2026-10-25

- **pivot** — Freeze top copied the first row instead of pinning it, and unfreezing left the copy; it now moves the row back
- **lenses** — Hiring Plan history could report changes that never happened, and cutoff/plan end were read from the page; TI now reads them from the model

### 2026-10-24

- **view-editor** — An ALT H pill lost its amber hierarchy label when shown on the grid
- **view-editor** — Moving a dimension to Filter could leave the grid blank; it now keeps the member it was showing
- **pivot** — Opening one total closed the others, and indents/arrows did not redraw; totals now stay open and render correctly
- **subsets** — ALT H subsets never listed, opened or saved because the subset routes dropped the hierarchy; the routes now pass it
- **mcp** — `reprocess_feeders` did nothing on v11 (no REST `ProcessFeeders`); it now runs a temporary TI with `CubeProcessFeeders`
- **metadata** — Metadata tabs were empty and a save wiped the procedure because the code used `MetadataSource`; it now uses TM1's `MetadataProcedure`
- **mcp** — Write answers could not be parsed when the server label came after the JSON; the label is now a trailing block
- **mcp** — The MCP used a hard-coded default server instead of the IDE's selected server; it now follows the selected server

### 2026-10-23

- **tests** — `npm test` could run live TM1 scripts; it is now scoped to `tests/`
- **deploy** — WFP_Lab test objects could be packaged and deployed; they are now always excluded

### 2026-10-22

- **sessions** — Expanding Threads on v11 failed the whole request (`CurrentThread` 400); threads now expand through Session attributes
- **catalog** — `ConsolidateChildren` was documented and tested with one dimension; it accepts one or more dimension names

### 2026-10-21

- **lens-kit** — History omitted cell notes; it now shows "added a note" with a Notes filter

### 2026-10-16

- **mcp** — Read-only was opt-in; every server is now read-only unless `MCP_MODE=build` is set

### 2026-10-15

- **mcp** — Masking a member's value still exposed its parents; parents and passwords are now masked, read-audit retention is enforced, and read-only deploy checks require named targets
- **viewfinder** — Approve/Reopen in card layout did nothing because it checked a grid that does not exist; cards now act on their line
- **viewfinder** — Card layout stayed on "Loading…" after drawing; it now clears
- **viewfinder** — The line-item form showed calculated fields as empty lines and left asset type unnamed; only typed lines show and asset type is its own column
- **lens-store** — A Lens could not be saved on a model template; model templates are now accepted

### 2026-10-14

- **model-store** — Model writes used the server's admin account instead of the signed-in caller; they now use the caller's connection
- **lenses** — A refused text write showed TM1's `StringCellUpdateError`; it now explains the cell in plain words
- **lenses** — Text writes could go into numeric cells and number writes into text cells; each now stays in its own cell type, including conflict checks

### 2026-10-13

- **lens app** — The hover preview script did not parse because regex escapes were lost in the server template; it now parses and has a test
- **lens-kit** — A read-only watcher's grid had no cursor outline or unsaved-typing tint; read-only cells now show both
- **lens-kit** — A previous cell outline stayed after focus moved; every style now sets every key
- **lens-kit** — "Still editing?" appeared immediately because inline display overrode `hidden`; it now waits
- **lenses** — Presence showed more than one avatar per person and dead connections lingered; one avatar per person and faster cleanup
- **lenses** — A failed editing check could leave the grid hidden, and the toolkit was cached for an hour; failures no longer hide the grid and the cache is short

### 2026-10-12

- **users** — New users were created with no password because add and set-password were one run; they are now separate runs
- **lenses** — TM1 write refusals surfaced raw errors; they now read in plain English with the TM1 code kept
- **lens app** — Sign-in did not verify every step; the frame is sandboxed, account lock-out is guarded, errors are cleared, and sign-out returns to sign-in

### 2026-10-11

- **lens app** — The preview frame was rendered with `srcdoc` and blocked; it is now a real URL
- **lens app** — `/api/lens/meta` was captured by `/api/lens/:name`; the meta route now wins and the `LENS_CONFIG` override works
- **lenses** — The save check ran a query fragment built at runtime; it now skips fragments instead of failing
- **auth** — An ended IDE session left screens open and a server sign-in did not reload them; both are now handled
- **lenses** — A reply meant for an earlier preview page could answer the next one; replies are now tied to their page

### 2026-10-10

- **change-sets** — After signing in to a server as a different user, the change-set bar kept showing the previous user's change set and hid "start a change set"; it now follows whoever is signed in to that server
- **change-sets** — User names were matched case-sensitively ("JDLove" vs "jdlove"), so one person's change sets could split; matching is now case-insensitive and the bar shows who you are on that server
- **read-only** — Saving on a read-only server first asked for a change set, then failed with no message; it now refuses straight away with a clear read-only message
- **read-only** — The IDE let you start a change set on a read-only server (the MCP already refused); now refused
- **read-only** — The list of read-only servers loaded only once at page load (before sign-in), and a failed load was reused; it now loads when needed and retries
- **read-only** — Marking PROD read-only also blocked approved deploys; read-only now means no direct edits, while approved deploys still go through
- **deploy** — A deploy shipped everything on DEV, not just the change set; a release now contains exactly the change set's objects, enforced on the server
- **deploy** — The approval check could pass for a different commit from the one being pulled; the approved and incoming commits are now compared, and the deploy refuses if they can't be
- **deploy** — Approvals are stored under short commit IDs, so a lookup with a full ID missed them; short and full IDs now match (7+ characters)
- **deploy** — First-time setup could run against a read-only or already-deployed server, and Promote could write to a read-only server or to itself; both refused
- **deploy** — The GitHub token was masked only at its first occurrence in error messages; every occurrence is now masked
- **deploy** — A server error showed in the deploy screen as a confusing "not JSON" failure; the real message is now shown
- **release** — Subsets and views never reached PROD (TM1 Git's pull has no operation for them); they are now applied from the release after the pull and checked
- **release** — MDX views lost their query in a release; the query file now travels with the view and is checked on arrival
- **release** — Subsets with the same name on different dimensions (and views on different cubes) could be confused; they are now identified by their parent
- **release** — After a deploy, chores were checked as if they were processes; they are now checked as chores
- **release** — A subset or view that failed to apply, or an object that didn't arrive, still showed the deploy as OK; it is now marked failed
- **release** — TM1 refuses branch names containing `/` (`release/PROD`); releases now use `release-<target>`, and Approve is blocked when the pull plan fails
- **release** — "Skip" lines in the pull plan were counted as changes, wrongly refusing a valid release; they are now ignored

### 2026-10-09

- **sessions** — The Sessions Monitor showed change sets instead of TM1 sessions (two routes shared one address); TM1 sessions now have their own
- **sql** — Saving an edited SQL connection without retyping the password stored the `••••••••` mask as the password; the mask now means "keep the stored one"
- **rules** — The "`)` inside brackets — did you mean `]`?" check never fired; it now reports a `)` that closes a `[`
- **mcp** — The MCP could change servers marked read-only; writes there are now refused, as the IDE already did
- **tests** — `npm test` failed on Node 22; fixed

### 2026-10-07

- **change-sets** — Adding an element was recorded under the element's name instead of its dimension, so later steps listed a "dimension" that didn't exist
- **change-sets** — Starting a change set from the deploy screen didn't refresh the Change Sets panel
- **change-sets** — Review flagged the change set's own objects as "outside this change set"
- **change-sets** — Tests added through the MCP were linked to the newest open change set on the server instead of the author's own
- **deploy** — The deploy screen closed on a stray click outside it, and jumped past the deploy result before you could read it
- **subset editor** — Showed no member count, which hid that a subset on PROD had lost 36 members; the count is now shown
- **deploy** — Hardening before the TM1 Git deploy was released (several fixes, 6–7 Oct): the approval gate is enforced on the server and bound to the exact commit; Revert needs an approval and restores from the approved commit, not live DEV; deletes and attribute values are limited to the change set (PROD-only objects and PROD-maintained attributes are left alone); the old unprotected deploy routes are retired; Close runs its tests on the server; a stuck deploy lock can be cleared

### 2026-10-05

- **view** — Saving a native view with a title that had no selected member stored `Selected: null`, which TM1 Git can't pull back in (the pull rejects the view). The save now picks the hierarchy's default member as the selection, leaves the title's subset exactly as set, and stops the save if no member can be found
- **git-drift** — The drift check compared PROD against the wrong commit: TM1's `DeployedCommit` is overwritten by every git operation, including PROD's own push to `prod-live`, so the check compared `prod-live` against itself. The IDE now records the commit it actually deployed for each server and checks drift against that

### 2026-10-04

- **chore** — The editor read/wrote `Steps`, but TM1 stores chore steps as `Tasks` — an existing chore opened with no usable step and every save was rejected
- **chore** — A task `Ordinal` property is rejected on v11 ("Unrecognized ChoreTask property"); task order now follows array position
- **chore** — Frequency was sent as an object; TM1 expects an ISO duration string, and a zero duration is invalid (`SystemValueInvalid`) — the editor now requires a repeat frequency
- **chore** — `StartTime` lacked the UTC `Z` (it's an `Edm.DateTimeOffset`) and the required `DSTSensitive` was omitted
- **chore** — Process binds used `encodeURIComponent`, so a spaced name like "CON Save All" saved as `Processes('CON%20Save%20All')` and could hang the save indefinitely
- **chore** — `cancelThread` used the Jobs action `tm1.Cancel`; threads need `tm1.CancelOperation`
- **chore** — The process-usage scan and the deploy risk check read `Steps`, so they silently missed every chore step on v11
- **auth** — One login was reused for every TM1 server; a server with a different password rejected it and repeated rejections could lock the account (`MaximumLoginAttempts`). Each server now has its own login and a rejected password is never retried
- **auth** — Every request opened a new TM1 session (538 found left open on one server); sessions are now reused per server and closed on sign-out
- **auth** — Direct CAM sign-in sent the namespace in a non-standard header; now IBM's documented `CAMNamespace` format (as TM1py)
- **auth** — A failed IDE sign-in reset the page and wiped the error message, so it looked like nothing happened
- **auth** — Some screens called the API without the session token (e.g. the server version badge never appeared)
- **auth** — The first request after signing out of a server could fail with "socket hang up" (closed connection reused)
- **user-management** — Acted on the login server instead of the server selected in the IDE (a password reset could hit the wrong server)
- **user-management** — Showed an empty list when not signed in to the server; now says so, with a Sign in button
- **assertions** — Reading and writing documents in a v11 server's Applications area failed (v11 needs the `.blob` id and `/Document/Content`)
- **assertions** — An empty or damaged stored assertions file was treated as "no assertions", so change-set and deploy checks passed silently; it now fails loudly
- **assertions** — Errors creating the stored assertions file were swallowed and resurfaced as a misleading "not found"
- **assertions** — Adding or removing an assertion on a server whose tests live in the model always failed: v11 answers "document already exists" with error 226, which wasn't recognised. The document is now checked for before creating it
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
