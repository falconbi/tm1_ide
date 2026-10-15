'use strict'
// Passwords in TI code and datasources never reach the agent — always on.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./_mcp-harness')
const { stripTiCredentials, stripDatasourceCredentials } = require('../tools/tm1mcp/guard')

const SECRET = 'Tr0ub4dor'

test('ODBCOpen / ODBCOpenEx / AssignClientPassword password arguments are masked', () => {
    const code = [
        `ODBCOpen('FinDSN', 'loader', '${SECRET}');`,
        `ODBCOpenEx( pDSN , 'loader' , '${SECRET}' , 1 );`,
        `AssignClientPassword('bob', '${SECRET}');`,
        `ODBCOpen(pDSN, pUser, '${SECRET}' | 'x');`,
    ].join('\n')
    const out = stripTiCredentials(code)
    assert.equal(out.includes(SECRET), false, out)
    assert.match(out, /ODBCOpen\('FinDSN', 'loader', '\*\*\*'\);/)
    assert.match(out, /ODBCOpenEx\( pDSN , 'loader' , '\*\*\*' , 1 \);/)
    assert.match(out, /AssignClientPassword\('bob', '\*\*\*'\);/)
})

test('password-named variables and connection strings are masked; other code is not', () => {
    const code = [
        `vPassword = '${SECRET}';`,
        `sDbPwd='${SECRET}';`,
        `cApiToken = '${SECRET}';`,
        `vConn = 'DSN=Fin;UID=loader;PWD=${SECRET};';`,
        `vConn2 = 'Server=db;Password=${SECRET};Database=fin';`,
        `vCube = 'Sales';`,
        `CellPutN(nValue, vCube, 'Actual', 'Jan');`,
    ].join('\n')
    const out = stripTiCredentials(code)
    assert.equal(out.includes(SECRET), false, out)
    assert.match(out, /vCube = 'Sales';/)
    assert.match(out, /CellPutN\(nValue, vCube, 'Actual', 'Jan'\);/)
    assert.match(out, /UID=loader;PWD=\*\*\*;/)
})

test('a quoted string containing a quote does not throw the masking off', () => {
    const out = stripTiCredentials(`ODBCOpen('O''Brien DSN', 'u', '${SECRET}'); vX = 'keep';`)
    assert.equal(out.includes(SECRET), false)
    assert.match(out, /'O''Brien DSN'/)
    assert.match(out, /vX = 'keep';/)
})

test('datasource password fields are masked', () => {
    const ds = { Type: 'ODBC', dataSourceNameForServer: 'Fin', userName: 'loader', password: SECRET, query: `SELECT 1 -- PWD=${SECRET};` }
    const out = stripDatasourceCredentials(ds)
    assert.equal(JSON.stringify(out).includes(SECRET), false)
    assert.equal(out.userName, 'loader')
})

test('get_process and search_ti_code return code with credentials stripped', async () => {
    const h = setup()
    const proc = { Name: 'Load', PrologProcedure: `ODBCOpen('Fin', 'loader', '${SECRET}');`, DataSource: { Type: 'ODBC', password: SECRET } }
    h.builder.get = async () => proc
    h.builder.getProcesses = async () => ['Load']
    h.builder.getProcess = async () => proc
    const g = await h.call('get_process', { process: 'Load' })
    assert.equal(g.text.includes(SECRET), false, g.text)
    const s = await h.call('search_ti_code', { pattern: 'ODBCOpen' })
    assert.equal(s.text.includes(SECRET), false, s.text)
    assert.equal(s.data[0].process, 'Load')
})
