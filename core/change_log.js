const Database  = require('better-sqlite3')
const path      = require('path')
const { randomUUID } = require('crypto')

const db = new Database(path.join(__dirname, '..', 'change_log.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    server     TEXT NOT NULL,
    user       TEXT,
    started_at TEXT NOT NULL,
    closed_at  TEXT
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

function getActiveSession(server) {
    return db.prepare(`SELECT * FROM sessions WHERE server = ? AND closed_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(server) ?? null
}

function getSessions(server, limit = 50) {
    return db.prepare(`
        SELECT s.*, COUNT(l.id) as entry_count
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

function getSessionLog(sessionId) {
    return db.prepare(`SELECT * FROM log_entries WHERE session_id = ? ORDER BY timestamp ASC`).all(sessionId).map(parseEntry)
}

function getRecentLog(server, limit = 100) {
    return db.prepare(`SELECT * FROM log_entries WHERE server = ? ORDER BY timestamp DESC LIMIT ?`).all(server, limit).map(parseEntry)
}

// ── Object history ────────────────────────────────────────────────────────────

function getObjectHistory(server, objectType, objectName) {
    return db.prepare(`
        SELECT l.*, s.name as session_name
        FROM log_entries l
        LEFT JOIN sessions s ON s.id = l.session_id
        WHERE l.server = ? AND l.object_type = ? AND l.object_name = ?
        ORDER BY l.timestamp DESC
        LIMIT 200
    `).all(server, objectType, objectName).map(parseEntry)
}

function getEntryById(id) {
    return parseEntry(db.prepare(`SELECT * FROM log_entries WHERE id = ?`).get(id) ?? null)
}

// ── Log writer ────────────────────────────────────────────────────────────────

function writeLog({ server, action, objectType, objectName, detail, beforeState, afterState }) {
    const session = getActiveSession(server)
    db.prepare(`
        INSERT INTO log_entries (session_id, timestamp, server, action, object_type, object_name, detail, before_state, after_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        session?.id ?? null,
        new Date().toISOString(),
        server,
        action,
        objectType,
        objectName,
        detail       ?? null,
        beforeState  ? JSON.stringify(beforeState)  : null,
        afterState   ? JSON.stringify(afterState)   : null
    )
    return { hasSession: !!session }
}

module.exports = { startSession, closeSession, resumeSession, getActiveSession, getSessions, getAllSessions, getSessionLog, getRecentLog, getObjectHistory, getEntryById, writeLog }
