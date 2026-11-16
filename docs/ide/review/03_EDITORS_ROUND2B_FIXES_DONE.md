# 03 — Editors round 2b: finish the client API round

Completed 17 Nov 2026. One commit per step. Raw `fetch(` and `apiFetch(` are now absent from
`client/src` outside `lib/api.js`; `tests/client-no-direct-fetch.test.js` is the gate.

| Step | Commit | Tests |
|---|---|---|
| 1 — Explicit allowlist | `be0f37c` | 512 (511 pass, 1 skip) |
| 2 — Dimensions and subsets | `ddb9c24` | 512 (511 pass, 1 skip) |
| 3 — Views and MDX | `93db68f` | 512 (511 pass, 1 skip) |
| 4 — Processes and rules | `052c99c` | 512 (511 pass, 1 skip) |
| 5 — Lenses and files | `a37d8df` | 512 (511 pass, 1 skip) |
| 6 — Change sets, assertions, deploy | `d225bee` | 512 (511 pass, 1 skip) |
| 7 — Everything else | `2b2454c` | 512 (511 pass, 1 skip) |
| 8 — Docs | `3ce7de5` | 512 (511 pass, 1 skip) |

Final: **512 tests, 511 pass, 1 skipped, 0 fail**; client lint **128**, backend lint **0**.
`apiFetch(` outside `lib/api.js`: **0**; allowlist: **empty**.

## Errors now shown
Every remaining direct call uses `lib/api` `request`/`get`/`post`/`put`/`patch`/`del`,
which throws the server's message on a non-2xx response. Before this round `apiFetch` returned the
Response regardless of status, so ignored failures in these call sites were silent. This includes
the file list, Lens loads/saves, process summaries, assertions, deploy history, catalog overrides,
Git setup/drift, transaction log actions and rule checks.

## Decision table
`get` = read/one-off JSON; `post`/`put`/`patch`/`del` = action JSON; `request` = event-driven
one-off that needs the raw Response (or a call not yet shaped into a hook).

