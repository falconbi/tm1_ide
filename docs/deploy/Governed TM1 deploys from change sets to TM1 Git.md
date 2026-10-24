# Governed TM1 deploys: from change sets to TM1 Git

Oct 10, 2026 · @James David Lovering

## The goal

A deploy to production must ship exactly one change set's objects, no more, and nothing else may slip in with it. Everything else in this document follows from that one rule.

We built the TM1 IDE so that developers and AI agents can build TM1 models fast. Speed is the easy part. The hard part is trusting what lands on production. When an AI agent builds a cube, its rules and the processes that load it, someone still has to answer four questions before it reaches PROD:

- **Scope:** what exactly is changing, and nothing besides?
- **Approval:** who approved it, and did they approve exactly what shipped?
- **Drift:** has anyone changed PROD by hand since the last deploy?
- **Audit:** can we show afterwards who did what, when, and why?

A change set is our unit of work. A developer (or an agent acting for one) opens a change set, the IDE logs every object they touch, and tests run against it. The change set is then closed, approved and released. Approval, audit and accountability all hang on the change set being exactly what ships.

## Where we started: change sets over the REST API

The first pipeline was ours end to end. It was scoped to the change set from day one, but every object had to be serialised and re-created by our own code. Each new object type brought a new fidelity bug.

How it worked:

1. **Log.** The IDE records every save (rule, process, dimension, subset, view) in a change log, keyed to the open change set.
2. **Package.** The packager reads the change set's log, fetches each object from DEV over the TM1 REST API and writes a manifest of JSON files.
3. **Risk gate.** The package is diffed against a stored baseline snapshot of the target, and a risk report is produced for approval.
4. **Deploy.** The deployer re-creates each object on PROD over REST, then runs verification assertions.
5. **Baseline.** A fresh snapshot of PROD is stored; the next drift check compares against it.

Scope was right: only logged objects shipped. Fidelity was the problem. Every phase of a real workforce-planning model landed clean on DEV, then the deploy fought back:

| Papercut | What went wrong |
| --- | --- |
| Attribute values | Replayed only when the deploy created the dimension, not on a redeploy |
| Subset collisions | The log keyed subsets by name only, so two `Default` subsets on different dimensions collapsed to one |
| Lossy views | A named-subset axis was read back as "all members", so a phantom change entered the package |
| Unreadable views | A view with an unresolved axis could corrupt the target instead of being refused |
| Manual post-deploy steps | Seed, build, load, create subsets and reprocess feeders were run by hand after every deploy |
| Baseline timing | Verification ran before the manual seeding, failed, skipped the baseline, and left stale drift noise for next time |

The model grew three "scar tissue" processes whose only job was to rebuild state the deploy failed to carry. We hardened the pipeline and fixed all six. But the pattern was clear: we were maintaining our own copy of IBM's object format, and every object type was a new place to be wrong.

## Why we moved to TM1 Git

We moved to TM1's built-in Git integration so that IBM owns the object format and the transport, while the IDE keeps governance. We evaluated it in a lab first: a DEV and a PROD server sharing one private repo, eight checks.

What TM1 Git gave us:

- **IBM's own format.** A push writes cubes, dimensions, processes, rules, views and subsets as files. Rules and TI are plain text, so a change is a readable git diff.
- **No serialiser to maintain.** TM1 applies its own files on a pull, so the lossy-view and subset bugs disappear by construction.
- **History for free.** Every push is a commit; standard tools (PAW, TM1py, any git client) can read the repo.
- **Credentials stay with the IDE.** TM1 doesn't store the token; the IDE passes it on every call.

What the evaluation found it does not do:

| Check | Result | Consequence |
| --- | --- | --- |
| Attribute values travel | No | A value change produced an empty commit. The IDE writes values itself. |
| Deletes propagate | No | A pull never deletes. The IDE reconciles deletes. |
| Drift detected | No | The pull plan is a commit diff, not a live-state check. The IDE pushes PROD to a `prod-live` branch and diffs it. |
| Scoped to a change set | Partly | A pull applies **every change on the branch** since the target's deployed commit. |

We chose a hybrid: TM1 Git moves structure and history; the IDE handles values, deletes, drift and approval.

