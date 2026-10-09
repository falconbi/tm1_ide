# TM1 name-escaping audit (site-by-site)

Classifies every place in the TM1-facing code where a name/value is interpolated
into a TM1 REST URL or `$filter`, plus the already-safe ones. **No code changes
were made** — this is the review input before batch fixes.

Lab test names the audit is judged against (V11 lab, `TM1_Test_DEV` only):
- object names: `zz_esc_Test's #1 %`
- element names: `zz_esc_Q?1 's #% & +`  (`&`/`+` matter: `+` can become a space in a
  URL parameter; `&` splits query params when the URL is raw-concatenated)

## Method

Relevant files (the code that builds TM1 REST calls / `$filter`): `core/tm1_client.js`,
`server.js`, `core/adapters/*`, `core/git-*.js`, `core/model-*.js`, `core/model-store.js`,
`tools/tm1mcp/**`, `tools/tm1deploy/src/**`. For each `…${x}…` inside a quoted string we
read the surrounding call and the escaping helper in scope.

## Buckets

| Tag | Meaning | Fix on the lab test set |
|---|---|---|
| `PATH-RAW` | name in an OData **path** segment, zero encoding | url-encode whole segment incl `'` → `%27` |
| `PATH-ENC` | `encodeURIComponent()` in a path — fixes `% # ? & + /` but **leaves `'` ever** | add `'` → `%27` after encode |
| `PATH-APOS` | apostrophe-doubling helper (`esc`/`safe`/`e`/line-245 `enc`) in a **path** — `''` is not valid in a URL segment | replace with segment encoder |
| `FILTER-RAW` | name inside `$filter` string **without** `''` doubling | double `'` (`eq 'Test''s'`) + send filter URL-encoded |
| `FILTER-OK` | `$filter` string with `''` doubling — fine for `'` | verify transport URL-encodes the param (axios params do; raw `?…` strings don't) → `+`/space |
| `TI-STR` | name in a **generated TI/Rules string literal** — `''` doubling is correct here | nothing |
| `GUID` | value is a system id (session/thread/cellset/plan id) that structurally cannot contain `' % #` | nothing |
| `URI-REF` | name in an `@odata.id`/`@odata.bind` **URI reference** inside JSON | same as PATH (encode incl `'`) |
| `SAFE` | message/log/RegExp-building/JSON body value/console | nothing |

---

## `core/tm1_client.js` — the main surface

### PATH-RAW (bare name, no encoding) — needs segmented encoder

```
57   delete `Dimensions('${name}')`
67   `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements`,
77   `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements`,
97   `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements`,
112  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements('${element}')/Attributes`
128  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Edges`,
137  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Edges`,
146  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements`,
164  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements('${name}')`
169  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements('${name}')`,
176  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Edges`,
183  `Edges(ParentName='${parent}',ComponentName='${child}')`
189  `Edges(ParentName='${parent}',ComponentName='${child}')`,
195  `Dimensions('${dim}')/Hierarchies`, `$select Name`
200  `Dimensions('${dim}')/Hierarchies`, { Name: name }
204  `Dimensions('${dim}')/Hierarchies('${name}')`
213  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Elements('${element}')/Attributes`
300  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/ElementAttributes`
306  `ElementAttributes('${name}')`
325  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/ElementAttributes`
396  `Cubes('${name}')`
445  `Processes('${name}')`
830  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Subsets`,
838  `Subsets('${name}')`,
847  `Subsets('${name}')`,
852  `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Subsets`, body
887  `Cubes('${cube}')/Views`
898  `Cubes('${cube}')/Views('${name}')`
968  `Cubes('${cube}')/Views('${name}')/Rows?%24expand=Subset`
969  `Cubes('${cube}')/Views('${name}')/Columns?%24expand=Subset`
970  `Cubes('${cube}')/Views('${name}')/Titles?%24expand=Subset`
986  `Cubes('${cube}')/Views('${name}')`, `$expand Rows,Columns,Titles`
993  `Cubes('${cube}')/Views`, `$expand …`
1005 `Cubes('${cube}')/Views('${name}')/Rows`
1006 `Cubes('${cube}')/Views('${name}')/Columns`
1025 `Dimensions('${dim}')/Hierarchies('${hierarchy}')/Subsets('${name}')/Elements`
1082 `Dimensions('${dim}')/Hierarchies('${dim}')/DefaultMember`
1189 `Cubes('${cube}')/Views('${view}')`, SuppressEmptyRows
1194 `Cubes('${cube}')/Views('${view}')`
1195 `Cubes('${cube}')/Views('${view}')/tm1.Execute`
```

### PATH-ENC (encodeURIComponent, so `'` still breaks) — add `'`→`%27`

```
32/36/40/44/48/52  delete `Dimensions('${encodeURIComponent(name)}')` etc (6 sites)
122  `Dimensions('${enc}')/Hierarchies`  (enc = encodeURIComponent(name))
158  `Dimensions('${encodeURIComponent(dim)}')…/tm1.SetElement`
454  `Processes('${encodeURIComponent(name)}')/tm1.ExecuteWithReturn`
488  patch `Processes('${encodeURIComponent(proc.name)}')`
506  `Chores('${encodeURIComponent(name)}')`
521  patch `Chores('${encodeURIComponent(name)}')`
529  `Chores('${encodeURIComponent(name)}')/tm1.Execute`
533/537  patch `Chores('${encodeURIComponent(name)}')` Active true/false
871  `Dimensions('${enc(dim)}')/…/tm1.CreateSessionSubset`
877  `…/SessionSubsets('${enc(id)}')/Elements`
1224 `Cubes('${enc(cube)}')/tm1.Update`
1231 `Cubes('${enc(cube)}')/Annotations`
1288 `Cubes('${enc(cube)}')/tm1.UpdateCells`
1304 `Cubes('${enc(cube)}')/tm1.TraceCellCalculation`
1402 `Cubes('${enc(cube)}')/tm1.CheckFeedersForRules`
1414 `Cubes('${enc(cube)}')/tm1.CheckFeedersOfCell`
1471 `ErrorLogFiles('${encodeURIComponent(filename)}')/Content`   [flagged: filename may embed a name with ']
1483 `pathParts.map(p => \`Contents('${encodeURIComponent(p)}')\`)`   [flagged: file names]
1501/1503 `Contents('${encodeURIComponent(name)}…')`                  [flagged: file names]
1669  patch `Users('${encodeURIComponent(name)}')`   [flagged low-risk: asked if usernames can contain ']
1673  delete `Users('${encodeURIComponent(name)}')`  [flagged low-risk]
1682  `Users('${encodeURIComponent(clientName)}')/Groups`  [flagged low-risk]
1709/1715  patch `Users('${encodeURIComponent(clientName)}')`, Groups   [flagged low-risk]
```

### PATH-APOS (apostrophe-doubling helper used in a URL path) — switch to segment encoder

```
251-255  writeAttributeValue paths use `enc = s => s.replace(/'/g,"''").replace(/%/g,'%25').replace(/#/g,'%23')`
312-316  setAttributeValues uses `safe = s => s.replace(/'/g,"''")` in `Dimensions('${safe(attrCube)}')…`
1037/1043/1048  use `e = s => s.replace(/'/g,"''")` in `Dimensions('${e(dim)}')/…` (URL paths)
1069/1072  use `esc = s => s.replace(/'/g,"''")` in `Cubes('${esc(cube)}')/Views…`
1090/1107/1133/1154  `hierBind`, `Selected@odata.bind`, `Subsets@odata.bind` — esc() doubled apostrophes in paths/URI-refs
1174  `Cubes('${esc(cube)}')/Views` postBody
1219/1259/1283/1307/1417  `esc()` doubled in `Dimensions('${esc(dim)}')/…Elements('${esc(element)}')` etc
1246  `esc()` in `Dimensions('${esc(dim)}')/…`
1606-1620  delete `Processes('${esc(procName)}')` — but `procName` is generated
          (`__SetDefaultView_<ts>`), so no user name reaches it → **effectively SAFE** (the
          cube/view name sits in the generated TI, where `esc`-doubling is correct).
```

### $filter

```
138   { '$filter': \`ParentName eq '${safe}'\` }  → FILTER-OK  (safe = '' doubling) — verify transport encoding
1591  { '$filter': \`CubeName eq '${cube}'\` }     → FILTER-RAW (must double ')
```

### TI-STR — correct, no change

```
160-?  lines 268-273 AttributePut wrappers (safeVal/safeElem/safeAttr = '' doubling)
1057/1059/1060  SubsetDeleteAllElements/DIMIX/SubsetElementInsert generated TI
1615  CubeSetDefaultView('${esc(cube)}','${esc(viewName)}')
1687/1701  s = v => \`'${v.replace(/'/g,"''")}'\`  (group/user strings)
195-214  errors from data-delete checks use messages (SAFE)
```

### GUID — safe (system ids, cannot contain the specials)

```
1180-1203  Cellsets('${ID}')   (ID = server-generated)
1249/1252  Annotations('${encodeURIComponent(id)}')   (id = annotation GUID)
1271  Jobs('${encodeURIComponent(id)}')/tm1.Cancel
1574  Sessions('${encodeURIComponent(id)}')
1585  Threads('${encodeURIComponent(id)}')/tm1.CancelOperation
```

### SAFE (messages / RegExp builders / JSON body values)

```
570/614  esc = regex-escape (RegExp builders for TI scanning)  → SAFE
587-636, 712  new RegExp(`…${safe…}…`)  → SAFE (RegExp escapes)
721/747/752/771/785/793  messages        → SAFE
1147  message                              → SAFE
1243  `Cubes('${enc(cube)}')/Annotations` body ({}) → SAFE (name not in a path)
1349-1394  dead-object warnings            → SAFE
```

---

## `server.js` — direct TM1 URL builders

### PATH-RAW / PATH-ENC / FILTER

```
727  patch `Cubes('${req.query.cube}')`  → PATH-RAW (cube from query)
801  get `Processes('${encodeURIComponent(name)}')`  → PATH-ENC (' breaks)
1036 patch `Processes('${req.query.name}')`         → PATH-RAW
2741 patch `Processes('${processName}')`            → PATH-RAW
193  / 200-220  (auth) messages / console              → SAFE
190-194  reconcile re-patch uses esc('' doubling)      → PATH-APOS
2011/2023  Assets(path='${encodePath(path)}') — inspect encodePath   [flagged: uses its own encoder]
2340  Contents('${encodeURIComponent(name)}')        → PATH-ENC [flagged: file names]
829-849, 1069  TI debug injection (AttrPutS…'AT'…'ATTR')  → TI-STR ('' doubling  – correct)
3188-3191, 3022 etc  GitPlans('${encodeURIComponent(plan.ID)}')  → GUID
```

### SAFE
`3022/3162/3175/3191` GitPlans plan.ID → GUID. `230-293/323-335` auth messages → SAFE. `1106-1126` console → SAFE.

---

## `core/git-*.js` — use their own `esc` (apostrophe-double only)

The `esc` in these files doubles `'`; it is applied to **URL path segments**, so a
name like `zz_esc_Test's #1 %` produces `Dimensions('zz_esc_Test''s #1 %')` — the
doubling is not valid in a path and `%`/`#`/space are not encoded:

```
git-readiness.js: 55,62,82,92,99-101,207   PATH-APOS
git-reconcile.js: 88                        PATH-APOS
git-restore.js:   108  patch `Cubes('${esc(det.cube)}')`   PATH-APOS
git-deploy.js:    125 / git-drift.js:48,150 / server.js:3022+  GitPlans(plan.ID) → GUID
git-review.js:    91  `git diff ${from}..${to}` → SAFE (shell; arg-delimited, not TM1)
git-drift.js:     138  `user.name=…` → SAFE (git identity)
git-restore.js:   49  RegExp `#region\s+${key}` → SAFE
git-readiness.js: 152  message → SAFE
```

---

## `tools/tm1mcp/**`

Mostly call `core/tm1_client.js` methods (so they fix when the client does). The
ones that build URLs inline use the same `esc`-apostrophe-double in paths:

```
tools/build.js:      232  c.get(`Dimensions('${esc(dimension)}')/…Elements`)   PATH-APOS
build.js: 240/243     Cubes('${esc(name)}')… CheckRules / ProcessFeeders          PATH-APOS
build.js: 250         'Process@odata.bind': `Processes('${s.process.replace(/'/g,"''")}')` → URI-REF (ok-ish, '' in URI)
build.js: 253         delete `Chores('${esc(name)}')`                            PATH-APOS
build.js: 328/349     patch/post `Cubes('${esc(name)}')`                          PATH-APOS
develop.js: 31/34/53/78/95/128   `esc()` in Cubes/Processes paths                 PATH-APOS
introspect.js: 25/36/100/118/132/148/164/168   `esc()` in paths                    PATH-APOS
diagnostics.js / assertions.js / changeset.js   messages/ok()                      SAFE
```

---

## `tools/tm1deploy/src/**`

```
deployer.js: 13   patch `Cubes('${esc(obj.name)}')`            PATH-APOS
deployer.js: 79   post `Dimensions('${name}')`                 PATH-RAW
deployer.js: 138/231 `Dimensions('${name}')/…ElementAttributes` PATH-RAW
risk.js:      35   post `Cubes('${esc(obj.name)}')/tm1.CheckRules`  PATH-APOS
risk.js/diff.js/packager.js   per-type messages → SAFE
```

---

## `core/model-store.js`, `core/model-health.js`, `core/assertions.js`

- `model-health.js:27/34` use `esc` (apostrophe-double) in `Cubes('${esc(cube)}')/Views`
  and `Dimensions('${esc(dim)}')/…` paths → **PATH-APOS**.
- `model-store.js` `isMigrated`/doc paths are filesystem/logic, no TM1 URL → SAFE.
- `assertions.js` reads model documents through `model-store`; its direct URLs are
  in `run` via `executeMDX` (no name-in-path) → SAFE, but its messages → SAFE.

---

## Core/adapters

- `direct_v11.js`, `paw_native.js`, `paw-oauth2.js`: URLs are built from the admin
  host / PAW base + path constants; server names go in **cookies/headers/probe
  URLs** (`/api/v0/tm1/{server}/…`) via `encodeURIComponent` in
  `adapter_registry`/`tm1_client` URL assembly — verify the server-name segment uses
  the full segment encoder, but server names are admin-config values (not user data), so
  **flagged low-risk**, not action.

---

## Flagged / ambiguous (checked, not guessed)

1. `tm1_client.js:471…` error-log **filenames** (`ErrorLogFiles`, `Contents(...)`,
   `_contentsPath`) — encodeURIComponent(`'`) leaves `'`; TM1 error-log filenames embed the
   process name → likely reachable by `zz_esc_Test's #1 %`–style names. **Assume PATH-ENC→fix**
   and confirm on the lab.
2. **TM1 user names** (`Users('…')`) — TM1 may restrict `'` in user names; until confirmed on the
   lab, treat as PATH-ENC low-risk. **Action only if the lab proves `'` is permitted.**
3. `server.js:2008-2023` `Assets(path='${encodePath(path)}')` — `encodePath = p =>
   encodeURIComponent(encodeURIComponent(p))` (double-encoded, including `'`), so it is
   probably already safe; prove on the lab with a `zz_esc_`-prefixed PAW file/folder whose
   name contains `'` and a space. Only change if that round-trip fails.
4. `URI-REF` sites (`@odata.bind`, `@odata.id` for Groups/Subsets): TM1 resolves the URI —
   percent-encode including `'` to be safe; low frequency.
5. **Transport of `$filter`** (lines 138 / 1591): confirmed `''` doubling on 1591 is missing;
   both must also travel URL-encoded (`+`/space). The client/axios path already encodes
   params; any site that raw-concatenates a `?…` string must not.
6. The `enc` helper at `tm1_client.js:245` is the odd one — it doubled `'` and encoded `%#`
   but not `& + space`. Treat as PATH-APOS (replace with the shared segment encoder).

---

## One shared fix (proposal, not applied)

Introduce a single shared segment encoder (e.g. in `core/tm1_client.js`):

```js
const seg = v => encodeURIComponent(String(v ?? '')).replace(/'/g, '%27')
```

- **Every OData path segment** (`Dimensions('${seg(dim)}')`, `Edges(ParentName='${seg(p)}')`, …)
  uses `seg`. This is the URL-path = "full treatment" rule.
- **`$filter` string values** keep `'`→`''` doubling **and** the whole filter travels as a
  URL-encoded query param.
- **Generated TI string literals** keep `''` doubling (no change).

That collapses the five coexisting styles into two rules: *path → `seg()`,
TM1-string → `''`-double*.

---

## Lab test matrix (batch order)

| batch | objects | names | prove |
|---|---|---|---|
| 1 — dimensions & elements | dim `zz_esc_Test's #1 %`; elements `zz_esc_Q?1 's #% & +` | create/open/edit/save, rename (element), read attrs, delete both | every create/read/write/rename/delete through the IDE routes resolves; no 400/404 |
| 2 — cubes & views | cube `zz_esc_Test's #1 %`, native + MDX view, subset `zz_esc_Test's #1 %` | create/open/edit/save/delete | dims/elements feed cube dim assignment; view rows/cols with the `& +` element resolve |
| 3 — processes & chores | process + chore `zz_esc_Test's #1 %` | create/open/edit/save/run(process)/delete | run + log path resolve; chore step bound to the process by name survives |

Cleanup: prefix `zz_esc_` → delete everything at the end of each batch and confirm zero left.