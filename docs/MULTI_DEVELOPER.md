# Multi-developer — parked for review (partial: change sets per person built)

Single-developer is the priority: prove the whole loop (DEV → repo → TEST → PROD → `prod-live` drift)
working end to end first. Multi-developer is mostly the same pieces run per developer, plus an
integration server — so it's far easier to add once the basic loop is proven. This doc records the
design and the review points for when it's picked up.

## Built already (5 Oct) — change sets per person on a shared DEV

The change-set machinery now key by **(server, user)**: one open change set per person per server,
every save lands in the saver's own change set, and `getCrossSessionTouches` warns on overlap at
close/deploy ("object X also changed in Bob's open change set — its DEV state includes his edits").
The agent's identity passes through to the MCP (`TM1_MCP_USER`, default `ai-agent`). This covers a
small team (≤3) sharing one DEV server with no collisions. The rule: **separate change sets, warn on
overlap, and agree on the shared objects.** This resolves review points #3 and #4 below.

## The principle that makes it work

**The IDE stores no model data.** Tests, change sets, approvals, audit and deploy history live in the
model (server + repo). So the IDE is a thin, disposable tool either way — which means the deployment
model (one shared IDE vs. a personal IDE per developer) doesn't change the architecture, only the tool
layer (connections, secrets, prefs, cache).

## The multi-developer mechanics

- **The repo is the hub** — collaboration happens in the central model repo; every developer's branches
  live there and are visible to all.
- **Branches isolate** — each developer works on their own branch (branch-per-change-set). A deploy
  pulls a branch, so an approved change set ships exactly its own commits.
- **A local DEV server per developer** — each person's working copy, obtained by `GitInit`-ing a fresh
  local TM1 server to the repo and pulling. Safe editing, no contamination.
- **Change-set lock** — one open change set per server/branch, so two people can't claim the same one.
- **Merge/review into an integration branch** — a developer's branch is reviewed and merged into the
  shared integration branch; conflicts on the same object are resolved at merge, not by clobbering.
- **Approval → central PROD** — only approved change sets (on the shared branch) pull into PROD.

## Six review points (decide when picking this up)

1. **Deployment model** — shared server IDE vs. personal workstation IDE. Both work because the IDE is
   stateless; decide which to offer first (personal is the default for this project's ethos).
2. **Per-developer DEV servers** — each person maintains a local TM1 copy (heavier) vs. a shared DEV
   farm (lighter, but introduces the same-object constraint below). The repo-pull gives you the working
   copy either way.
3. **Branch-per-change-set isolation** — confirmed as the mechanism; decide the branch naming and how a
   developer's branch integrates back (merge/review).
4. **The open-change-set lock** — needed once more than one person can hold a change set; where the lock
   lives (in `}ChangeSets` when change sets move to the model).
5. **Integration server** — a shared server where reviewed branches merge and the deployable state is
   assembled before PROD. Its relationship to TEST and the change-set lifecycle needs defining.
6. **The same-object caveat** — on one shared DEV server, two people editing the same object clobber and
   contaminate each other's branches (TM1 Git pushes whole-server state, not per-person changes). Either
   use separate DEV servers or strictly coordinate objects. This is a physical TM1 limit, not an IDE fix.

## The flow (for reference when implementing)

```
Local DEV (person A) ──push──▶ repo (branch A) ──merge/review──▶ integration ──approve──▶ central PROD
Local DEV (person B) ──push──▶ repo (branch B) ──┘
```

Already working subset (built): one shared DEV, one change set per person, overlap warnings on
close/deploy. Still parked: per-developer DEV servers (review point #2) and the integration branch
(#5).

Status: **parked.** Single-developer loop is the active priority.