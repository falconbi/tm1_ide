'use strict'

const { z } = require('zod')
const lensStore = require('../../../core/lens_store')
const lensBridge = require('../../../core/lens_bridge')

const BRIDGE_CONTRACT = `The generated HTML runs inside a sandboxed iframe with NO network access. Data comes ONLY from the lensBridge API:
  window.lensBridge.call('execMDX', { mdx: '<MDX SELECT>' }) -> Promise<{ Axes, Cells }>
      Cells: [{ Ordinal, Value, FormattedValue }] — Value is a number or null.
  window.lensBridge.call('readCell', { cube: '<cube>', coordinates: { '<dim>': '<elem>', ... } }) -> Promise<number|string|null>
      coordinates must name EVERY dimension of the cube.
  window.lensBridge.call('getMeta', { cube: '<cube>' }) -> Promise<{ cubes, dimensions, cubeDims, elements }>
Return a SINGLE complete HTML document (html, head, style, body, script). No external libraries, CDN, fonts, images or network — draw charts with inline SVG/canvas and vanilla JS. Style it as a polished executive dashboard: card layout, clear hierarchy, good typography, coherent colors, a refresh button. Use EXACT cube/dimension/element names — verify them against the model first (list_cubes / get_* tools). In MDX reference members as [Dim].[Dim].[Member]. Prefer readCell for single values, execMDX for sets. Handle null/empty values gracefully (show '—'). Never hard-code numbers.`

function register(server, { SERVER, AGENT_USER, cl, ok, requireChangeSet }) {
    // Lenses live in the model (Applications/Governance/Lenses on the bound server).
    // The MCP is the builder: it reads and writes with the builder identity.
    server.tool(
        'list_lenses',
        'List the lenses (hand-rolled HTML dashboards on live TM1 data) stored in this server\'s model — name, status, version, owner, updated, description.',
        {},
        async () => {
            const rows = await lensStore.listLenses(SERVER)
            return ok(rows.length ? rows : 'No lenses yet.')
        }
    )

    server.tool(
        'get_lens',
        'Get a lens\'s full HTML and details so you can review or extend it.',
        {
            name: z.string().describe('Lens name'),
        },
        async ({ name }) => {
            try {
                return ok(await lensStore.readLens(SERVER, name))
            } catch (e) {
                return ok({ error: e.message })
            }
        }
    )

    server.tool(
        'save_lens',
        `Save a lens — a hand-rolled HTML dashboard that reads live TM1 data through the lensBridge API — into this server's model (Applications/Governance/Lenses), recorded on the open change set. You (the agent) write the HTML following the contract below, then call this tool. The queries are TEST-RUN against the live model at save, so bad cube/member names are rejected immediately.

${BRIDGE_CONTRACT}`,
        {
            name:        z.string().describe('Lens name — letters, digits, - or _'),
            html:        z.string().describe('Complete HTML document for the lens (see contract)'),
            description: z.string().optional().describe('What the lens shows, in words'),
            publish:     z.boolean().optional().describe('Set status to published (default draft)'),
            force:       z.boolean().optional().describe('Save despite validation failures'),
        },
        async ({ name, html, description, publish, force }) => {
            requireChangeSet()
            const client = (require('../../../core/adapter_registry').makeClient)(SERVER, null)
            const errors = await lensBridge.validateLens(client, html)
            if (errors.length && !force) {
                return ok({ blocked: true, reason: `Lens validation failed (${errors.length}) — fix these and retry, or pass force:true:`, errors })
            }
            const saved = await lensStore.saveLens(SERVER, name, html, AGENT_USER, { publish: !!publish, description })
            cl.writeLog({
                server: SERVER, action: publish ? 'LENS_PUBLISHED' : 'LENS_SAVED',
                objectType: 'lens', objectName: saved.name,
                detail: `version ${saved.version}${description ? ` — ${description}` : ''}`,
                user: AGENT_USER,
            })
            return ok({ saved, validation: errors, next: `Lens "${saved.name}" is saved in ${SERVER}'s model and on the change set. It shows in the IDE model tree under Lenses.` })
        }
    )

    server.tool(
        'delete_lens',
        'Delete a lens from this server\'s model. Requires an open change set.',
        {
            name: z.string().describe('Lens name'),
        },
        async ({ name }) => {
            requireChangeSet()
            await lensStore.deleteLens(SERVER, name)
            cl.writeLog({
                server: SERVER, action: 'LENS_DELETED', objectType: 'lens', objectName: name,
                user: AGENT_USER,
            })
            return ok(`Lens "${name}" deleted from ${SERVER}'s model.`)
        }
    )
}

module.exports = { register }