'use strict'

const { odataKey } = require('./odata-key')

const MAX_HITS = 50
const DBG_ATTR = '__DBG_LOG'

const nl = s => (s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
const stripMeta = obj => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('@')))

// Instrument one TI section with breakpoint logs and watch values. Pure string
// work: the caller supplies the continuation joiner and the safe process name.
function instrumentSection(rawCode, sectionKey, sectionLabel, opts) {
    const { watches, breakpoints, captureWhen, safeProcName, joinContinuations } = opts
    const code  = joinContinuations(nl(rawCode ?? ''))
    const bpSet = new Set(breakpoints?.[sectionKey] ?? [])
    if (!watches?.length && !bpSet.size) return code

    function appendLines(label, lineNum, labelName) {
        // capped: a breakpoint in the Data section fires once per record, and the log is one growing
        // string — capturing every record made a debug run on a big view crawl past the 2-minute timeout
        const guard = String(captureWhen ?? '').replace(/[\r\n]/g, ' ').trim()
        const condition = guard
            ? `nDBGHit__IDE__ < ${MAX_HITS} & (${guard})`
            : `nDBGHit__IDE__ < ${MAX_HITS}`
        const lines = [`IF( ${condition} ); nDBGHit__IDE__ = nDBGHit__IDE__ + 1;`,
                       `sDBGLog__IDE__ = ATTRS('}Processes', '${safeProcName}', '${DBG_ATTR}');`]
        lines.push(`sDBGLog__IDE__ = sDBGLog__IDE__ | '${label}' | CHAR(10);`)
        for (const w of (watches ?? [])) {
            const val = w.type === 'number' ? `NumberToString(${w.name})` : w.name
            lines.push(`sDBGLog__IDE__ = sDBGLog__IDE__ | '__DBG_VAR:${w.name}__${labelName}__${lineNum}=' | ${val} | CHAR(10);`)
        }
        lines.push(`AttrPutS(sDBGLog__IDE__, '}Processes', '${safeProcName}', '${DBG_ATTR}');`)
        lines.push('ENDIF;')
        return lines
    }

    const lines  = code.split('\n')
    const result = []
    let parenDepth = 0, inStr = false

    const trackDepth = (line) => {
        for (let j = 0; j < line.length; j++) {
            const ch = line[j]
            if (inStr) {
                if (ch === "'") { if (line[j + 1] === "'") j++; else inStr = false }
            } else {
                if      (ch === '#')  break
                else if (ch === "'")  inStr = true
                else if (ch === '(')  parenDepth++
                else if (ch === ')')  parenDepth--
            }
        }
    }

    let prevDepth = 0
    for (let i = 0; i < lines.length; i++) {
        const lineNum   = i + 1
        const prevLine  = i > 0 ? lines[i - 1] : ''
        const canInject = prevDepth === 0 && !/^\s*(IF|WHILE|ELSEIF)\s*$/i.test(prevLine)
        if (bpSet.has(lineNum) && canInject) {
            result.push(...appendLines(`__DBG_BP:${lineNum}:${sectionLabel}`, lineNum, sectionLabel))
        }
        result.push(lines[i])
        trackDepth(lines[i])
        prevDepth = parenDepth
    }

    return result.join('\n')
}

