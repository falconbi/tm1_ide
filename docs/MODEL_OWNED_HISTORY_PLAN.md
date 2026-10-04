# Plan — the model owns its history (Option B)

**Status:** Phase 1 (assertions) implemented — assertions for a migrated server now live in
`Applications/Governance/Tests/assertions.json` on the server itself, read/written by the IDE and MCP,
with `config/assertions.json` as the fallback for unmigrated servers. Migration is a manual, per-server
CLI (`node tools/migrate-assertions.js --server <name> [--dry-run] [--force]`). Awaiting James's sign-off
on the lab server's 133/133 run before removing that server from the central file.

## 1. Why

Today every model's governance record lives on the RIG, inside the IDE folder, keyed by server name:

| Item | Today | Backed up? |
|---|---|---|
| Change sets + change log (every object change, before/after) | `change_log.db` (SQLite: `sessions`, `log_entries`) | ❌ gitignored, RIG only |
| Change-log archives | `config/archives/change-log/` | ❌ |
| Baselines (`HEAD` + timestamped snapshots) | `.tm1baseline/<server>/` | ❌ |
| Deploy packages | `packages/` | ❌ |
| Deploy history (who, approval, result, pre/post snapshot) | `config/archives/*.json` | ❌ |
| Deploy approvals | `config/deploy-approvals.json` | IDE git |
| Post-deploy steps | `config/deploy-hooks.json` | IDE git |
| Assertions (tests) | `config/assertions.json` | IDE git |
| Test cases + payloads (CON) | `tm1_consolidation/testcases/` | not in any git |

Consequences: a RIG disk failure loses every model's history; renaming or moving a server orphans it;
handing a model to someone else hands over no history or tests; a second IDE install sees nothing.

## 2. Target

**End goal (decided 4 Oct 2026): no per-model folders in the IDE.** The IDE is a tool, not a store: it keeps only what
belongs to the installation or the user — connections (`servers.json`), secrets, personal preferences and a local
cache. Everything about a model (tests, change sets, baselines, deploy history, Lenses) comes from the model. Object
history goes to the model's git repository through TM1's built-in Git integration (see IMPROVEMENTS 10.1).


Everything above is stored **in the TM1 server it describes**. The IDE is a **cache**: on connect it loads the
model's governance data, and every change is written through to the server.

Storage (v11.8 verified read-only on a lab server: `Contents('Applications')` available, `Contents('Files')` is v12-only):

| Item | Stored as | Location in the model |
|---|---|---|
| Model identity | control cube `}Governance` (Server ID GUID, schema version, created) | cube |
| Change set index | control cube `}ChangeSets` (id, name, status, opened/closed, user, object count, assertion result) | cube |
| Change set detail (log entries with before/after) | one JSON document per change set | `Applications/Governance/ChangeSets/<id>.json` |
| Baselines | JSON document per snapshot + HEAD in `}Governance` | `Applications/Governance/Baselines/<iso>.json` |
| Deploy history | JSON document per deploy, written to **both** source and target | `Applications/Governance/Deploys/<iso>_<source>_to_<target>.json` |
| Deploy approvals | rows in `}ChangeSets` (approver, date) | cube |
| Post-deploy steps | JSON document | `Applications/Governance/deploy-hooks.json` |
| Assertions | JSON document (regression + health, tagged) | `Applications/Governance/Tests/assertions.json` |
| Test cases + payloads | JSON documents | `Applications/Governance/Tests/testcases/`, `…/payloads/` |
| Test results | control cube `}TestResults` (assertion × run: pass, actual, time) — viewable in PAW | cube |
| Lenses | already split: `}Lenses` cube + files — align to `Applications/Governance/Lenses/` | cube + documents |

Cubes hold what PAW users should see and filter (index, status, results); documents hold large structured
detail (before/after states, snapshots, test data). Control-object names (`}`) keep the cubes out of normal users'
view; security restricts writes to ADMIN.

**Keyed by Server ID, not name.** On first connect the IDE writes a GUID into `}Governance`; the local cache is
keyed by it, so a renamed or moved server keeps its history.

## 3. The IDE side

