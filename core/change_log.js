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

function closeSession(id) {
    db.prepare(`UPDATE sessions SET closed_at = ? WHERE id = ?`).run(new Date().toISOString(), id)
    return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id)
}

function resumeSession(id) {
    db.prepare(`UPDATE sessions SET closed_at = NULL WHERE id = ?`).run(id)
    return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id)
}

function updateSessionDescription(id, description) {
    db.prepare(`UPDATE sessions SET description = ? WHERE id = ?`).run(description ?? null, id)
    return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id)
}

function getActiveSession(server) {
    return db.prepare(`SELECT * FROM sessions WHERE server = ? AND closed_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(server) ?? null
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
    const session = getActiveSession(server)

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

module.exports = { startSession, closeSession, resumeSession, updateSessionDescription, getActiveSession, getSessions, getAllSessions, getSessionLog, getCrossSessionTouches, getEntriesSince, getMaxEntryId, getEntriesSinceId, getSessionLogVerbose, getRecentLog, getObjectHistory, getEntryById, writeLog, findArchivableEntries, pruneEntries }
