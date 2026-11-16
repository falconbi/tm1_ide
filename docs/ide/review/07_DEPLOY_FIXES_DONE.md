# 07 — Change sets, assertions, deploy: fixes done (round 1)

All ten steps are committed. No push, no server restart, no deploy/push/pull/drift/
assertion against any live TM1 server.

## Commits

| Step | Commit | What changed |
|---|---|---|
| 1 | `91745be` | Added the dated **Known gaps** section to `DEPLOY_LIFECYCLE.md` and the happy-path scope sentence |
| 2 | `a37b329` | `execute()` derives the source from the approval's change set, refuses a mismatch, requires source in release-only mode, always reconciles/runs controls, and puts reconcile errors/skips into `controlReasons`/`controlOk` |
| 3 | `8ad001b` | `ATTRIBUTE_VALUE_SET` logging from the element-attribute route, bulk import and MCP tool; manifest pairs/deletes corrected; blank values clear; tests for manifest/reconcile/MCP |
| 4 | `4ab1bea` | Unrecognised pull-plan operations are refused with the raw operation text |
| 5 | `c5acb1d` | First pull records the pulled commit as the target anchor and returns it |
| 6 | `2b59168` | Git push runs readiness and refuses on blockers; Git-transport readiness is an error; GitSetup disables Link/Commit; readiness parser handles `]]` |
| 7 | `52826ba` | Standalone drift checks take the target deploy lock; deploy's internal check uses `lock:false` to avoid self-deadlock |
| 8 | `a1d2115` | Close/resume/description require the owner (case-insensitive) or a TM1 admin and check read-only first; UI hides controls for another user's set |
| 9 | `5968704` | `runOne` records `}TestResults`; assertion writes use `gateWrite`; finite numeric validation; client identity/change-set ignored; history read errors surface |
| 10 | `f6018f2` | One deploy surface; removed DeployPanel/ImportPackagePanel and unreachable routes; model deploy history route; Release opens the wizard; target reset; docs updated |

## Tests and lint

- Baseline before step 2 (step 1 was docs-only): **445 tests** (444 pass, 1 skipped).
- Final: **460 tests** (459 pass, 1 skipped, 0 failed); lint **129 problems** (20 errors,
  109 warnings) throughout.
- Client builds ran for steps 3, 6, 8, 9 and 10 (`static/` committed when it changed). Steps 2,
  4, 5 and 7 were server/core/docs only; step 1 was docs only.

## Routes removed in step 10

`/api/deploy/object-diff`, `/api/deploy/diff`, POST/GET `/api/deploy/package`,
`/api/deploy/packages`, `/api/deploy/package-zip`, `/api/deploy/import-zip`,
`/api/deploy/risk`, `/api/deploy/drift-check`, `/api/deploy/verify`,
`/api/deploy/scoped-snapshot`, and POST `/api/deploy/archive`.

Kept because they are still reachable: `/api/deploy/baseline`, `/api/deploy/seed`,
`/api/deploy/pre-delete-check` (Dimension Editor), and the read-only archive list/detail used by
the collapsed "Earlier REST pipeline" section. Added `/api/deploy/git/history`.

## Behaviour James should verify live (he runs live checks)

1. **First pull on a scratch target:** after it completes, confirm the pulled commit is recorded
   as the target's deploy anchor and the next release builds without a manual baseline seed.
2. **Release with an attribute edit:** change one attribute value (including a blanking edit)
   in a change set, release/deploy, and confirm the manifest/reconcile carries the pair and the
   blank clears on the target. Repeat through bulk import and MCP `set_attribute_values`.
3. **Push with a readiness blocker:** create/prove a blocker (e.g. member-less title or bad
   round-trip name), confirm the Git push is refused and the setup Link/Commit controls are
   disabled.
4. **Drift concurrency:** run two drift checks together; one should report busy, not race the
   `prod-live` push.
5. **Change-set ownership:** try close/resume/description as another user (403) and as the owner
   (works); confirm the UI hides the controls for another user's set.
6. **Assertion history/validation:** run one assertion and confirm a `}TestResults` run; submit
   a non-numeric expected/tolerance and confirm 400; confirm a history read failure shows an
   error instead of "no history".
7. **One deploy surface:** Deploy Center's New Deploy and Change Log Release open the wizard;
   History shows model deploy records first and archives collapsed; no removed route is linked.

## Not done, and why

- **Round 2 — fresh IDE reads model-owned governance (no local migration marker)** was explicitly
  out of this brief. The local marker/state split remains.
- **`firstPullAnalysis` is still not wired into the setup screen**, and its element-loss path was
  not corrected in this round. It remains listed in Known gaps.
- **Bulk-import logging** is implemented but proven by the core/MCP tests rather than an HTTP
  route test; James should exercise the live bulk import (see check 2).
- **Deploy History model route and the wizard UI reset** have no browser automation (Playwright
  is not used); the route is a simple merge and the build/lint pass.
- **Admin check** for session ownership uses TM1's `Admin` group through `ActiveUser`, the same
  helper used elsewhere in `server.js`; there is no separate IDE role system.
