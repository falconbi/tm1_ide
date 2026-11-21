'use strict'

// ── Is the target idle right now? ───────────────────────────────────────────
// A deploy must not land while the target is loading: the pull replaces objects a
// running process is midway through, and the result is a model nobody designed.
// So the flow checks twice — before DEV is prepared, and again immediately before
// the pull.
//
// Three signals, three different answers:
//   running threads  → REFUSE, naming what is running and for how long
//   chores due soon  → WARN, naming the chore and the time
//   signed-in users  → REPORT, and ask the person to confirm
//
// This is a snapshot, not a lock. It narrows the window; the second check, as
// late as possible, is the one that matters.

const { makeClient } = require('./adapter-registry')
const { TM1Client } = require('./tm1-client')

// ISO 8601 duration (P1DT00H00M00S) → milliseconds. Only the shapes TM1 emits.
function durationMs(text) {
    const m = String(text ?? '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/)
    if (!m) return null
    const [, d, h, min, s] = m
    const ms = ((Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + (Number(min) || 0) * 60 + (Number(s) || 0)) * 1000
    return ms > 0 ? ms : null
}

// The next time a chore runs, computed from StartTime + Frequency (TM1 v11 has no
// next-run property). Returns null when the schedule cannot be understood.
function nextRun(chore, now = new Date()) {
    const start = Date.parse(chore?.StartTime ?? '')
    const step = durationMs(chore?.Frequency)
    if (!Number.isFinite(start) || !step) return null
    const t = now.getTime()
    let k = Math.floor((t - start) / step) + 1
    if (k < 1) k = 1
    let at = start + k * step
    if (at < t) at += step
    return { at: new Date(at).toISOString(), inMinutes: Math.round((at - t) / 60000) }
}

async function idleCheck(server, { ideToken, windowMinutes = 30 } = {}) {
    const tm1 = new TM1Client(server, makeClient(server, ideToken))
    const out = {
        server,
        at: new Date().toISOString(),
        windowMinutes,
        running: [],
        choresDue: [],
        sessions: [],
        sessionsReadable: true,
        errors: [],
    }

    try {
        const threads = await tm1.getThreads()
        out.running = (threads.value ?? threads)
            .filter(t => {
                const state = String(t.State ?? '')
                if (!state || /idle/i.test(state)) return false
                // Only work that changes the model. A user's HTTP GET is not a load.
                return /process|chore/i.test(String(t.ObjectType ?? ''))
            })
            .map(t => ({
                name: t.ObjectName || t.Function || t.Name || '(unnamed)',
                type: t.ObjectType || t.Type || null,
                state: t.State,
                elapsed: t.ElapsedTime ?? null,
            }))
    } catch (e) {
        out.errors.push(`threads: ${e.message}`)
    }

    try {
        const names = await tm1.getChores()
        for (const name of names) {
            const chore = await tm1.getChore(name)
            if (!chore?.Active) continue
            const due = nextRun(chore)
            if (due && due.inMinutes <= windowMinutes) out.choresDue.push({ name, at: due.at, inMinutes: due.inMinutes })
        }
    } catch (e) {
        out.errors.push(`chores: ${e.message}`)
    }

    try {
        const sessions = await tm1.getSessions()
        out.sessions = (sessions.value ?? sessions)
            .map(s => s.ClientName ?? s.User?.Name ?? s.Name)
            .filter(n => n && typeof n === 'string')
        out.sessions = [...new Set(out.sessions)]
    } catch {
        // Not every login can see other people's sessions. Say so; never report zero.
        out.sessionsReadable = false
    }

    out.idle = out.running.length === 0
    return out
}

module.exports = { idleCheck, nextRun, durationMs }
