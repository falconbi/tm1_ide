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
    server.tool(
        'list_lenses',
        'List the lenses (hand-rolled HTML dashboards on live TM1 data) stored for this server — name, status, version, updated, description.',
        {},
        async () => {
            const files = lensStore.listFiles()
            if (!files.length) return ok('No lenses yet.')
            const client = (require('../../../core/adapter_registry').makeClient)(SERVER, null)
            const rows = await Promise.all(files.map(async f => {
                try {
                    const meta = await lensStore.readMeta(client, f.name)
                    return { name: f.name, ...meta, modified: f.modified }
                } catch { return { name: f.name, modified: f.modified } }
            }))
            return ok(rows)
        }
    )

    server.tool(
        'get_lens',
        'Get a lens\'s full HTML so you can review or extend it.',
        {
            name: z.string().describe('Lens name'),
        },
        async ({ name }) => {
            try {
                const lens = lensStore.readLens(name)
                return ok({ name: lens.name, html: lens.html })
            } catch (e) {
                return ok({ error: e.message })
            }
        }
    )

    server.tool(
        'save_lens',
        `Save a lens — a hand-rolled HTML dashboard that reads live TM1 data through the lensBridge API and is stored as a governed, change-set-tracked artifact. You (the agent) write the HTML following the contract below, then call this tool. The queries are TEST-RUN against the live model at save, so bad cube/member names are rejected immediately.

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
            const saved = lensStore.saveLens(client, name, html, AGENT_USER, { publish: !!publish, description })
            cl.writeLog({
                server: SERVER, action: publish ? 'LENS_PUBLISHED' : 'LENS_SAVED',
                objectType: 'lens', objectName: name,
                detail: description ?? null,
                user: AGENT_USER,
            })
            return ok({ saved, validation: errors, next: `Lens "${name}" is on the change set. It renders in the IDE Lenses section and at /lenses/<server>/${name}.` })
        }
    )

    server.tool(
        'delete_lens',
        'Delete a lens (removes the file; the }Lenses metadata row is left as a tombstone). Requires an open change set.',
        {
            name: z.string().describe('Lens name'),
        },
        async ({ name }) => {
            requireChangeSet()
            lensStore.deleteLens(name)
            cl.writeLog({
                server: SERVER, action: 'LENS_DELETED', objectType: 'lens', objectName: name,
                user: AGENT_USER,
            })
            return ok(`Lens "${name}" deleted.`)
        }
    )
}

module.exports = { register }