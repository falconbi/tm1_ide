const Database  = require('better-sqlite3')
const path      = require('path')
const { randomUUID } = require('crypto')

const db = new Database(path.join(__dirname, '..', 'change_log.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    server      TEXT NOT NULL,
    user        TEXT,
    started_at  TEXT NOT NULL,
    closed_at   TEXT,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS log_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT,
    timestamp    TEXT NOT NULL,
    server       TEXT NOT NULL,
    action       TEXT NOT NULL,
    object_type  TEXT NOT NULL,
    object_name  TEXT NOT NULL,
    detail       TEXT,
    before_state TEXT,
    after_state  TEXT,
    user         TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_log_session   ON log_entries(session_id);
  CREATE INDEX IF NOT EXISTS idx_log_server    ON log_entries(server, timestamp);
  CREATE INDEX IF NOT EXISTS idx_sessions_srv  ON sessions(server, started_at);
  CREATE INDEX IF NOT EXISTS idx_log_object    ON log_entries(server, object_type, object_name);
`)

// Lifecycle columns (added after the fact — ignore "duplicate column" on existing DBs).
for (const [col, type] of [
    ['closed_by',       'TEXT'],
    ['close_tests',     'TEXT'],
    ['commit_ref',      'TEXT'],
    ['deployed_target', 'TEXT'],
    ['deployed_at',     'TEXT'],
    ['release_commit',  'TEXT'],
    ['release_target',  'TEXT'],
]) {
    try { db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${type}`) } catch { /* already exists */ }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseEntry(e) {
    if (!e) return e
    return {
        ...e,
        before_state: e.before_state ? JSON.parse(e.before_state) : null,
        after_state:  e.after_state  ? JSON.parse(e.after_state)  : null,
    }
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function startSession(name, server, user) {
    const id  = randomUUID()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO sessions (id, name, server, user, started_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, name, server, user ?? 'unknown', now)
    return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id)
}

function closeSession(id, { user, tests } = {}) {
    db.prepare(`UPDATE sessions SET closed_at = ?, closed_by = ?, close_tests = ? WHERE id = ?`)
        .run(new Date().toISOString(), user ?? null, tests ? JSON.stringify(tests) : null, id)
    return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id)
}

function resumeSession(id) {
    db.prepare(`UPDATE sessions SET closed_at = NULL WHERE id = ?`).run(id)
    return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id)
}

// Link a change set to the commit it was filed as, and to the target it shipped to.
function setSessionCommit(id, commit) {
    db.prepare(`UPDATE sessions SET commit_ref = ? WHERE id = ?`).run(commit ?? null, id)
}
// Link a change set to its build release commit (branch release-<target>).
function setSessionRelease(id, commit, target) {
    db.prepare(`UPDATE sessions SET release_commit = ?, release_target = ? WHERE id = ?`).run(commit ?? null, target ?? null, id)
    return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id)
}
function markSessionDeployed(id, target) {
    db.prepare(`UPDATE sessions SET deployed_target = ?, deployed_at = ? WHERE id = ?`).run(target ?? null, new Date().toISOString(), id)
}

function updateSessionDescription(id, description) {
    db.prepare(`UPDATE sessions SET description = ? WHERE id = ?`).run(description ?? null, id)
    return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id)
}