The last row is the one that mattered. The evaluation wrote it down plainly (check #4: "you cannot select individual objects in GitPull — it takes a branch") and called "a branch per change set" an untested idea. We built the deploy anyway and treated it as a detail. It was not a detail.

## The discovery: a pull ships the whole branch

After a week of building on TM1 Git, we found the deploy was shipping the whole of DEV, not the change set. The first version worked like this: DEV pushes its entire model to the `dev` branch, an approver approves that commit, PROD pulls it.

That breaks every one of the four goals once two developers share DEV:

- **Scope.** Developer A's change set touches one process. Developer B has half-finished rules on DEV. A's deploy pushes and pulls both.
- **Approval.** The approver reviews A's change set, but the commit they approve holds B's work too.
- **Audit.** The record says "A deployed change set 12". PROD received more than change set 12.
- **Safety.** Nobody should have to check other developers' unfinished work before deploying their own.

The question the project owner asked was the right one: "I assumed only the change set's objects were deployed." Every governance claim rested on that assumption. A whole-model snapshot per deploy was not acceptable, so the transport had to be bent to fit the rule, not the rule to fit the transport.

The lesson: an evaluation finding marked ⚠️ is a design decision waiting to be made. Ours was made by default, and it was found a week later by the person whose requirement it broke.

## The solution: build a release commit per change set

We stopped deploying DEV's branch and started building a release commit that holds only the change set's objects. TM1 still pulls a whole branch, but the branch now differs from what PROD has by exactly the change set.

How a release is built (`core/git-release.js`):

1. **Start from what PROD has.** The base is the commit the IDE recorded at PROD's last deploy. Not TM1's own `DeployedCommit`: that is overwritten whenever PROD pushes its live state for a drift check.
2. **Map the change set to files.** Each logged object becomes its repo files: a process is its `.json` and `.ti`, a cube its `.json` and `.rules`, an MDX view its `.json` and `.mdx`.
3. **Copy only those files from DEV's commit** onto the base. Deleted objects are removed. Nothing else moves.
4. **Commit to `release-<target>`.** One release branch per target. A rebuild is allowed only while the branch still sits on the same base.
5. **Record it on the change set** (release commit and target), so the approval can be bound to it.

When PROD pulls `release-PROD`, the plan shows `Update` for the change set's objects and `Skip` for everything else, because nothing else differs from what PROD already had.

Two gaps needed their own answer:

- **Subsets and views.** The lab proved TM1 Git's pull has no operation for them; they never land. Rather than drop them, the IDE applies each included subset and view over REST straight after the pull, from the release commit's files. MDX subsets keep their expression, static subsets their element list; MDX views are read from the `.mdx` file, native views rebuilt from their axes.
- **Deletes and attribute values.** As before, a reconcile step applies only what the change set recorded: its deletes, and the values for dimensions it touched.

The lab proved it for every object type we use: rule, dimension element, process, chore, MDX subset, static subset, native view and MDX view. All eight arrived on PROD, and nothing else did.

## The safety design

Approval is bound to the exact release commit, and the deploy refuses at the first gate that doesn't hold. Each refusal says in plain words what to do next.

&#91;embedded content: deploy gates · 7 steps, 5 refusals\]

Around the flow, three rules hold on the server, not just in the wizard:

- **PROD is read-only to editing.** Servers listed as read-only refuse every save from the IDE. The only way in is an approved release.
- **Only built releases deploy.** A deploy of anything but `release-<target>` is refused. First-time setup is the only whole-model path, and it refuses once a target has been deployed.
- **Change sets are owned.** A change set belongs to one TM1 user on one server; nobody else's work rides along.

The drift pause is deliberate. When PROD has been changed by hand, the IDE does not revert it or copy it back automatically. A developer re-applies the change on DEV in a change set, and it is released like any other. Slower, but nothing is lost and everything is approved.

## Lab lessons: TM1 Git quirks

Every one of these was found by running the deploy wizard against a real DEV and PROD pair, not by reading documentation. Unit tests passed throughout; the lab is where the deploy actually broke.

| Quirk | Symptom | Fix |
| --- | --- | --- |
| TM1 forbids `/` in branch names | Pull refused for `release/PROD` | Branches are named `release-<target>` |
| Short vs full commit IDs | TM1 reports a short ID, git a full one; the approval check said "moved" | `sameCommit`: exact match, or one is a prefix (7+ characters) of the other |
| `DeployedCommit` is overwritten | PROD's drift push resets it, so the next release was built on the wrong base | The IDE records the deployed commit itself and trusts only that |
| Pull plans expire in seconds | A plan created early returned 404 on execute | Create, check and execute the plan in one step |
| Plan operations are strings | `Update Cubes('X')`, `Replace Dimensions('X')`, `Skip …` | Parsed one by one; every non-`Skip` op must be in the release, or the deploy refuses |
| Subsets and views never land | The plan has no operation for them | Applied over REST after the pull, then verified |
| First pull is a full overwrite | A never-pulled target gets every object | A separate first-time setup path, refused once a target has been deployed |
| A view with a deleted title member | `Selected: null` blocks the whole pull | The readiness check refuses it before push |
| HTML instead of JSON | A route error surfaced as a parse failure in the wizard | Errors are returned as JSON with the real message |

One verification bug is worth calling out. The post-deploy check read PROD's "previous" commit after the deploy had already recorded the new one. The diff was empty, so the check verified nothing and always passed. A check that cannot fail is worse than no check, because it is trusted.

## How the work was done

Three AI agents and one person built this, each with one job, and no agent both wrote and approved its own code.

| Who | Job | Never does |
| --- | --- | --- |
| OpenCode | Builds features and fixes on a private local branch, runs the tests | Pushes to GitHub |
| Local Claude | Checks OpenCode's work, runs the lab, publishes to GitHub through a privacy check | Publishes private client work |
| Cloud Claude | Reviews each pull request, writes specs, reports findings | Changes code or merges |
| The project owner | Sets the requirements, relays between agents, merges | — |
| The lab | A real DEV and PROD pair: the final word on whether it works | — |

The publish step matters. The private branch carries client model work, so its history is never pushed. Local Claude replays the commits onto a clean branch from public `main`, checks it for private names and data, and pushes only that. Cloud Claude then opens the pull request and reviews it.

What this caught that a single agent would have missed:

- The review of the subsets-and-views release found that a failed subset apply still showed "Applied" and marked the change set deployed. It was fixed before merge.
- The verify-nothing bug (above) was found by reading the diff, not by a failing test.
- The whole-branch problem was found by the person, not by any agent. Agents check what they are asked to check; the requirement has to be stated.

What went wrong in the process: instructions passed between agents and the person by hand drifted out of step. Once an agent told the person to pull `main` and restart, when the IDE actually runs from the private branch. Every instruction now gets checked against where the code actually runs before it is sent.

## Lessons learned

1. **Write the rule down first.** "A release ships exactly its change set's objects" is now rule 1 of the deploy lifecycle. Had it been written on day one, the whole-branch pull would have failed it on day one.
2. **A partial finding is a decision.** The evaluation marked scoping ⚠️. Resolve every ⚠️ before building on it.
3. **Bend the transport, not the rule.** TM1 Git pulls branches, so we build branches that differ by exactly one change set.
4. **Trust your own record over the tool's.** TM1's `DeployedCommit` moves under you; the IDE's recorded commit doesn't.
5. **Refuse loudly; never succeed silently.** Every gap (an op outside the release, drift on PROD, an object that didn't land) stops the deploy or marks it failed, with a plain message saying what to do.
6. **Keep humans in charge of drift.** When PROD has drifted, deploys pause. The change is re-applied on DEV in a change set and released like any other. No automatic revert or promote: each automated path we tried opened a new way to lose work.
7. **The lab decides.** Unit tests passed while the deploy was still broken in several ways. Only a real DEV and PROD pair finds those.
8. **Separate the builder from the reviewer.** The same agent should never write and approve a change.

## What's next

- Continuous integration on every pull request: tests, client build, lint.
- Escaping object names in REST paths (names with a `'` are not yet safe everywhere).
- Retire the automated drift Revert and Promote paths.
- Split the 4,000-line `server.js` into route modules.
