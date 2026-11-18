# 07 — Deploy round 4: a catch-up release, a "won't deploy" mark, and a clean list

Build brief for OpenCode. Work on branch `deploy-round4`, which starts from `deploy-round3`
(`f9831a2`).

## Why

James decided on 18 Nov: **releases go one change set at a time, in dependency order.** No
combined releases.

Releasing in order on TM1_Test_DEV runs into history:
- Of DEV's 47 change sets, **only 4 are marked deployed**, all pipeline proofs from 6–10 Oct.
- The WFP model reached PROD before change-set releases existed, so the IDE thinks ~40 sets are
  unreleased.
- Each release therefore refuses because of an older set:
  "Testing WFP" needs "AI: Workforce…", which needs "Subset Changes", and so on back to September.
- About 20 of those sets are proofs and lab work that must never ship, such as
  "WFP_Lab — test model, never deploy", "ChangeSet_A" and "Proof re-run". They can still own
  objects and block releases.

The fix has three parts:
1. **Won't deploy:** a change set that must never ship is marked, and then owns nothing.
2. **A catch-up release, once:** it brings a target level with DEV, as an explicit, reviewed,
   approved release.
3. **Covered:** after a catch-up deploys, the older unreleased sets it carried are marked as
   covered by it, so in-order releasing starts clean.

**Rule 1 stays.** `core/git-deploy.js` `execute` refuses anything that isn't a built release
("a deploy always ships a built release — never whatever happens to be on DEV"). The catch-up
does **not** re-open the whole-branch path. It's a built release on `release-<target>` like any
other, so prepare, approve, execute, verify and history all work unchanged.

## Step 0 — Remove "or together" (wording; `BUG_FIXES.md` line)

Releases are one change set at a time.
- In `core/git-release.js` (~247, ~297 and the CheckRules note ~501) and in `routes/deploy.js:131`,
  remove "or together" and "or build a combined release".
- The new message: `Release "<owner>" to <target> first, then rebuild this release.`
- Update the tests that match the old text.

## Step 1 — Won't deploy

- A change set can be marked **won't deploy**, with a required reason. It can also be unmarked.
- **Who:** the set's owner or a TM1 admin, through the same ownership check as close/resume
  (`canManageSession`).
- **Storage:** follow the existing pattern for the release and deploy fields. In `change-log.js`,
  add the columns `wont_deploy_at`, `wont_deploy_by` and `wont_deploy_reason`. On a model-owned
  server, also write them into the change set's model record, the same way the other closed-set
  fields reach it.
- **Its effect:**
  - `ownerOf` (`core/git-release.js`) skips it, so it never owns anything in a release;
  - the wizard refuses to commit or release it, with a plain message;
  - the Change Sets list shows a grey **"Won't deploy"** badge and hides these sets by default,
    like deployed ones ("Show N won't deploy").
- An open set must be closed before it can be marked.
- Tests:
  - a won't-deploy set doesn't own a subset that another release needs;
  - mark and unmark;
  - a non-owner non-admin gets 403;
  - releasing a marked set is refused.

## Step 2 — The catch-up release

The catch-up is a **change set of its own kind**, so the existing pipeline carries it unchanged.

- **Who:** a TM1 admin only (`requireTm1Admin`). Wizard entry: in Deploy, **"Catch up
  <target> with <source>…"**. Show it only when the target has a recorded deployed commit (that's
  the first pull's job otherwise).
- **Starting it:**
  - the admin types: `I understand this brings <target> level with <source>`;
  - the server creates a closed session, `kind = 'catch-up'`, named
    `Catch-up: <target> level with <source> (<date>)`, with no log entries;
  - its `commit_ref` is the source's current pushed commit. Read it from the source's
    `GitStatus` the same way the commit step does. If DEV has unpushed changes, refuse:
    "Commit DEV first".
- **Building it:** `buildRelease` with `{ catchUp: true }`. It takes **every** changed file between
  the base and `devCommit`, with no change-set filtering and no ownership refusals. The link
  closure still runs, so a broken link still refuses.
  - The result lists everything as `included`, plus `coveredSets`: the source's unreleased sets
    that aren't won't-deploy and whose entries touch an included object. This is a preview, for
    the review step.
- **Review screen:**
  - a clear banner: "Catch-up release — ships everything that differs between <target> and
    <source>, outside any single change set";
  - the included list, grouped by type;
  - the `coveredSets` list;
  - the pull plan's target-only objects, which TM1 Git doesn't delete.
- **Approve, deploy and verify:** unchanged. The approval links to the catch-up session.
- **History** records it as `Catch-up` with who approved it. `DeployHistory.jsx` shows the kind.
- Tests (pure, or with a local bare repo):
  - `catchUp` includes unowned *and* owned files;
  - a broken link still refuses;
  - non-admin gets 403;
  - unpushed DEV is refused;
  - `execute` accepts the catch-up session's release commit (Rule 1 is unchanged).

## Step 3 — Covered sets

- When a catch-up **deploy succeeds** (where `markSessionDeployed` runs), mark every set in its
  `coveredSets`:
  - `covered_by = <catch-up session id>` and `covered_at`;
  - stored like Step 1's fields.
- A covered set counts as released:
  - `ownerOf` skips it;
  - the list shows **"Covered by catch-up <date>"** and hides it with the deployed ones.
- Open sets are **never** covered, even if they touched an included object. Their work shipped,
  but the set stays in play, and the review lists them as "open, partly shipped by this catch-up".
- Tests:
  - covered sets are marked only after a successful deploy;
  - an open set isn't covered;
  - a covered set no longer blocks a release.

## Step 4 — Docs

- `docs/deploy/DEPLOY_LIFECYCLE.md`:
  - "one change set per release, in order";
  - the catch-up as the one explicit exception, when to use it and who may run it;
  - won't deploy;
  - covered.
- `FEATURES.md` deploy block: one line each.
- Correct `FEATURES.md`'s claim that the Chore editor can "run now". It can't.

## Rules

- One commit per step. Before each commit:
  - `npm test` passes;
  - `cd client && npm run build`, then commit `static/` when the bundle changes;
  - client lint is at or below `client/lint-baseline.json`;
  - root lint is 0.
- Do not push. Do not restart any server. **No TM1, no Git remote**: tests use stubs and local
  bare repos only. Don't mark any real change set; James does that.
- Leave the untracked `docs/images/*.png` alone.
- Other bugs go in `07_DEPLOY_ROUND4_QUESTIONS.md`.

## When finished

`docs/ide/review/07_DEPLOY_ROUND4_FIXES_DONE.md`:
- one line per step, with its commit hash and test counts;
- lint before and after;
- anything not done;
- the live check list below.

## Live check list for James (lab servers TM1_Test_DEV → TM1_Test_PROD)

1. **Won't deploy:** mark the proof and lab sets ("WFP_Lab — test model, never deploy",
   ChangeSet_A/B, Proof…, route-gate-proof, UI Walkthrough, Audit-write proof, Round 2…) with a
   reason. They leave the list and sit under "Show N won't deploy".
2. **Catch-up:**
   - Deploy → "Catch up TM1_Test_PROD with TM1_Test_DEV", then type the sentence;
   - Review shows the banner, the included objects, the covered sets and the target-only objects;
   - Approve, Deploy, Verify.
3. **Covered:** after the deploy, the WFP history sets show "Covered by catch-up". The list shows
   only "AI: Trim WFP" (open, listed as partly shipped) and anything newer.
4. **In order works again:** make a small change in a new change set, close it, and release it
   to PROD. No refusal about old sets.
5. **Rule 1 holds:** the wizard still offers no way to deploy DEV's head without a built release.
