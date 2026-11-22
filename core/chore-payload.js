'use strict'

// TM1 v11 chore creation has two traps, both found by experiment on the lab:
//
//   1. a task's process is an ENTITY BIND on the task, not a nested object:
//        { Step: 0, 'Process@odata.bind': "Processes('X')" }
//      a nested { Process: { Name: 'X' } } is rejected with
//      'Expecting type "EntityBind" but was "Object"'.
//   2. the task's parameter COUNT must equal the process's:
//        'Mismatch between task parameter count and process parameter count'
//      so a task with no parameters cannot be created against a process that has
//      some — the defaults have to be supplied.
//
// Pure, so the payload rule is testable without a server: pass the processes'
// parameter definitions and get a body TM1 accepts.

const odataKey = (s) => String(s ?? '').replace(/'/g, "''")

function paramDefaults(process) {
    return (process?.Parameters ?? []).map(p => ({ Name: p.Name, Value: String(p.Value ?? '') }))
}

// data: what the caller has (Tasks may carry a nested Process, a ProcessName, or a
//       bind already; Parameters may be missing or short).
// processByName: (name) => the process definition, for the parameter defaults.
function toCreateChoreBody(data, processByName = () => null) {
    const body = { ...data }
    if (Array.isArray(body.Tasks)) {
        body.Tasks = body.Tasks.map((t) => {
            const name = t?.Process?.Name ?? t?.ProcessName ?? String(t?.['Process@odata.bind'] ?? '').match(/Processes\('([^']+)'\)/)?.[1] ?? null
            const process = name ? processByName(name) : null
            const out = { Step: t?.Step ?? 0 }
            if (name) out['Process@odata.bind'] = `Processes('${odataKey(name)}')`
            const given = Array.isArray(t?.Parameters) ? t.Parameters.map(p => ({ Name: p.Name, Value: String(p.Value ?? '') })) : null
            // The count must match: use what was given when it is complete,
            // otherwise the process's own defaults.
            const defaults = paramDefaults(process)
            out.Parameters = given && given.length === defaults.length ? given : defaults
            return out
        })
    }
    return body
}

module.exports = { toCreateChoreBody, paramDefaults }