function getActiveSession(server, user = null) {
    // One open change set per person per server — a save goes into the saver's
    // own change set (keyed by server+user). With no user, falls back to the
    // newest open on the server (legacy single-developer behaviour).
    if (user) {
        // Case-insensitive ownership: "JDLove" and "jdlove" are the same person (the
        // TM1 user identity a change set was started under must match the identity
        // signed in to the server now, regardless of capitalisation).
        return db.prepare(`SELECT * FROM sessions WHERE server = ? AND LOWER(user) = LOWER(?) AND closed_at IS NULL ORDER BY started_at DESC LIMIT 1`)
            .get(server, user) ?? null
    }
    return db.prepare(`SELECT * FROM sessions WHERE server = ? AND closed_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(server) ?? null
}

function getSession(id) {
    return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) ?? null
}

// The deploy manifest for a change set: what it deleted, which dimensions'
// attribute values it touched, and — when the log records them — the specific
// element/attribute pairs. This is what scopes the reconcile — deletes and
// value syncs are NEVER inferred from the whole source, only from what the
// change set actually did.
function getSessionManifest(sessionId) {
    const entries = getSessionLog(sessionId)
    const created = new Set()
    for (const e of entries) {
        if (/_CREATED$/.test(e.action ?? '')) created.add(`${e.object_type}:${e.object_name}`)
    }
    const deletes = []
    const attrElements = []
    const dimSet = new Set()
    for (const e of entries) {
        // Objects deleted here that were NOT created inside the session pre-existed
        // it — deleting them on the target is this change set's doing.
        if (/^(PROCESS|DIMENSION|CUBE)_DELETED$/.test(e.action ?? '') && !created.has(`${e.object_type}:${e.object_name}`)) {
            deletes.push({ type: e.object_type, name: e.object_name })
        }
        // Attribute writes: the dimension is object_name; the element+attribute may
        // be in detail (e.g. "Budget.Description"). Record the pair when we can.
        if ((e.action ?? '').startsWith('ATTRIBUTE') || e.object_type === 'elementAttribute') {
            const dim = e.object_name
            if (dim) {
                dimSet.add(dim)
                const m = typeof e.detail === 'string' ? e.detail.split('.') : []
                if (m.length >= 2) attrElements.push({ dim, element: m[0], attribute: m[m.length - 1] })
            }
        }
    }
    const dims = [...dimSet]
    // Dimensions we only know by name (no element/attribute recorded) will be
    // copied wholesale — surfaced in Review so it is never silent.
    const wholesaleDims = dims.filter(d => !attrElements.some(p => p.dim === d))
    return { deletes, dims, attrElements, wholesaleDims }
}

function getSessions(server, limit = 50) {
    return db.prepare(`
        SELECT s.*, COUNT(l.id) as entry_count, MAX(l.id) as max_entry_id
        FROM sessions s
        LEFT JOIN log_entries l ON l.session_id = s.id
        WHERE s.server = ?
        GROUP BY s.id
        ORDER BY s.started_at DESC
        LIMIT ?
    `).all(server, limit)
}

function getAllSessions(limit = 200) {
    return db.prepare(`
        SELECT s.*, COUNT(l.id) as entry_count
        FROM sessions s
        LEFT JOIN log_entries l ON l.session_id = s.id
        GROUP BY s.id
        ORDER BY s.started_at DESC
        LIMIT ?
    `).all(limit)
}

// `detail` is part of the object identity: it holds the dimension for a subset,
// the cube for a view. Without it, "Default" on two dimensions collapse to one
// entry and the packager only ever sees one of them.
function getSessionLog(sessionId) {
    return db.prepare(`
        SELECT * FROM log_entries
        WHERE session_id = ?
        AND id IN (
            SELECT MAX(id) FROM log_entries
            WHERE session_id = ?
            GROUP BY object_type, object_name, action, IFNULL(detail, '')
        )
        ORDER BY timestamp ASC
    `).all(sessionId, sessionId).map(parseEntry)
}

// For each object this session touched, has any OTHER session also logged a
// change to that exact object (same type + name + detail) since this session
// started? Surfaces the "Sarah also touched Period dimension" case at
// diff/package time — packaging captures live state, not a per-session field
// diff, so this is the only signal a concurrent, unrelated edit exists before
// it silently rides along in the deploy.
function getCrossSessionTouches(server, sessionId, objects) {
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId)
    if (!session) return []

    const seen = new Set()
    const results = []
    for (const { object_type, object_name, detail } of objects) {
        const key = `${object_type}::${object_name}::${detail ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)

        const row = db.prepare(`
            SELECT l.timestamp, s.id as session_id, s.name as session_name, s.user
            FROM log_entries l
            JOIN sessions s ON s.id = l.session_id
            WHERE l.server = ? AND l.object_type = ? AND l.object_name = ? AND IFNULL(l.detail, '') = ?
              AND l.session_id != ? AND l.timestamp > ?
            ORDER BY l.timestamp DESC
            LIMIT 1
        `).get(server, object_type, object_name, detail ?? '', sessionId, session.started_at)

        if (row) results.push({
            object_type, object_name, detail: detail ?? null,
            touchedBy: row.user, sessionName: row.session_name, sessionId: row.session_id, at: row.timestamp,
        })
    }
    return results
}

// Every object touched on this server since `sinceIso` (typically the baseline's
// seeded_at), collapsed to the latest entry per object+action — the union of all
// change sets in a release window. Feeds the same diff/package path as
// getSessionLog; diff.js dedups further by object identity across actions.
function getEntriesSince(server, sinceIso) {
    const since = sinceIso || '1970-01-01T00:00:00.000Z'
    return db.prepare(`
        SELECT * FROM log_entries
        WHERE server = ? AND timestamp >= ?
        AND id IN (
            SELECT MAX(id) FROM log_entries
            WHERE server = ? AND timestamp >= ?
            GROUP BY object_type, object_name, action, IFNULL(detail, '')
        )
        ORDER BY timestamp ASC
    `).all(server, since, server, since).map(parseEntry)
}

// Highest log_entries.id for a server — the monotonic "change-log position".
// Stamped into a baseline at seed time so a release window can be defined by
// id (deterministic) instead of a wall-clock timestamp (skew-prone).
function getMaxEntryId(server) {
    const r = db.prepare(`SELECT MAX(id) AS m FROM log_entries WHERE server = ?`).get(server)
    return r?.m ?? 0
}

