# 03 — Editors round 2: one way to call the server

Completed 17 Nov 2026. One commit per step. This round removed every raw `fetch(` from
`client/src` outside `client/src/lib/api.js`; splitting the large editors was explicitly out of
scope.

| Step | Commit | Tests |
|---|---|---|
| 0 — Static-before-parameter route test | `8cde32a` | 508 (507 pass, 1 skip) |
| 1 — `lib/api.js` | `88c0577` | 510 (509 pass, 1 skip) |
| 2 — Dimensions and subsets | `acab6ee` | 510 (509 pass, 1 skip) |
| 3 — Views and MDX | `659439a` | 510 (509 pass, 1 skip) |
| 4 — Processes and rules | `6e22402` | 510 (509 pass, 1 skip) |
| 5 — Lenses and files | `cb5b9a6` | 510 (509 pass, 1 skip) |
| 6 — Change sets, assertions, deploy | `fd87e55` | 510 (509 pass, 1 skip) |
| 7 — Everything else | `73b4e31` | 511 (510 pass, 1 skip) |
| 8 — Enforce the rule | `0e170ed` | 512 (511 pass, 1 skip) |

Final: **512 tests, 511 pass, 1 skipped, 0 fail**. Client lint **128** (19 errors, 109 warnings);
backend lint **0**. Remaining raw `fetch(` outside `lib/api.js`: **0**.

Step 0 also recorded the real `/api/lenses/generate` ordering bug in `BUG_FIXES.md`; the route
table test now rejects a static route registered after a `:param` route it could match.

The calls were moved by area, using one `apiFetch` helper from `lib/api.js` that attaches the IDE
token and leaves the caller's existing response handling intact. That is the one-way transport
rule. It does **not** yet turn every read into a `useQuery` hook or every save into `useMutation`;
that per-call hook work remains, as does the editor split. No errors changed behaviour in this
round: `apiFetch` preserves each caller's existing `r.ok`/JSON handling rather than replacing it
with a thrown hook error.
