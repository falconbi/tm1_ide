'use strict'

function register(app, deps) {
    const { makeClient } = deps

app.get('/api/processes/search', async (req, res) => {
    try {
        const { server, q } = req.query
        if (!q || q.length < 2) return res.json({ results: [] })
        const client = makeClient(server, req.ideToken)
        const data = await client.get('Processes', {
            '$select': 'Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure',
        })
        const lower = q.toLowerCase()
        const sections = [
            { key: 'PrologProcedure',    label: 'Prolog'   },
            { key: 'MetadataProcedure',  label: 'Metadata' },
            { key: 'DataProcedure',      label: 'Data'     },
            { key: 'EpilogProcedure',    label: 'Epilog'   },
        ]
        const results = []
        for (const proc of (data.value ?? [])) {
            if (proc.Name.startsWith('}')) continue
            for (const { key, label } of sections) {
                const lines = (proc[key] ?? '').split('\n')
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(lower)) {
                        results.push({ process: proc.Name, section: label, line: i + 1, preview: lines[i].trim().slice(0, 150) })
                    }
                }
            }
        }
        res.json({ results })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/search/index', async (req, res) => {
    try {
        const client = makeClient(req.query.server, req.ideToken)
        const [cubes, processData] = await Promise.all([
            client.getAllCubesWithRules(),
            client.get('Processes', {
                '$select': 'Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure',
            }),
        ])
        const rulesResults = cubes.map(c => ({ name: c.Name, rules: c.Rules ?? '' }))
        const processResults = (processData.value ?? [])
            .filter(p => !p.Name.startsWith('}'))
            .map(p => ({
                name: p.Name,
                Prolog:   p.PrologProcedure ?? '',
                Metadata: p.MetaDataProcedure ?? p.MetadataProcedure ?? '',
                Data:     p.DataProcedure ?? '',
                Epilog:   p.EpilogProcedure ?? '',
            }))
        console.log('[api/search/index] request:', req.query.server, `${rulesResults.length} rules, ${processResults.length} processes`)
        res.json({ rules: rulesResults, processes: processResults })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})
}

module.exports = { register }