// Run a process copy under the debugger: fetch its metadata, instrument the
// requested breakpoints/watches into a temp process, execute it, read __DBG_LOG
// back through MDX, then remove the temp process. Returns the route's response
// body, or { failure } when the temp process could not be created.
async function debugProcess(client, { name, params, sections, watches, breakpoints, captureWhen, joinContinuations }) {
    const tempName = `_IDE_Debug_${Date.now()}`
    let log = '', runError = null

    // ── 1. Fetch source process metadata ─────────────────────────────────────
    let proc
    try {
        proc = await client.get(`Processes('${odataKey(name)}')`)
    } catch (e) {
        return { failure: `Failed to create debug process: ${e.message}` }
    }

    const jc          = s   => joinContinuations(nl(s))
    const cleanParams = (proc.Parameters ?? []).map(p => ({
        Name: p.Name, Type: p.Type ?? 2, Value: String(p.Value ?? ''), Prompt: p.Prompt ?? '',
    }))

    // ── 2. Ensure __DBG_LOG attribute exists ──────────────────────────────────
    const safeProcName = name.replace(/'/g, "''")
    const hasCapture   = (watches?.length > 0) || Object.values(breakpoints ?? {}).some(a => a.length > 0)

    if (hasCapture) {
        try {
            await client.post(
                `Dimensions('%7DProcesses')/Hierarchies('%7DProcesses')/ElementAttributes`,
                { Name: DBG_ATTR, Type: 'String' }
            )
        } catch { /* 409 = already exists — fine */ }
        try {
            await client.post('ExecuteProcessWithReturn?$expand=*', {
                Process: {
                    Name: '_IDE_ClearDbg',
                    PrologProcedure: `AttrPutS('', '}Processes', '${safeProcName}', '${DBG_ATTR}');`,
                    MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
                    HasSecurityAccess: false, DataSource: { Type: 'None' },
                    Parameters: [], Variables: [],
                }
            })
        } catch (e) {
            console.warn('[debug] could not clear __DBG_LOG:', e.message)
        }
    }

    // ── 3. Instrument sections ────────────────────────────────────────────────
    const instrument = (rawCode, sectionKey, sectionLabel) =>
        instrumentSection(rawCode, sectionKey, sectionLabel, {
            watches, breakpoints, captureWhen, safeProcName, joinContinuations,
        })

    // ── 4. Create temp process with instrumented code ────────────────────────
    // The hit counter starts on its own line before the Prolog. Prefixing it to
    // line 1 broke processes whose first line was a #Region/comment.
    const prologInst = (hasCapture ? 'nDBGHit__IDE__ = 0;\n' : '') + instrument(sections.PrologProcedure, 'PrologProcedure', 'Prolog')
    // TM1's property is MetadataProcedure (lowercase d); an older client may still send MetaDataProcedure
    const metaSrc    = sections.MetadataProcedure ?? sections.MetaDataProcedure ?? ''
    if (breakpoints && breakpoints.MetadataProcedure == null && breakpoints.MetaDataProcedure) breakpoints.MetadataProcedure = breakpoints.MetaDataProcedure
    const metaInst   = metaSrc.trim()
        ? instrument(metaSrc, 'MetadataProcedure', 'Metadata')
        : (jc(metaSrc))
    const dataInst   = (sections.DataProcedure ?? '').trim()
        ? instrument(sections.DataProcedure, 'DataProcedure', 'Data')
        : (jc(sections.DataProcedure ?? ''))
    const epilInst   = (sections.EpilogProcedure ?? '').trim()
        ? instrument(sections.EpilogProcedure, 'EpilogProcedure', 'Epilog')
        : (jc(sections.EpilogProcedure ?? ''))

    try {
        await client.createOrReplaceProcess({
            name:       tempName,
            prolog:     prologInst,
            metadata:   metaInst,
            data:       dataInst,
            epilog:     epilInst,
            parameters: cleanParams,
            // the copy must keep the datasource + its variables, or the Data section never runs
            datasource: proc.DataSource ? stripMeta(proc.DataSource) : undefined,
            variables:  (proc.Variables ?? []).map(stripMeta),
        })
    } catch (e) {
        return { failure: `Failed to create debug process: ${e.message}` }
    }

    // ── 5. Execute ─────────────────────────────────────────────────────────────
    try {
        const dbgRun = await client.executeProcess(tempName, params ?? [])
        const status = dbgRun?.ProcessExecuteStatusCode
        if (status && !['CompletedSuccessfully', 'HasMinorErrors', 0].includes(status)) {
            const errFile = dbgRun?.ErrorLogFile?.Filename
            runError = errFile
                ? ((await client.getErrorLogContent(errFile).catch(() => null))?.Content || `Debug run ${status}`)
                : `Debug run ${status}`
        }
    } catch (e) {
        const data  = e.response?.data
        const inner = data?.error?.innererror ?? {}
        const procErr = data?.error?.details?.ProcessError ?? ''
        console.error('[debug] execute error:', e.response?.status, JSON.stringify(data ?? e.message).slice(0, 400))
        runError = procErr || inner.Message || data?.error?.message || e.message
    }

    // ── 6. Read captured log via MDX ──────────────────────────────────────────
    if (hasCapture) {
        try {
            const mdxMember = name.replace(/\]/g, ']]')
            const mdx = [
                `SELECT {[}ElementAttributes_}Processes].[}ElementAttributes_}Processes].[${DBG_ATTR}]} ON COLUMNS,`,
                `{[}Processes].[}Processes].[${mdxMember}]} ON ROWS`,
                `FROM [}ElementAttributes_}Processes]`,
            ].join(' ')
            const result  = await client.executeMDX(mdx)
            const attrLog = (result?.Cells?.[0]?.Value ?? '').replace(/\r/g, '')
            console.log('[debug] MDX raw:', JSON.stringify(attrLog).slice(0, 300))
            if (attrLog.includes('__DBG_BP:')) {
                log      = attrLog + '\n__DBG_DONE:ok'
                runError = null
            }
        } catch (e) {
            console.error('[debug] MDX read failed:', e.message)
        }
    } else if (!runError) {
        log = '__DBG_DONE:ok'
    }

    try { await client.deleteProcess(tempName) }
    catch (e) { console.error('[debug] cleanup failed:', e.message) }

    return { log, error: runError, noCapture: !hasCapture && !runError }
}

module.exports = { debugProcess, instrumentSection }
