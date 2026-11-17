'use strict'

const { odataKey } = require('./odata-key')

// Build/update a TI process from an SQL query. Pure orchestration over TM1Client:
// the route keeps the HTTP/auth validation, this owns the datasource body,
// ?param? tokens and create-vs-merge behaviour.
async function postSqlToTi(client, { conn, sql, processName, createNew = false }) {
    const tokens = [...new Set([...sql.matchAll(/\?(\w+)\?/g)].map(m => m[1]))]
    const paramList = tokens.length ? `-- Parameters: ${tokens.map(t => '?' + t + '?').join(', ')}\n` : ''
    const header = `-- TM1 Process Datasource (via IDE)\n-- DSN: ${conn.dsn}\n${paramList}--\n\n`
    const odbcProps = {
        DataSource: {
            Type: 'ODBC',
            dataSourceNameForServer: conn.dsn,
            dataSourceNameForClient: '',
            query: header + sql,
            userName: '',
            password: '',
            usesUnicode: true,
        },
    }

    if (createNew) {
        await client.post('Processes', {
            Name: processName,
            PrologProcedure: '',
            MetadataProcedure: '',
            DataProcedure: '',
            EpilogProcedure: '',
            HasSecurityAccess: false,
            ...odbcProps,
            Parameters: tokens.map(t => ({ Name: t, Type: 'String', Value: '', Prompt: '' })),
            Variables: [],
        })
        return { ok: true, created: true, dsn: conn.dsn, paramsAdded: tokens }
    }

    const proc = await client.getProcess(processName)
    const existing = (proc.Parameters ?? []).map(p => p.Name)
    const newParams = tokens.filter(t => !existing.includes(t))
        .map(t => ({ Name: t, Type: 'String', Value: '', Prompt: '' }))
    await client.patch(`Processes('${odataKey(processName)}')`, {
        ...odbcProps,
        Parameters: [...(proc.Parameters ?? []), ...newParams],
    })
    return { ok: true, created: false, dsn: conn.dsn, paramsAdded: newParams.map(p => p.Name) }
}

module.exports = { postSqlToTi }
