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

    const mdxRe = /mdx\s*:\s*'((?:[^'\\]|\\.)*)'/g
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

module.exports = { execMDX, readCell, getMeta, validateLens, buildStarterLens, validateMdx }