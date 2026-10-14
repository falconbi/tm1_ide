'use strict'

function escMember(name) {
    return `[${String(name).replace(/]/g, ']]')}]`
}

function validateMdx(mdx) {
    if (typeof mdx !== 'string' || !mdx.trim()) throw new Error('mdx is required')
    if (mdx.length > 20000) throw new Error('mdx too long')
    return mdx.trim()
}

async function execMDX(client, mdx) {
    return client.executeMDX(validateMdx(mdx), 20000)
}

async function readCell(client, cube, coordinates) {
    if (!cube) throw new Error('cube is required')
    if (!coordinates || typeof coordinates !== 'object' || Array.isArray(coordinates)) {
        throw new Error('coordinates must be an object of { dimension: element }')
    }
    const cubeMeta = await client.getCube(cube)
    if (!cubeMeta) throw new Error(`Cube "${cube}" not found (or no access) on this server — check the active server`)
    const dims = (cubeMeta.Dimensions ?? []).map(d => d.Name)
    const missing = dims.filter(d => coordinates[d] === undefined || coordinates[d] === null)
    if (missing.length) throw new Error(`missing coordinates for: ${missing.join(', ')}`)
    const escCube = cube.replace(/]/g, ']]')
    // 3-part member [Dim].[Hier].[Elem]; tuple form (a,b,c) — this TM1 version
    // rejects '*' / CrossJoin() in a single-cell read, the tuple does not.
    const tuple = dim => `[${dim.replace(/]/g, ']]')}].${escMember(dim)}.${escMember(coordinates[dim])}`
    let mdx
    if (dims.length === 1) {
        mdx = `SELECT {${tuple(dims[0])}} ON 0 FROM [${escCube}]`
    } else {
        mdx = `SELECT {${tuple(dims[0])}} ON 0, {(${dims.slice(1).map(tuple).join(',')})} ON 1 FROM [${escCube}]`
    }
    const r = await client.executeMDX(mdx, 100)
    return r.Cells?.[0]?.Value ?? null
}

async function getMeta(client, cube) {
    const [cubes, dimensions] = await Promise.all([
        client.getModelCubes().catch(() => []),
        client.getModelDimensions().catch(() => []),
    ])
    const meta = { cubes, dimensions }
    if (cube) {
        const dims = ((await client.getCube(cube)).Dimensions ?? []).map(d => d.Name)
        meta.cubeDims = dims
        const elements = {}
        for (const dim of dims) {
            try {
                const el = await client.getElements(dim)
                elements[dim] = el.map(e => e.Name).slice(0, 2000)
            } catch { elements[dim] = [] }
        }
        meta.elements = elements
    }
    return meta
}

// Save-time validation gate. Parsing bridge calls out of AI-written JS is
// best-effort and will miss things, so every query we DO find is executed once
// against the live model — a bad cube/dim/member/MDX fails here, not at runtime.
async function validateLens(client, html) {
    const errors = []
    const seenMdx = new Set()

    // Only complete literals: a string that is followed by `+` is the start of a
    // query built in pieces at runtime — running that fragment would fail falsely.
    const mdxRe = /mdx\s*:\s*'((?:[^'\\]|\\.)*)'(?!\s*\+)/g
    let m
    while ((m = mdxRe.exec(String(html))) !== null) {
        const mdx = m[1].replace(/\\'/g, "'").trim()
        if (!mdx || seenMdx.has(mdx)) continue
        seenMdx.add(mdx)
        try {
            await client.executeMDX(mdx, 10)
        } catch (e) {
            const detail = e.response?.data?.error?.message ?? e.message
            errors.push(`MDX failed: ${detail} — ${mdx.slice(0, 120)}`)
        }
    }

    let cubes = []
    try { cubes = await client.getModelCubes() } catch {}
    if (cubes.length) {
        const known = new Set(cubes.map(c => String(c).toLowerCase()))
        const cubeRe = /cube\s*:\s*'([^']+)'/g
        while ((m = cubeRe.exec(String(html))) !== null) {
            if (!known.has(m[1].toLowerCase())) errors.push(`Unknown cube: ${m[1]}`)
        }
    }

    return errors
}

