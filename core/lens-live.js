'use strict'

// ── Working together: a live channel between people on the same Lens ─────────
// People are grouped into rooms by Lens + channel (the Lens picks the channel,
// e.g. 'store:101|Y2', so only people looking at the same store hear about it).
// The server stamps every event with the real signed-in user — a browser can't
// speak for someone else — and caps size and rate. Nothing is stored: events
// go to whoever is in the room right now.

const crypto = require('crypto')

const TYPES = new Set(['cursor', 'typing', 'saved', 'reservation', 'state', 'present', 'history'])
const PALETTE = ['#0ea5e9', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#6366f1', '#ec4899', '#14b8a6']

// The same person always gets the same colour.
function colorFor(user) {
    let h = 0
    for (const ch of String(user)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return PALETTE[h % PALETTE.length]
}

function createLiveHub({ maxEventBytes = 4096, perSecond = 20 } = {}) {
    const rooms = new Map()   // lens\u0001channel -> Map(connId -> conn)
    const roomKey = (lens, channel) => `${lens}\u0001${channel}`
    const memberOf = c => ({ id: c.id, user: c.user, color: c.color })
    const send = (conn, ev) => { try { conn.write(ev) } catch { /* a closed connection leaves on its own */ } }

    return {
        // write(event) delivers to this person's browser. Returns { id, leave() }.
        join(lens, channel, user, write) {
            const k = roomKey(lens, channel)
            if (!rooms.has(k)) rooms.set(k, new Map())
            const room = rooms.get(k)
            const conn = { id: crypto.randomBytes(6).toString('hex'), user, color: colorFor(user), write, hits: [] }
            for (const c of room.values()) send(c, { type: 'join', member: memberOf(conn) })
            room.set(conn.id, conn)
            send(conn, { type: 'hello', you: memberOf(conn), members: [...room.values()].map(memberOf) })
            return {
                id: conn.id,
                leave() {
                    if (!room.delete(conn.id)) return
                    for (const c of room.values()) send(c, { type: 'leave', id: conn.id, user })
                    if (!room.size) rooms.delete(k)
                },
            }
        },

        // Pass an event to everyone else in the room, stamped with who sent it.
        publish(lens, channel, user, connId, event) {
            const room = rooms.get(roomKey(lens, channel))
            const conn = room?.get(connId)
            if (!conn || conn.user !== user) throw new Error('you are not connected to this Lens')
            if (!event || typeof event !== 'object' || Array.isArray(event) || !TYPES.has(event.type)) throw new Error('unknown event')
            if (Buffer.byteLength(JSON.stringify(event)) > maxEventBytes) throw new Error('event too large')
            const now = Date.now()
            conn.hits = conn.hits.filter(t => now - t < 1000)
            if (conn.hits.length >= perSecond) throw new Error('too many events — slow down')
            conn.hits.push(now)
            const { from: _ignored, at: _ignored2, ...data } = event
            const out = { ...data, from: memberOf(conn), at: new Date(now).toISOString() }
            for (const c of room.values()) if (c.id !== conn.id) send(c, out)
            return out
        },

        rooms() { return rooms.size },
    }
}

module.exports = { createLiveHub, colorFor, TYPES }
