'use strict'
// SQL connection manager — pluggable drivers
// Supported: mssql, pg, mysql2, sqlite

const fs   = require('fs')
const path = require('path')

const CONNECTIONS_FILE = path.join(__dirname, '../config/sql-connections.json')

// ── Connection file helpers ───────────────────────────────────────────────────

function loadConnections() {
    try {
        if (!fs.existsSync(CONNECTIONS_FILE)) return []
        return JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf8'))
    } catch { return [] }
}

function saveConnections(connections) {
    fs.mkdirSync(path.dirname(CONNECTIONS_FILE), { recursive: true })
    fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(connections, null, 2))
}

function getConnection(id) {
    return loadConnections().find(c => c.id === id) ?? null
}

// ── TM1 parameter substitution (?pParam? → value) ────────────────────────────

function substituteParams(sql, params = {}) {
    return sql.replace(/\?(\w+)\?/g, (match, name) => {
        const val = params[name]
        if (val === undefined || val === '') return match
        const str = String(val).trim()
        return /^-?\d+(\.\d+)?$/.test(str) ? str : `'${str.replace(/'/g, "''")}'`
    })
}

// ── Driver executor ───────────────────────────────────────────────────────────

async function executeQuery(connection, sql, params) {
    const resolved = params ? substituteParams(sql, params) : sql
    switch (connection.driver) {
        case 'mssql':  return executeMSSQL(connection, resolved)
        case 'pg':     return executePG(connection, resolved)
        case 'mysql2': return executeMySQL(connection, resolved)
        case 'sqlite': return executeSQLite(connection, resolved)
        default: throw new Error(`Unknown driver: ${connection.driver}`)
    }
}

async function testConnection(connection) {
    await executeQuery(connection, 'SELECT 1 AS ok')
    return { ok: true }
}

async function getSchema(connection) {
    switch (connection.driver) {
        case 'mssql':  return getSchemaMSSQL(connection)
        case 'pg':     return getSchemaPG(connection)
        case 'mysql2': return getSchemaMySQL(connection)
        case 'sqlite': return getSchemaSQLite(connection)
        default: return []
    }
}

// ── MSSQL ─────────────────────────────────────────────────────────────────────

async function executeMSSQL(conn, sql) {
    const mssql = require('mssql')
    const cfg = {
        server:   conn.server,
        port:     conn.port ?? 1433,
        database: conn.database,
        options:  { encrypt: conn.encrypt ?? false, trustServerCertificate: true },
        ...(conn.auth === 'windows'
            ? { authentication: { type: 'ntlm', options: { domain: conn.domain ?? '', userName: conn.username ?? '', password: conn.password ?? '' } } }
            : { user: conn.username, password: conn.password }),
    }
    const pool = await mssql.connect(cfg)
    try {
        const result = await pool.request().query(sql)
        return formatResult(result.recordset, result.rowsAffected?.[0])
    } finally {
        await pool.close()
    }
}

async function getSchemaMSSQL(conn) {
    const result = await executeMSSQL(conn, `
        SELECT t.TABLE_SCHEMA + '.' + t.TABLE_NAME AS table_name,
               c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type
        FROM INFORMATION_SCHEMA.TABLES t
        JOIN INFORMATION_SCHEMA.COLUMNS c
          ON c.TABLE_NAME = t.TABLE_NAME AND c.TABLE_SCHEMA = t.TABLE_SCHEMA
        WHERE t.TABLE_TYPE IN ('BASE TABLE','VIEW')
        ORDER BY table_name, c.ORDINAL_POSITION`)
    return buildSchemaTree(result.rows)
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────

async function executePG(conn, sql) {
    const { Client } = require('pg')
    const client = new Client({
        host: conn.server, port: conn.port ?? 5432,
        database: conn.database, user: conn.username, password: conn.password,
        ssl: conn.encrypt ? { rejectUnauthorized: false } : false,
    })
    await client.connect()
    try {
        const result = await client.query(sql)
        return formatResult(result.rows, result.rowCount)
    } finally {
        await client.end()
    }
}

async function getSchemaPG(conn) {
    const result = await executePG(conn, `
        SELECT t.table_schema || '.' || t.table_name AS table_name,
               c.column_name, c.data_type
        FROM information_schema.tables t
        JOIN information_schema.columns c USING (table_schema, table_name)
        WHERE t.table_schema NOT IN ('pg_catalog','information_schema')
        ORDER BY table_name, c.ordinal_position`)
    return buildSchemaTree(result.rows)
}

// ── MySQL ─────────────────────────────────────────────────────────────────────

async function executeMySQL(conn, sql) {
    const mysql = require('mysql2/promise')
    const connection = await mysql.createConnection({
        host: conn.server, port: conn.port ?? 3306,
        database: conn.database, user: conn.username, password: conn.password,
        ssl: conn.encrypt ? { rejectUnauthorized: false } : undefined,
    })
    try {
        const [rows, fields] = await connection.execute(sql)
        return formatResult(rows, null, fields)
    } finally {
        await connection.end()
    }
}

async function getSchemaMySQL(conn) {
    const result = await executeMySQL(conn, `
        SELECT CONCAT(TABLE_SCHEMA,'.',TABLE_NAME) AS table_name,
               COLUMN_NAME AS column_name, DATA_TYPE AS data_type
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY table_name, ORDINAL_POSITION`)
    return buildSchemaTree(result.rows)
}

// ── SQLite ────────────────────────────────────────────────────────────────────

async function executeSQLite(conn, sql) {
    const Database = require('better-sqlite3')
    const db = new Database(conn.file)
    try {
        const stmt = db.prepare(sql)
        if (stmt.reader) {
            return formatResult(stmt.all(), null)
        } else {
            const info = stmt.run()
            return formatResult([], info.changes)
        }
    } finally {
        db.close()
    }
}

async function getSchemaSQLite(conn) {
    const Database = require('better-sqlite3')
    const db = new Database(conn.file)
    try {
        const tables = db.prepare(`SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name`).all()
        return tables.map(({ name, type }) => {
            const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all()
            return { table: name, type, columns: cols.map(c => ({ name: c.name, type: c.type || 'TEXT' })) }
        })
    } finally {
        db.close()
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatResult(rows, rowsAffected, fields) {
    const data = Array.isArray(rows) ? rows : []
    const columns = data.length > 0
        ? Object.keys(data[0])
        : (fields ? fields.map(f => f.name) : [])
    return {
        columns,
        rows: data.map(r => columns.map(c => r[c] ?? null)),
        rowCount: rowsAffected ?? data.length,
    }
}

function buildSchemaTree(rows) {
    const map = {}
    for (const row of rows) {
        const t = row.table_name, c = row.column_name, d = row.data_type
        if (!map[t]) map[t] = { table: t, columns: [] }
        map[t].columns.push({ name: c, type: d })
    }
    return Object.values(map)
}

// ── Saved Queries ─────────────────────────────────────────────────────────────

const QUERIES_FILE = path.join(__dirname, '../config/sql-queries.json')

function loadQueries() {
    try {
        if (!fs.existsSync(QUERIES_FILE)) return []
        return JSON.parse(fs.readFileSync(QUERIES_FILE, 'utf8'))
    } catch { return [] }
}

function saveQueries(queries) {
    fs.mkdirSync(path.dirname(QUERIES_FILE), { recursive: true })
    fs.writeFileSync(QUERIES_FILE, JSON.stringify(queries, null, 2))
}

module.exports = { loadConnections, saveConnections, getConnection, executeQuery, testConnection, getSchema, loadQueries, saveQueries }