// A hand-rolled starter lens so the editor works with NO AI configured. If a cube
// context was given, the starter is a live crosstab bound to that cube — genuinely
// useful, not a stub. Users hand-edit it in Monaco; the AI is an accelerator, not
// a requirement.
function buildStarterLens(meta, cube) {
    const dims = (meta?.cubeDims ?? []).filter(Boolean)
    const escName = n => String(n).replace(/]/g, ']]')

    if (cube && dims.length >= 2) {
        const first = dims[0]
        const last = dims[dims.length - 1]
        const mdx = `SELECT {[${escName(last)}].[${escName(last)}].Members} ON 0, {[${escName(first)}].[${escName(first)}].Members} ON 1 FROM [${escName(cube)}]`
        return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; padding: 24px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.sub { color: #64748b; margin: 0 0 16px; }
  button { border: 1px solid #cbd5e1; background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: right; }
  th { background: #f1f5f9; }
  td.empty { color: #94a3b8; }
  .err { color: #b91c1c; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escName(cube)}</h1>
    <p class="sub">Starter lens for ${escName(cube)} — ${dims.map(escName).join(' × ')}. Hand-edit this in the Code tab.</p>
    <button onclick="load()">Refresh</button>
    <div id="grid"><p>Loading…</p></div>
  </div>
  <script>
    var cols0 = [], rows1 = []
    var draw = function (res) {
      cols0 = (res.Axes[0] && res.Axes[0].Tuples || []).map(function (t) { return t.Members.map(function (m) { return m.Name }).join(' / ') })
      rows1 = (res.Axes[1] && res.Axes[1].Tuples || []).map(function (t) { return t.Members.map(function (m) { return m.Name }).join(' / ') })
      var cells = {}
      res.Cells.forEach(function (c) { cells[c.Ordinal] = c.Value })
      var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
      var h = '<table><thead><tr><th></th>'
      cols0.forEach(function (c) { h += '<th>' + esc(c) + '</th>' })
      h += '</tr></thead><tbody>'
      rows1.forEach(function (r, ri) {
        h += '<tr><th>' + esc(r) + '</th>'
        cols0.forEach(function (_, ci) {
          var v = cells[ri * cols0.length + ci]
          h += '<td class="' + (v === null ? 'empty' : '') + '">' + (v === null ? '—' : (typeof v === 'number' ? Number(v).toLocaleString() : esc(v))) + '</td>'
        })
        h += '</tr>'
      })
      h += '</tbody></table>'
      document.getElementById('grid').innerHTML = h
    }
    var load = function () {
      document.getElementById('grid').innerHTML = '<p>Loading…</p>'
      window.lensBridge.call('execMDX', { mdx: ${JSON.stringify(mdx)} }).then(draw).catch(function (e) {
        document.getElementById('grid').innerHTML = '<p class="err">Bridge error: ' + e.message + '</p>'
      })
    }
    load()
  </script>
</body>
</html>`
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; padding: 24px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 12px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.sub { color: #64748b; margin: 0 0 16px; }
  ul { margin: 0; padding-left: 20px; }
  li { margin-bottom: 4px; cursor: pointer; }
</style>
</head>
<body>
  <div class="card">
    <h1>New Lens</h1>
    <p class="sub">Starter lens. Pick a cube context above and click Generate again, or hand-edit this HTML in the Code tab using the lensBridge API.</p>
    <ul id="cubes"><li>Loading cubes…</li></ul>
  </div>
  <script>
    window.lensBridge.call('getMeta', {}).then(function (meta) {
      var ul = document.getElementById('cubes')
      ul.innerHTML = ''
      ;(meta.cubes || []).forEach(function (c) {
        var li = document.createElement('li')
        li.textContent = c
        ul.appendChild(li)
      })
    }).catch(function (e) {
      document.getElementById('cubes').innerHTML = '<li class="err" style="color:#b91c1c">Bridge error: ' + e.message + '</li>'
    })
  </script>
</body>
</html>`
}

// ── Write-back ────────────────────────────────────────────────────────────────
// A Lens may change only the cubes it declares in its own HTML:
//   <meta name="lens-writes" content="Income Statement, Other Cube">
// The host reads the SAVED Lens (by the name the host opened — never a name
// from the message), so a Lens can't widen its own rights at runtime.
const MAX_WRITE_CELLS = 500

function declaredWriteCubes(html) { return metaList(html, 'lens-writes') }

// <meta name="<name>" content="A, B"> → ['A', 'B'] (all such tags, any attribute order)
function metaList(html, name) {
    const out = []
    const named = new RegExp(`\\bname\\s*=\\s*["']${name}["']`, 'i')
    for (const tag of String(html ?? '').match(/<meta\b[^>]*>/gi) ?? []) {
        if (!named.test(tag)) continue
        const m = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)
        if (m) out.push(...m[1].split(',').map(x => x.trim()).filter(Boolean))
    }
    return out
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

// TM1's write refusals are internal codes (CubeCellWriteStatus…); say what they
// mean to the person typing, keeping the code for whoever administers security.
function plainWriteRefusal(code, cube) {
    const why = [
        [/NoWriteAccess|WriteAccess|ObjectSecurity|SecurityNo/i, `You don't have permission to change these cells in ${cube} — ask your TM1 administrator for write access`],
        [/NoReservation/i, `Someone else is editing these cells, or you haven't started editing — TM1 needs a data reservation to change ${cube}`],
        [/ElementIsLocked|Locked|Reserved/i, 'Some of these cells are locked or reserved by someone else'],
        [/RuleApplies|Consolidat/i, 'Some of these cells are calculated by TM1'],
    ].find(([re]) => re.test(code))
    return why ? `${why[1]} (TM1: ${code}).` : `TM1 refused the save: ${code}.`
}

// Write numbers as the signed-in user. Every cell is checked first: full
// coordinates, a plain number, not calculated (rule or consolidation), and —
// when the Lens sends what it showed (`expect`) — not changed by someone else
// since. Any failure refuses the WHOLE save; nothing is half-written. TM1
// security still decides the rest (a cell the user can't write is refused by
// TM1 itself).
async function writeCells(client, { cube, cells, allowedCubes = [] } = {}) {
    if (!cube || typeof cube !== 'string') throw new Error('cube is required')
    if (!allowedCubes.some(c => c.toLowerCase() === cube.toLowerCase())) {
        throw new Error(`This Lens hasn't declared that it changes "${cube}" — add <meta name="lens-writes" content="${cube}"> to it and save it`)
    }
    if (!Array.isArray(cells) || !cells.length) throw new Error('nothing to save')
    if (cells.length > MAX_WRITE_CELLS) throw new Error(`too many cells in one save (${cells.length}; the limit is ${MAX_WRITE_CELLS})`)
    const cubeMeta = await client.getCube(cube)
    if (!cubeMeta) throw new Error(`Cube "${cube}" not found (or no access)`)
    const dims = (cubeMeta.Dimensions ?? []).map(d => d.Name)

    const seen = new Set()
    const norm = cells.map((c, i) => {
        const at = `cell ${i + 1}`
        const coords = c?.coordinates
        if (!coords || typeof coords !== 'object' || Array.isArray(coords)) throw new Error(`${at}: coordinates must be { dimension: element }`)
        const missing = dims.filter(d => coords[d] === undefined || coords[d] === null || coords[d] === '')
        if (missing.length) throw new Error(`${at}: missing ${missing.join(', ')}`)
        const extra = Object.keys(coords).filter(k => !dims.includes(k))
        if (extra.length) throw new Error(`${at}: "${extra[0]}" is not a dimension of ${cube}`)
        if (typeof c.value !== 'number' || !Number.isFinite(c.value)) throw new Error(`${at}: the value must be a number`)
        if ('expect' in c && c.expect !== null && (typeof c.expect !== 'number' || !Number.isFinite(c.expect))) throw new Error(`${at}: expect must be a number`)
        const elems = dims.map(d => String(coords[d]))
        const key = elems.join('\u0001').toLowerCase()
        if (seen.has(key)) throw new Error(`${at}: the same cell appears twice`)
        seen.add(key)
        return { elems, value: c.value, check: 'expect' in c, expect: num(c.expect) }
    })

    // Read every target cell as the user: its value now, and whether TM1
    // calculates it.
    const member = (d, e) => `${escMember(d)}.${escMember(d)}.${escMember(e)}`
    const tuple = n => '(' + n.elems.map((e, k) => member(dims[k], e)).join(',') + ')'
    const r = await client.post('ExecuteMDX?$expand=Cells($select=Ordinal,Value,RuleDerived,Consolidated)',
        { MDX: `SELECT {${norm.map(tuple).join(',')}} ON 0 FROM ${escMember(cube)}` })
    const cs = r?.data ?? r
    if (cs?.ID) { try { await client.delete(`Cellsets('${cs.ID}')`) } catch { /* cleanup only */ } }
    const byOrd = new Map((cs?.Cells ?? []).map(c => [c.Ordinal, c]))
    const label = n => n.elems.join(' · ')

    const calc = norm.filter((n, i) => byOrd.get(i)?.RuleDerived || byOrd.get(i)?.Consolidated)
    if (calc.length) {
        throw new Error(`${calc.length} cell${calc.length > 1 ? 's are' : ' is'} calculated by TM1 and can't be typed into (${calc.slice(0, 3).map(label).join('; ')}${calc.length > 3 ? '; …' : ''}). Nothing was saved.`)
    }
    const conflicts = norm.map((n, i) => ({ n, now: num(byOrd.get(i)?.Value) }))
        .filter(x => x.n.check && Math.abs(x.now - x.n.expect) > 1e-9)
    if (conflicts.length) {
        const e = new Error(`${conflicts.length} cell${conflicts.length > 1 ? 's were' : ' was'} changed by someone else since this screen loaded (${conflicts.slice(0, 3).map(x => label(x.n)).join('; ')}${conflicts.length > 3 ? '; …' : ''}). Nothing was saved — reload to see the new numbers.`)
        e.conflicts = conflicts.map(x => ({ coordinates: Object.fromEntries(dims.map((d, k) => [d, x.n.elems[k]])), now: x.now, expected: x.n.expect }))
        throw e
    }

    try {
        await client.updateCells(cube, norm.map(n => ({ dimElemPairs: dims.map((d, k) => ({ dim: d, element: n.elems[k] })), value: n.value })))
    } catch (e) {
        const code = String(e.response?.data?.error?.message ?? e.message)
        throw new Error(`${plainWriteRefusal(code, cube)} Nothing was saved.`)
    }
    return {
        written: norm.length,
        changes: norm.map((n, i) => ({ coordinates: Object.fromEntries(dims.map((d, k) => [d, n.elems[k]])), old: num(byOrd.get(i)?.Value), value: n.value })),
    }
}

// ── Action buttons: run a TI process ──────────────────────────────────────────
// A Lens may run only the processes it declares:
//   <meta name="lens-runs" content="Process A, Process B">
// read from the SAVED Lens, like lens-writes. Parameters must be ones the
// process has: text for a String parameter, a number for a Numeric one.
// A running process is not limited by the caller's cell security, so it must
// check the caller itself; it leaves its outcome for the caller in the
// 'Lens Messages' cube (}Clients × Process / Message / Result / Since /
// Detail), because only admins can read TM1's error logs. Result is a short
// machine-readable outcome (e.g. free / mine / taken) a Lens can act on; Since
// is a UTC time (yyyy-mm-ddThh:mm:ssZ) the Lens shows in the viewer's own time
// zone; Detail is any extra machine-readable fact (e.g. a reservation mode).
const MSG_CUBE = 'Lens Messages'

function declaredRunProcesses(html) { return metaList(html, 'lens-runs') }

// What a saved Lens may change and run: its <meta> tags plus its config's
// writes / runs lists — so reusable code can be pointed at another cube by its
// config (saved, versioned and governed exactly like the code).
function lensWrites(doc) { return [...new Set([...declaredWriteCubes(doc?.html), ...listOf(doc?.config?.writes)])] }
function lensRuns(doc) { return [...new Set([...declaredRunProcesses(doc?.html), ...listOf(doc?.config?.runs)])] }
const listOf = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [])

async function readLensMessage(client, user, process) {
    try {
        const r = await client.executeMDX(`SELECT {[Lens Message].[Lens Message].Members} ON 0, {[}Clients].[}Clients].${escMember(user)}} ON 1 FROM ${escMember(MSG_CUBE)}`, 10)
        const names = (r.Axes?.[0]?.Tuples ?? []).map(t => t.Members?.[0]?.Name)
        const at = name => (names.includes(name) ? r.Cells?.[names.indexOf(name)]?.Value ?? '' : '')
        // Only a message this process left — never a stale one from another.
        const empty = { message: '', result: '', since: '', detail: '' }
        if (String(at('Process')).toLowerCase() !== String(process).toLowerCase()) return empty
        return { message: String(at('Message') || ''), result: String(at('Result') || ''), since: String(at('Since') || ''), detail: String(at('Detail') || '') }
    } catch { return { message: '', result: '', since: '', detail: '' } }  // no Lens Messages cube, or the user can't read it
}

async function runProcess(client, { process, params = {}, allowedProcesses = [], user } = {}) {
    if (!process || typeof process !== 'string') throw new Error('process is required')
    if (!allowedProcesses.some(p => p.toLowerCase() === process.toLowerCase())) {
        throw new Error(`This Lens hasn't declared that it runs "${process}" — add <meta name="lens-runs" content="${process}"> to it and save it`)
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('params must be an object of { parameter: value }')
    const def = await client.getProcess(process).catch(() => null)
    if (!def) throw new Error(`Process "${process}" not found, or you are not allowed to run it`)
    const types = new Map((def.Parameters ?? []).map(p => [p.Name.toLowerCase(), p]))
    const list = Object.entries(params).map(([name, value]) => {
        const p = types.get(name.toLowerCase())
        if (!p) throw new Error(`"${process}" has no parameter "${name}"`)
        if (p.Type === 'Numeric') {
            if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${p.Name} must be a number`)
        } else if (typeof value !== 'string' || value.length > 1000) {
            throw new Error(`${p.Name} must be text (at most 1000 characters)`)
        }
        return { Name: p.Name, Value: String(value) }
    })
    const started = Date.now()
    const r = await client.executeProcess(process, list)
    const status = r?.ProcessExecuteStatusCode ?? 'Unknown'
    const seconds = Math.round((Date.now() - started) / 100) / 10
    const { message, result, since, detail } = user ? await readLensMessage(client, user, process) : { message: '', result: '', since: '', detail: '' }
    if (status !== 'CompletedSuccessfully') {
        const e = new Error(message || `"${process}" did not complete (${status}) — your TM1 administrator can see why in its error log`)
        e.status = status
        throw e
    }
    return { status, seconds, message, result, since, detail }
}

module.exports = { execMDX, readCell, getMeta, validateLens, buildStarterLens, validateMdx, declaredWriteCubes, writeCells, MAX_WRITE_CELLS, declaredRunProcesses, runProcess, lensWrites, lensRuns }