| Call site | Helper | Route |
|---|---|---|
| `lib/catalog-runtime.js:34` | `request` | `/api/admin/catalog-overrides` |
| `components/CatalogAdmin.jsx:232` | `request` | `/api/admin/catalog-overrides` |
| `components/CatalogAdmin.jsx:322` | `request` | `/api/admin/catalog-overrides` |
| `components/CatalogAdmin.jsx:349` | `request` | `/api/admin/validate-ti-functions` |
| `components/GitSetup.jsx:36` | `request` | `/api/git/setup/status` |
| `components/GitSetup.jsx:47` | `request` | `/api/git/setup/readiness` |
| `components/GitSetup.jsx:58` | `request` | `/api/git/setup/init` |
| `components/FileManager.jsx:28` | `get` | `/api/files/list` |
| `components/FileManager.jsx:51` | `del` | `/api/files` |
| `components/ChangeLogPanel.jsx:149` | `request` | `/api/assertions/run` |
| `components/ChangeLogPanel.jsx:157` | `request` | `/api/sessions/close` |
| `components/SubsetVisualEditor.jsx:181` | `get` | `/api/subset/elements` |
| `components/SubsetVisualEditor.jsx:622` | `get` | `/api/subset/elements` |
| `components/CubeDataSources.jsx:25` | `request` | `/api/cube/data-sources` |
| `components/LensEditor.jsx:188` | `get` | `/api/lenses/` |
| `components/LensEditor.jsx:219` | `post` | `/api/lenses/generate` |
| `components/LensEditor.jsx:242` | `post` | `/api/lenses/` |
| `components/LensEditor.jsx:266` | `get` | `/api/lenses/` |
| `components/LensEditor.jsx:278` | `get` | `/api/lens-patterns/` |
| `components/RuleLensPanel.jsx:17` | `request` | `/api/cube/rules-lens` |
| `components/ProcessEditor.jsx:269` | `post` | `/api/view/preview-records` |
| `components/ProcessEditor.jsx:272` | `get` | `/api/subset/elements` |
| `components/ProcessEditor.jsx:277` | `request` | `/api/files/content` |
| `components/ProcessEditor.jsx:1058` | `get` | `/api/process/errorlog/content` |
| `components/ProcessEditor.jsx:1111` | `post` | `/api/process/check-references` |
| `components/PicklistBuilder.jsx:51` | `get` | `/api/dimensions` |
| `components/GitDrift.jsx:24` | `request` | `/api/servers` |
| `components/GitDrift.jsx:34` | `request` | `/api/git/drift` |
| `components/FindReplace.jsx:143` | `get` | `/api/search/index` |
| `components/Explorer.jsx:485` | `request` | `/api/lenses` |
| `components/Explorer.jsx:501` | `request` | `/api/lenses/` |
| `components/EditorPane.jsx:200` | `get` | `/api/elements` |
| `components/EditorPane.jsx:447` | `post` | `/api/rules/check` |
| `components/EditorPane.jsx:577` | `post` | `/api/cube/rules/check-references` |
| `components/DeployWizard.jsx:88` | `request` | `/api/assertions` |
| `components/DeployWizard.jsx:99` | `request` | `/api/servers` |
| `components/DeployWizard.jsx:134` | `request` | `/api/assertions/run` |
| `components/DeployWizard.jsx:177` | `request` | `/api/git/lock` |
| `components/SaveDataButton.jsx:33` | `request` | `/api/server/save-data-all` |
| `components/GuidedMDXBuilder.jsx:714` | `post` | `/api/mdx/generate` |
| `components/GuidedMDXBuilder.jsx:909` | `post` | `/api/subset/preview` |
| `components/GuidedMDXBuilder.jsx:946` | `post` | `/api/mdx/execute` |
| `components/RunbookDialog.jsx:110` | `request` | `/api/process/summaries` |
| `components/DeployHistory.jsx:155` | `request` | `/api/deploy/archives/` |
| `components/DeployHistory.jsx:295` | `request` | `/api/deploy/git/history` |
| `components/DimensionEditor.jsx:737` | `post` | `/api/dimension/attribute/convert-to-alias` |
| `components/ServerLoginDialog.jsx:47` | `request` | `/api/auth/method` |
| `components/CubeMapEditor.jsx:875` | `request` | `/api/cubemap/model` |
| `components/CubeMapEditor.jsx:903` | `request` | `/api/process/summaries` |
| `components/ProcessSummariesDialog.jsx:31` | `get` | `/api/process/summaries` |
| `components/ProcessSummariesDialog.jsx:61` | `post` | `/api/process/summary` |
| `components/ProcessSummariesDialog.jsx:86` | `put` | `/api/process/summary` |
| `components/AssertionsManager.jsx:26` | `request` | `/api/assertions` |
| `components/AssertionsManager.jsx:34` | `request` | `/api/sessions/active` |
| `components/AssertionsManager.jsx:70` | `request` | `/api/assertions/` |
| `components/AssertionsManager.jsx:80` | `request` | `/api/assertions/run` |
| `components/AssertionsManager.jsx:91` | `request` | `/api/assertions/run` |
| `components/SubsetEditor.jsx:340` | `post` | `/api/subset/preview` |
| `components/ModelHealth.jsx:62` | `request` | `/api/assertions/history` |
| `components/ModelHealth.jsx:75` | `request` | `/api/model-health` |
| `components/LoginPage.jsx:26` | `request` | `/api/config` |
| `components/LoginPage.jsx:29` | `request` | `/api/auth/local-session` |
| `components/LoginPage.jsx:57` | `request` | `/api/auth/setup-login` |
| `components/ViewEditor.jsx:684` | `get` | `/api/element/attributes` |
| `components/ViewEditor.jsx:724` | `get` | `/api/cube/dimensions` |
| `components/ViewEditor.jsx:736` | `get` | `/api/element/attributes` |
| `components/ViewEditor.jsx:1131` | `get` | `/api/cube/dimensions` |
| `components/ViewEditor.jsx:1387` | `get` | `/api/dimension/alias-values` |
| `components/ViewEditor.jsx:2152` | `post` | `/api/cells/write` |
| `store/index.js:111` | `request` | `/api/forge` |
| `store/index.js:158` | `request` | `/api/forge` |
| `components/mdx/ResultGrid.jsx:88` | `request` | `/api/cells/write` |
| `components/PeriodBuilder/index.jsx:76` | `request` | `/api/period-builder/run` |

## Not done
The remaining direct component loads are on `request`/`get`, not all converted into `useQuery`
hooks, and actions are not all `useMutation` hooks. The transport and error handling are now one
way; per-call hooks remain for a later pass, as does the editor split.