- **Connect:** read `}Governance` (create on first connect after approval), pull the change-set index, current
  baseline HEAD, assertions, hooks, deploy history; cache locally (SQLite, keyed by Server ID).
- **During work:** change-set entries buffered locally, written through to the change set's document on each
  change and at close. Assertions added/removed are themselves logged as change-set entries.
- **Close change set:** run assertions, write results to `}TestResults`, update `}ChangeSets`, write the document.
- **Deploy:** packager carries model objects **plus** governance documents chosen per target (e.g. PROD gets health
  checks only, never test payloads); deployer writes the deploy record to source and target.
- **Offline / unreachable server:** IDE keeps working from cache, queues writes, flushes on reconnect (warn clearly).
- **Several IDE installs on one server:** write-through + an open-change-set lock row in `}ChangeSets`.

## 4. Migration of existing history

One-time, per server, opt-in: export `change_log.db` sessions/entries, `.tm1baseline/<server>/`,
`config/archives/*` and the server's assertions into that server's governance store. Local copies stay as a
read-only backup until James signs off. Servers in scope today: the lab servers.

## 5. Phases (each needs James's approval before it starts)

| # | Phase | Proves / delivers |
|---|---|---|
| 0 | **Capability checks** on a lab server: write/read/delete a test document; document size limit; control-cube create; whether Applications documents survive restart without SaveDataAll | the storage works on v11.8 |
| 1 | **Tests first** (smallest, self-contained): assertions + test cases + payloads into a lab server; `}TestResults` cube; IDE reads/writes there, central file as fallback | first slice end-to-end — **assertions done Oct 2026** (server document read/write, config fallback, `tools/migrate-assertions.js` CLI); `}TestResults` cube, test cases + payloads still later phases |
| 2 | **Identity + change sets**: `}Governance`, `}ChangeSets`, change-set documents; IDE cache keyed by Server ID | history travels with the model |
| 3 | **Baselines** | drift/diff source in the model |
| 4 | **Deploy history, approvals, hooks**; packager/deployer carry governance documents with per-target rules | full pipeline model-owned |
| 5 | **Migrate existing history** (§4) and align Lenses | nothing left RIG-only |
| 6 | **v12 check** (`Contents('Files')`, OIDC servers) | v11 and v12 both |

## 6. Risks / open questions for James

1. **IDE writes to PROD** — deploy records and health-check results would be written to PROD's governance store.
   Acceptable (it is PROD's own audit trail), but it needs the deploy identity to have that right.
2. **Document size** — a large change set (e.g. a dimension rebuild with before/after) may be big; phase 0 measures.
3. **What PROD carries** — proposed: health checks yes, regression tests / test cases / payloads no.
4. **Folder visibility** — `Applications/Governance` would be visible to admins in PAW/Architect; acceptable, or
   hide behind security?
5. **Lenses** — confirm with the OpenCode work before moving its storage.
6. **Retention** — keep everything in the model forever, or archive old change sets after N months (today's
   `retention.js`), and where the archive goes.

## 7. Phase 0 results (3 Oct 2026, lab server, v11.8)

| Check | Result |
|---|---|
| Create / delete a folder under Applications | ✅ — but **not with a `}` name** (400). The `Governance` folder is visible in PAW; hide it with security, not naming |
| Write + read documents: 50 B, 121 KB (assertions.json), 5 MB | ✅ identical (5 MB in 287 ms) |
| Document survives a hard stop (stuck shutdown, VM reboot) | ✅ |
| Delete a folder | ✅ removes its documents too |
| Control-cube create | not tested yet (cubes are well-trodden — low risk) |

v11 addressing: a document `X` has ID `X.blob`; its content is at
`Contents('Applications')/Contents('<folder>')/Contents('X.blob')/Document/Content` (GET / PUT
`application/octet-stream`). Create with `POST …/Contents` `{"@odata.type":"#ibm.tm1.api.v1.Document","Name":"X"}`.
`TM1Client.getFileContent`/`putFileContent`/`deleteFile` use `Contents('X')/Content` (v12 `Files` shape) — they
404 on v11 Applications and need a v11 branch before phase 1.

