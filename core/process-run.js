'use strict'

const { odataKey } = require('./odata-key')

const RUN_ATTR = '__RUN_LOG'

// Same secret-key rule as tools/tm1mcp/guard.js. A run's parameters are recorded
// in the change set, so a password or token passed to a TI must never be.
const SECRET_KEY = /(^|[_-])(pass|passwd|pwd)$|password|secret|api_?key$|^token$|[_-]token$|Token$/i
const MASK = '***'

function maskRunParams(params) {
    if (params == null || typeof params !== 'object') return params
    if (Array.isArray(params)) {
        return params.map((p) => {
            // TM1 parameter arrays are [{ Name, Value }]; mask by the parameter name.
            if (p && typeof p === 'object' && 'Name' in p && 'Value' in p && SECRET_KEY.test(String(p.Name))) {
                return { ...p, Value: MASK }
            }
            return maskRunParams(p)
        })
    }
    const out = {}
    for (const [key, value] of Object.entries(params)) {
        if (SECRET_KEY.test(key) && value != null && value !== '') out[key] = MASK
        else out[key] = maskRunParams(value)
    }
    return out
}

// Record one run in the active change set. A run is a record, not a metadata
// change: object_type stays 'process-run' (never in ENTRY_TO_OBJECT), so it can
// never make a release carry the process file itself.
function recordProcessRun({ server, user, name, kind = 'process', params = null, status = 'completed', duration = null, log = null }) {
    const cl = log ?? require('./change-log')
    const session = cl.getActiveSession(server, user)
    if (!session) return { recorded: false }
    cl.writeLog({
        server,
        action: 'PROCESS_RUN',
        objectType: 'process-run',
        objectName: name,
        detail: { name, kind, params: maskRunParams(params), status, duration: duration ?? null },
        user,
    })
    return { recorded: true, session: session.name }
}

// Execute a TI process and collect its __RUN_LOG, TM1 error section/line and
// error-log filename. The route turns the returned status/body into HTTP.
async function runProcess(client, { name, params } = {}) {
    const safeName = name.replace(/'/g, "''")

    // ── 1. Ensure __RUN_LOG attribute exists and is cleared ──────────────────
    try {
        await client.post(
            `Dimensions('%7DProcesses')/Hierarchies('%7DProcesses')/ElementAttributes`,
            { Name: RUN_ATTR, Type: 'String' }
        )
    } catch { /* 409 = already exists — fine */ }
    try {
        await client.post('ExecuteProcessWithReturn?$expand=*', {
            Process: {
                Name: '_IDE_ClearRunLog',
                PrologProcedure: `AttrPutS('', '}Processes', '${safeName}', '${RUN_ATTR}');`,
                MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
                HasSecurityAccess: false, DataSource: { Type: 'None' },
                Parameters: [], Variables: [],
            }
        })
    } catch { /* non-critical */ }

    // ── 2. Execute the process ────────────────────────────────────────────────
    let duration = null, runError = null, errorSection = null, errorLine = null, errorLogFilename
    try {
        const result = await client.executeProcess(name, params ?? [])
        duration         = result?.Times?.ExecutionTimeInMilliseconds ?? null
        errorLogFilename = result?.ErrorLogFile?.Filename ?? null
    } catch (e) {
        const inner = e.response?.data?.error?.innererror ?? {}
        console.error('[process/run]', JSON.stringify(inner) || e.message)
        runError         = inner.Message || e.message
        errorSection     = inner.ProcedureSection ?? null
        errorLine        = inner.LineNumber ?? null
        // ErrorLogFile may be in the error response body
        errorLogFilename = e.response?.data?.error?.innererror?.ErrorLogFile?.Filename
                        ?? e.response?.data?.ErrorLogFile?.Filename
                        ?? null
    }

    // ── 3. Read __RUN_LOG back via MDX ────────────────────────────────────────
    let runLog = ''
    try {
        const mdxMember = name.replace(/\]/g, ']]')
        const mdx = [
            `SELECT {[}ElementAttributes_}Processes].[}ElementAttributes_}Processes].[${RUN_ATTR}]} ON COLUMNS,`,
            `{[}Processes].[}Processes].[${mdxMember}]} ON ROWS`,
            `FROM [}ElementAttributes_}Processes]`,
        ].join(' ')
        const mdxResult = await client.executeMDX(mdx)
        runLog = (mdxResult?.Cells?.[0]?.Value ?? '').replace(/\r/g, '')
    } catch (e) {
        console.error('[process/run] __RUN_LOG MDX failed:', e.message)
    }

    // ── 4. Fallback: if no __RUN_LOG and process errored, use TM1 ErrorLog ────
    if (!runLog && runError) {
        try {
            const errLog = await client.get(`Processes('${odataKey(name)}')/ErrorLog`)
            runLog = typeof errLog === 'string' ? errLog : (errLog?.value ?? '')
        } catch (e) {
            console.error('[process/run] ErrorLog fallback failed:', e.message)
        }
    }

    // ── 5. Detect __ERROR: validation marker (written before ProcessQuit) ────────
    if (!runError && runLog.startsWith('__ERROR:')) {
        const msg = runLog.replace(/^__ERROR:/, '').trim()
        return { ok: false, status: 500, body: { error: msg, section: null, line: null, runLog: msg } }
    }

    if (runError) {
        return { ok: false, status: 500, body: { error: runError, section: errorSection, line: errorLine, runLog, errorLogFilename } }
    }
    return { ok: true, duration, runLog, errorLogFilename }
}

module.exports = { runProcess, recordProcessRun, maskRunParams }