// Every object touched on this server AFTER change-log position `sinceId`,
// collapsed to the latest entry per object+action. The id-based counterpart to
// getEntriesSince — used for release packaging when the baseline carries a
// last_entry_id.
function getEntriesSinceId(server, sinceId) {
    const since = sinceId || 0
    return db.prepare(`
        SELECT * FROM log_entries
        WHERE server = ? AND id > ?
        AND id IN (
            SELECT MAX(id) FROM log_entries
            WHERE server = ? AND id > ?
            GROUP BY object_type, object_name, action, IFNULL(detail, '')
        )
        ORDER BY id ASC
    `).all(server, since, server, since).map(parseEntry)
}

function getSessionLogVerbose(sessionId) {
    return db.prepare(`
        SELECT * FROM log_entries
        WHERE session_id = ?
        ORDER BY timestamp ASC
    `).all(sessionId).map(parseEntry)
}

function getRecentLog(server, limit = 100) {
    return db.prepare(`SELECT * FROM log_entries WHERE server = ? ORDER BY timestamp DESC LIMIT ?`).all(server, limit).map(parseEntry)
}

// ── Object history ────────────────────────────────────────────────────────────

function getObjectHistory(server, objectType, objectName) {
    // Fetch one extra row to detect truncation instead of silently hiding history.
    const rows = db.prepare(`
        SELECT l.*, s.name as session_name
        FROM log_entries l
        LEFT JOIN sessions s ON s.id = l.session_id
        WHERE l.server = ? AND l.object_type = ? AND l.object_name = ?
        ORDER BY l.timestamp DESC
        LIMIT 201
    `).all(server, objectType, objectName).map(parseEntry)
    return { entries: rows.slice(0, 200), truncated: rows.length > 200 }
}

function getEntryById(id) {
    return parseEntry(db.prepare(`SELECT * FROM log_entries WHERE id = ?`).get(id) ?? null)
}

// ── Log writer ────────────────────────────────────────────────────────────────

// History is independent of session — every save is its own row with its own
// accurate before/after, full stop. (Previously, saves within the same session
// collapsed into one row, freezing before_state at whenever the session
// started and stamping every later save's user with the session's original
// user — wrong on both counts, and wrong specifically *because* it made
// history depend on session state, which it must never do.)
function writeLog({ server, action, objectType, objectName, detail, beforeState, afterState, user }) {
    // Keyed by the saver's own open change set (server+user), so per-person
    // change sets on a shared DEV stay separate.
    const session = getActiveSession(server, user)

    db.prepare(`
        INSERT INTO log_entries (session_id, timestamp, server, action, object_type, object_name, detail, before_state, after_state, user)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        session?.id ?? null,
        new Date().toISOString(),
        server,
        action,
        objectType,
        objectName,
        detail       ?? null,
        beforeState  ? JSON.stringify(beforeState)  : null,
        afterState   ? JSON.stringify(afterState)   : null,
        user ?? null
    )
    return { hasSession: !!session }
}

// ── Retention / archive ────────────────────────────────────────────────────

// Entries eligible for archiving: older than `cutoffIso`, at or before
// `floorId` (the caller's safety floor — e.g. the oldest baseline still on
// disk's last_entry_id, so nothing a future release-window diff might still
// need ever gets pruned), and not tied to a still-open session (an open
// session's full history is needed for its eventual diff/package).
function findArchivableEntries(server, cutoffIso, floorId = 0) {
    return db.prepare(`
        SELECT l.* FROM log_entries l
        WHERE l.server = ? AND l.timestamp < ? AND l.id <= ?
          AND (l.session_id IS NULL OR l.session_id NOT IN (
              SELECT id FROM sessions WHERE server = ? AND closed_at IS NULL
          ))
        ORDER BY l.id ASC
    `).all(server, cutoffIso, floorId, server).map(parseEntry)
}

function pruneEntries(ids) {
    if (!ids.length) return 0
    const placeholders = ids.map(() => '?').join(',')
    return db.prepare(`DELETE FROM log_entries WHERE id IN (${placeholders})`).run(...ids).changes
}

// SQLite doesn't add columns to existing tables via CREATE TABLE — migrate if needed
try { db.exec(`ALTER TABLE sessions ADD COLUMN description TEXT`) } catch {}
try { db.exec(`ALTER TABLE log_entries ADD COLUMN user TEXT`) } catch {}

module.exports = { startSession, getSession, getSessionManifest, closeSession, resumeSession, updateSessionDescription, setSessionCommit, setSessionRelease, markSessionDeployed, getActiveSession, getSessions, getAllSessions, getSessionLog, getCrossSessionTouches, getEntriesSince, getMaxEntryId, getEntriesSinceId, getSessionLogVerbose, getRecentLog, getObjectHistory, getEntryById, writeLog, findArchivableEntries, pruneEntries }
