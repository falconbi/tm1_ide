'use strict'

const { z } = require('zod')
const path = require('path')
const { pathToFileURL } = require('url')

// Reuse the Period Builder's own generator and subset catalogue. The client module is
// ESM; load it lazily so the MCP server can stay CommonJS.
const LIB = path.join(__dirname, '../../../client/src/components/PeriodBuilder/lib')
const generatorUrl = pathToFileURL(path.join(LIB, 'generateTI.js')).href
const subsetsUrl = pathToFileURL(path.join(LIB, 'subsetDefs.js')).href

function register(server, { client, ok, logChange, requireChangeSet, lintTI }) {
    server.tool(
        'build_period_dimension',
        'Run the existing Period Builder generator and save its three TI processes: Build Period Dimension, Refresh Subsets and Rollover. ' +
        'This only creates the processes — it does not run them and does not change the period dimension. Requires an open change set.',
        {
            dimensionName: z.string().default('GBL Period').describe('Period dimension name, e.g. GBL Period'),
            fyStartMonth: z.number().int().min(1).max(12).default(4).describe('Fiscal year start month (1-12)'),
            firstFY: z.number().int().optional().describe('First fiscal year; defaults to current year - 1'),
            lastFY: z.number().int().optional().describe('Last fiscal year; defaults to firstFY + 9'),
            yearFormat: z.string().default('fy-end').describe('FY element format, e.g. fy-end, fy-start or calendar'),
            monthFormat: z.string().default('YYYY-MM').describe('Month element format'),
            captionFormat: z.string().default('Mon-YY').describe('Caption attribute format'),
            longNameFormat: z.string().default('Month YYYY').describe('Long Name attribute format'),
            includeTotal: z.boolean().default(false).describe('Include a Total <dimension> root'),
            includeCurrentPeriodAttr: z.boolean().default(false).describe('Include the Is Current Period attribute'),
            defaultCurrentPeriod: z.string().default('').describe('Default pCurrentPeriod for the generated build process, e.g. 2027-05'),
            selectedSubsets: z.array(z.string()).optional().describe('Subset ids from the Period Builder catalogue; defaults to the catalogue defaults'),
            subsetPrefix: z.string().default('').describe('Optional prefix for generated public subset names'),
        },
        async (args) => {
            requireChangeSet()
            const now = new Date().getFullYear()
            const firstFY = args.firstFY ?? now - 1
            const lastFY = args.lastFY ?? firstFY + 9
            if (lastFY < firstFY) return ok('lastFY must be greater than or equal to firstFY.')

            const gen = await import(generatorUrl)
            const { SUBSET_DEFS } = await import(subsetsUrl)
            const available = new Set(SUBSET_DEFS.map(s => s.id))
            const selected = args.selectedSubsets ?? SUBSET_DEFS.filter(s => s.defaultOn).map(s => s.id)
            const unknown = selected.filter(id => !available.has(id))
            if (unknown.length) return ok(`Unknown subset id(s): ${unknown.join(', ')}. Use one of: ${[...available].join(', ')}.`)

            const params = {
                dimensionName: args.dimensionName,
                fyStartMonth: args.fyStartMonth,
                firstFY,
                lastFY,
                yearFormat: args.yearFormat,
                monthFormat: args.monthFormat,
                captionFormat: args.captionFormat,
                longNameFormat: args.longNameFormat,
                includeTotal: args.includeTotal,
                includeCurrentPeriodAttr: args.includeCurrentPeriodAttr,
                defaultCurrentPeriod: args.defaultCurrentPeriod,
            }
            const build = gen.generateBuildDimensionSections(params, selected)
            const subsets = gen.generateRefreshSubsetsSections(params, selected, args.subsetPrefix)
            const rollover = gen.generateRolloverSections(params)
            const processes = [
                { name: `${args.dimensionName}.Build Period Dimension`, ...build },
                { name: `${args.dimensionName}.Refresh Subsets`, ...subsets },
                { name: `${args.dimensionName}.Rollover`, ...rollover },
            ]

            const warnings = []
            for (const proc of processes) {
                const lint = lintTI({ prolog: proc.prolog, metadata: proc.metadata, data: proc.data, epilog: proc.epilog })
                if (lint.errors.length) return ok({ refused: `TI lint found errors in ${proc.name}; nothing was saved.`, errors: lint.errors })
                if (lint.warnings.length) warnings.push({ process: proc.name, warnings: lint.warnings })
            }

            const c = client()
            const saved = []
            for (const proc of processes) {
                const exists = await c.getProcess(proc.name).then(() => true).catch(() => false)
                await c.createOrReplaceProcess(proc)
                logChange(exists ? 'PROCESS_SAVED' : 'PROCESS_CREATED', 'process', proc.name,
                    { after: { prolog: proc.prolog ?? '', metadata: proc.metadata ?? '', data: proc.data ?? '', epilog: proc.epilog ?? '' } })
                saved.push({ name: proc.name, existed: exists, parameters: proc.parameters ?? [] })
            }

            return ok({
                saved,
                dimensionName: args.dimensionName,
                firstFY,
                lastFY,
                selectedSubsets: selected,
                warnings,
                note: 'Generated and saved only. Open the Build Period Dimension process to review, then run Build first, then Refresh Subsets; Rollover is for the next period close.',
            })
        }
    )
}

module.exports = { register }
