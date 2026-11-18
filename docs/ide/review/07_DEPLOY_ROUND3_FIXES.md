# 07 — Deploy round 3: releases ship whole objects, and TI changes are visible

Build brief for OpenCode. Work on branch `deploy-round3`, which starts from `main` (`fbee816`).

## Why: the failure on 18 Nov

The release of change set **"Testing WFP"** (TM1_Test_DEV → TM1_Test_PROD) failed at the pull
plan:

> Failed to read Hierarchy "By Location" … Cannot open the file specified by link
> "By Location.subsets/Cities.json"

How it happened:
- `release-TM1_Test_PROD` (`b3695adc`) contains `dimensions/WFP Position.hierarchies/By Location.json`.
  That file's `Subsets@Code.links` names `By Location.subsets/Cities.json` and `Default.json`.
  **Neither file is in the release.** Both are on `dev` (`e2e94492`).
- `buildRelease` (`core/git-release.js`) ships only files whose object is **recorded in the
  change set**.
  - The hierarchy file maps to the dimension `WFP Position`, which the change set touched
    (element edits), so it shipped.
  - The two subsets map to `subset` objects. They were created by the TI process
    *WFP Rebuild Location Hierarchy*, running inside TM1, so the change set never recorded them.
    They were left out.
- **The general gap:** a change set records saves made through the IDE and MCP. Anything a TI
  process creates or changes (subsets, views, hierarchies, elements) is invisible to it.
  Process runs aren't recorded at all: "Testing WFP" has 81 entries and no runs.

This round fixes all three layers.

## Step 1 — A release never ships a broken link (bug; `BUG_FIXES.md` line)

**The link closure.** In `core/git-release.js`, add a pure `linkClosure(files, read)`:
- for each JSON file in the release, read every key ending in `@Code.links` (an array) or
  `@Code.link` (a string);
- resolve each path relative to that file's folder;
- return the linked files that are missing from the release tree.

Test it on plain objects:
- a hierarchy that links two subsets;
- a cube that links views;
- a dimension that links hierarchies;
- a link that is already present;
- a nested link (a linked file that links again).

**`buildRelease`.** After applying the change set's files, run the closure on the release
tree. For each missing linked file:
- **it's on `devCommit`, and its object has no owner** (`ownerOf` finds no other change set):
  include it, and list it in a new result field
  `addedAsDependency: [{ type, name, parent, file, neededBy }]`;
- **it's owned by another change set:** refuse, with
  `<neededBy> needs <file>, which belongs to change set "<owner>". Release that change set first, or together.`;
- **it isn't on `devCommit` either:** refuse, with
  `<neededBy> links <file>, which does not exist on DEV.`

Repeat until nothing new is added. The links are nested, and the loop must stop.

**`checkDependencies`.** It runs the same closure against the release commit and reports any
missing link as a blocker. That catches a release built before this fix, such as today's.

**The review screen.** `DeployWizard.jsx` shows `addedAsDependency` as its own list, for
example "Added because something in the release needs it (N)", with the `neededBy` for each.

## Step 2 — "Add to this release" for changes nobody owns

Today the review step lists "Left on DEV — not shipped" (`DeployWizard.jsx:376`). Some of
those are TI output that belongs with this release.

- Next to each excluded item **with no owner**, add a checkbox: **Add to this release**. An item
  owned by another change set gets no checkbox. It shows its owner, as today.
- Rebuild calls `buildRelease(changeSet, target, { addObjects: [{ type, name, parent }] })`.
- **`buildRelease` validates `addObjects` itself.** Each one must be in `excluded` with no
  owner. Otherwise it refuses and names the object. The client is never trusted on ownership.
- Added items appear in a new result field `addedByUser: [{ type, name, parent, file, by }]`.
  `by` is the signed-in user.
- **Record the decision:** include `addedByUser` and `addedAsDependency` in the release record
  (`cl.setSessionRelease`) and in the deploy history record. The history then shows who added
  what, and why it shipped.
- The rebuild keeps today's rules: same base, and `--force-with-lease`.

## Step 3 — Record process runs in the change set

- `POST /api/process/run` (`routes/processes.js:138`), the MCP `run_process` tool
  (`tools/tm1mcp/tools/develop.js`), and the MCP chore run (`c.executeChore`,
  `tools/tm1mcp/tools/build.js:615`) each write one entry when a change set is active. The IDE has
  no chore "run now" today, so don't add one:
  - `action: 'PROCESS_RUN'`;
  - `objectType: 'process-run'`;
  - `objectName`: the process name, or the chore name for a chore;
  - `detail`: parameters (passwords and tokens masked with the existing masking), status and
    duration.
- **`process-run` must not be in `ENTRY_TO_OBJECT`.** A run is a record, not a change. It must
  never make a release include the process's own file. Add a test that proves it.
- The change set view lists runs under their own heading, "Processes run".
- **At review:** if the change set has runs and there are unowned "Left on DEV" items, show
  one line above the list, for example "This change set ran 2 processes; unowned changes below
  may be their output".

## Tests and rules

- Tests use plain objects and stubs. Test `buildRelease` with a local bare Git repo in a temp
  folder only if that works without a network. Otherwise test the closure and the
  `addObjects` validation as pure functions. **No GitHub, no TM1.**
- One commit per step. Before each commit:
  - `npm test` passes;
  - `cd client && npm run build`, then commit `static/` when the bundle changes;
  - client lint is at or below `client/lint-baseline.json`;
  - root lint is 0.
- Do not push. Do not restart any server. Don't touch the real repo, its branches, or any TM1
  server.
- Leave the untracked `docs/images/*.png` alone. They belong to another branch.
- Any other bug goes in `07_DEPLOY_ROUND3_QUESTIONS.md`.

## When finished

`docs/ide/review/07_DEPLOY_ROUND3_FIXES_DONE.md`:
- one line per step, with its commit hash and test counts;
- lint before and after;
- every link key the closure handles;
- anything not done;
- the live check list below.

## Live check list for James

1. **Today's release:** rebuild the release for "Testing WFP" → TM1_Test_PROD. `Cities` and
   `Default` should appear under "Added because something in the release needs it", and the pull
   plan should now succeed. Continue to approve and deploy.
2. **Owned dependency:** in two change sets, add a subset in one and a hierarchy linking it in
   the other. Releasing the hierarchy alone is refused, and the message names the other change
   set.
3. **Add to this release:** run a process on DEV that changes a subset, outside any edit. At
   review, the subset is under "Left on DEV" with a checkbox. Tick it, rebuild, and check it
   ships, with your name in the release record and deploy history.
4. **Owned item:** an item owned by another change set has no checkbox.
5. **Process runs:** run a process from the IDE and one through MCP with a change set open.
   Both appear under "Processes run", and parameter passwords are masked. The release doesn't
   include the process file just because it ran.
6. **Old release blocked:** before rebuilding (check 1), the review step's dependency check
   flags the missing `Cities.json` and `Default.json` instead of reaching the pull plan.
