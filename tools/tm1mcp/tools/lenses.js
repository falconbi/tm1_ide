'use strict'

const { z } = require('zod')
const lensStore = require('../../../core/lens_store')
const lensBridge = require('../../../core/lens_bridge')

const CATALOGUE = JSON.stringify(require('../../../shared/lens-components.json'), null, 1)
const BRIDGE_CONTRACT = `The generated HTML runs inside a sandboxed iframe with NO network access. Data comes ONLY from the lensBridge API:
  window.lensBridge.call('execMDX', { mdx: '<MDX SELECT>' }) -> Promise<{ Axes, Cells }>
      Cells: [{ Ordinal, Value, FormattedValue, RuleDerived, Consolidated }] — Value is a number or null.
  window.lensBridge.call('readCell', { cube: '<cube>', coordinates: { '<dim>': '<elem>', ... } }) -> Promise<number|string|null>
      coordinates must name EVERY dimension of the cube.
  window.lensBridge.call('getMeta', { cube: '<cube>' }) -> Promise<{ cubes, dimensions, cubeDims, elements }>
Return a SINGLE complete HTML document (html, head, style, body, script). The ONLY library is the Lens toolkit, served by the app: include <script src="/lens-kit/lens-kit.js"></script> before your own script, turn each execMDX result into rows with Lens.rows(result), and use its components (Lens.kpis, trend, waterfall, bars, grid, flow — catalogue below) wherever one fits; hand-draw SVG/canvas only for a visual no component covers. No CDN, fonts, images or network. Style it as a polished dashboard: clear hierarchy, good typography, coherent colors (Lens.theme.colors), a refresh button. Use EXACT cube/dimension/element names — verify them against the model first (list_cubes / get_* tools). In MDX reference members as [Dim].[Dim].[Member]. Handle null/empty values gracefully (show '—'). Never hard-code numbers. Only build input (write-back) when asked: an editable Lens.grid plus Lens.save, with the cube declared in the head as <meta name="lens-writes" content="Cube Name">. Action buttons likewise only when asked: Lens.run('Process', { params }), declared as <meta name="lens-runs" content="Process Name">.

Lens toolkit catalogue:
${CATALOGUE}`

function register(server, { SERVER, AGENT_USER, ok, requireChangeSet, client, logChange }) {
    // Viewfinder: proven Lens code to build from — prefer a template + config
    // over writing a Lens from scratch.
    server.tool(
        'list_viewfinder',
        'List the Viewfinder templates — proven Lens code (e.g. an input form) that a Lens can use with just a config. Shows what each setting means and an example config. Prefer a template + config (save_lens with template) over writing a Lens from scratch.',
        {},
        async () => ok((await require('../../../core/viewfinder').listAll(SERVER, { client: client() })).map(({ html: _h, ...t }) => t))
    )

    // Lenses live in the model (Applications/Governance/Lenses on the bound server).
    // Reads go through client() — the reader identity — so a Lens document the
    // reader's TM1 login can't open isn't shown; saves and deletes use the builder.
    server.tool(
        'list_lenses',
        'List the lenses (hand-rolled HTML dashboards on live TM1 data) stored in this server\'s model — name, status, version, owner, updated, description.',
        {},
        async () => {
            const rows = await lensStore.listLenses(SERVER, { client: client() })
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
                return ok(await lensStore.readLens(SERVER, name, { client: client() }))
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
            html:        z.string().optional().describe('Complete HTML document for the lens (see contract) — omit when using a Viewfinder template'),
            template:    z.string().optional().describe("Build from a Viewfinder template (see list_viewfinder) instead of writing code: the Lens stores only the template name + its config. '' detaches it."),
            description: z.string().optional().describe('What the lens shows, in words'),
            config:      z.record(z.any()).optional().describe("The Lens's settings, read in the Lens with Lens.config(): bindings (cube, version, rows…) and behaviour; access: [TM1 groups] limits who can open it in the Lens app; theme: 'fixed'. Omit to keep the current config"),
            icon:        z.string().optional().describe('Home-page icon, one of: ' + require('../../../core/lens_store').ICON_NAMES.join(', ')),
            color:       z.string().optional().describe("Home-page tile colour, '#rrggbb'"),
            title:       z.string().optional().describe("What people see in the Lens app, in business words (e.g. '1 Enter targets'); a leading number orders steps in a folder. Omit to keep the current one"),
            folder:      z.string().optional().describe("Folder on the Lens app home page, e.g. 'Finance' or 'Planning/Forecast' ('/' = sub-folder); omit to keep the current one"),
            publish:     z.boolean().optional().describe('Set status to published (default draft)'),
            force:       z.boolean().optional().describe('Save despite validation failures'),
        },
        async ({ name, html, description, folder, title, icon, color, config, template, publish, force }) => {
            requireChangeSet()
            if (!template && !html) return ok({ blocked: true, reason: 'Give the Lens either html or a Viewfinder template' })
            const errors = await lensBridge.validateLens(client(), template ? require('../../../core/viewfinder').readTemplate(template) : html)
            if (errors.length && !force) {
                return ok({ blocked: true, reason: `Lens validation failed (${errors.length}) — fix these and retry, or pass force:true:`, errors })
            }
            const saved = await lensStore.saveLens(SERVER, name, html, AGENT_USER, { publish: !!publish, description, folder, title, icon, color, config, template })
            logChange(publish ? 'LENS_PUBLISHED' : 'LENS_SAVED', 'lens', saved.name,
                { detail: `version ${saved.version}${description ? ` — ${description}` : ''}` })
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
            logChange('LENS_DELETED', 'lens', name)
            return ok(`Lens "${name}" deleted from ${SERVER}'s model.`)
        }
    )
}

module.exports = { register }