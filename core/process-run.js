'use strict'

const { odataKey } = require('./odata-key')

const RUN_ATTR = '__RUN_LOG'

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

module.exports = { runProcess }
