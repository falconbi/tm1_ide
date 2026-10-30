'use strict'

const { z } = require('zod')

// The hidden core process is installed separately; this tool is the supported
// way for an agent to run it. Do not expose the raw }IDE.* process.
const CORE = '}IDE.Version.Copy'

function register(server, { client, ok, requireChangeSet, SERVER, logChange }) {
    server.tool(
        'copy_version',
        'Run the installed core }IDE.Version.Copy process: copy one version into a new or existing version as static values or a calculating seed. ' +
        'The process must already be installed on the server. Requires an open change set. Does not use Bedrock.',
        {
            pSource: z.string().describe('Source version'),
            pTarget: z.string().describe('Target version'),
            pMode: z.enum(['new', 'replace']).default('new').describe('Create a new target or replace an existing one'),
            pType: z.enum(['calculating', 'static']).default('static').describe('Calculating = copy input cubes only; static = freeze all values'),
            pApp: z.string().default('WFP').describe('Application key in SYS Settings'),
            pVersionDim: z.string().default('').describe('Version dimension name; blank reads SYS Settings'),
            pStaticParent: z.string().default('Non-Calculating').describe('Parent for a static target'),
            pInputCubes: z.string().default('').describe('Comma-separated input cubes for calculating mode'),
            pExcludeCubes: z.string().default('').describe('Comma-separated cubes to skip'),
            pStatus: z.string().default('').describe('Status attribute value; blank = Approved for static, Working for calculating'),
            pTypeAttr: z.string().default('Version Type').describe('Version type attribute'),
            pStatusAttr: z.string().default('Status').describe('Version status attribute'),
            timeout_ms: z.number().int().positive().optional().describe('Optional HTTP timeout (default 120s)'),
        },
        async (args) => {
            requireChangeSet()
            const c = client()
            const def = await c.getProcess(CORE).catch(() => null)
            if (!def) return ok({ error: `${CORE} is not installed on this server. Install the core TI first.` })
            const params = Object.fromEntries(Object.entries(args).filter(([k, v]) => k !== 'timeout_ms' && v !== undefined))
            const result = await c.executeProcess(CORE, params, args.timeout_ms ? { timeout: args.timeout_ms } : {})
            return ok({ status: result?.ProcessExecuteStatusCode ?? result?.Status ?? 'completed', result })
        }
    )
    server.tool(
        'save_data_all',
        'Write all changed cube data on this server to disk (SaveDataAll). Admin group only. The server pauses briefly. ' +
        'Uses the REST save action, falling back to the hidden }IDE.SaveDataAll TI if the server does not support it.',
        {},
        async () => {
            const c = client()
            const me = await c.get('ActiveUser', { '$expand': 'Groups($select=Name)' })
            const groups = (me?.Groups ?? []).map(g => g.Name ?? g)
            if (!groups.some(g => String(g).toLowerCase() === 'admin')) {
                throw new Error(`Only TM1 admins can save data on ${SERVER}.`)
            }
            const result = await c.saveDataAll()
            const savedAt = new Date().toISOString()
            logChange('SAVE_DATA_ALL', 'server', SERVER, { detail: `Saved all changed data (${result.method})` })
            return ok({ status: 'saved', server: SERVER, savedAt, method: result.method })
        }
    )
}

module.exports = { register }
