'use strict'

// ── Attribute definitions and values, held on Git (Part B.2) ─────────────────
// TM1 Git never writes attribute definitions or values: they are not model
// objects it exports. So the IDE keeps them itself, on one branch per server:
//
//   attrs-<server>   one file per model dimension
//
// A file holds the dimension's attribute definitions (name, type) and every
// element's values, sorted, so Git's compare shows real changes only. The branch
// is written by the IDE only; TM1 never pulls it and no release carries it.
//
// ATTRIBUTE VALUES ARE GIT CONTENT. James accepted this (sensitive attributes
// are rare); it is stated here and in the docs so it is never a surprise.
//
// What was verified on the lab (docs/ide/review/16_DEPLOY_AGAIN_DONE.md, check 5):
// on v11 an attribute value belongs to the element NAME, shared by every
// hierarchy, and a dimension has ONE attribute cube. Elements that exist only in
// an alternate hierarchy carry their own values in that same cube. So the file
// merges every hierarchy's elements, keyed by name. A v12 lab still needs the
// same check before per-hierarchy files are considered.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { git, authUrl, sanitize } = require('./git-repo')

const FILE_FOLDER = 'attributes'

const attrsBranch = (server) => `attrs-${server}`
const attrsPath = (dim) => `${FILE_FOLDER}/${dim}.json`

// Element/attribute names come from the model and can contain any character;
// MDX needs `]` doubled inside a member name.
const mdxName = (s) => String(s ?? '').replace(/\]/g, ']]')

function stableType(t) {
    const s = String(t ?? '').toLowerCase()
    if (s === 'numeric' || s === 'n') return 'Numeric'
    if (s === 'string' || s === 's') return 'String'
    if (s === 'consolidated' || s === 'c') return 'Consolidated'
    return String(t ?? '')
}

// The on-disk shape. Attributes are an ordered array (sorted by name), elements
// are sorted by name, and each element's values follow the attribute order (so
// two runs differ only when a value actually differs).
function serialiseAttributes(dimension, { attributes = [], elements = [] } = {}) {
    const attrs = [...attributes]
        .map(a => ({ Name: String(a.Name ?? a.name ?? ''), Type: stableType(a.Type ?? a.type) }))
        .filter(a => a.Name)
        .sort((a, b) => a.Name.localeCompare(b.Name))
    const names = attrs.map(a => a.Name)
    const els = [...elements]
        .map(e => {
            const source = e?.Values ?? e?.values ?? {}
            const values = {}
            for (const n of names) {
                const v = source[n]
                if (v !== undefined && v !== null && v !== '') values[n] = v
            }
            return { Name: String(e.Name ?? e.name ?? ''), Values: values }
        })
        .filter(e => e.Name)
        .sort((a, b) => a.Name.localeCompare(b.Name))
    return JSON.stringify({
        Dimension: String(dimension),
        Attributes: attrs,
        Elements: els,
    }, null, 2) + '\n'
}

function parseAttributes(text) {
    const doc = JSON.parse(text)
    return {
        dimension: doc.Dimension,
        attributes: Array.isArray(doc.Attributes) ? doc.Attributes : [],
        elements: Array.isArray(doc.Elements) ? doc.Elements : [],
    }
}

// One bulk MDX read per hierarchy: all attribute columns over every element.
// Never element by element (check 7 measured 179 ms – 1.5 s for the lab's
// largest dimension, so this is fast enough for every check and build).
async function readHierarchyAttributeValues(client, dim, hierarchy, attributes) {
    const names = (attributes ?? []).map(a => a.Name ?? a.name).filter(Boolean)
    const elements = (await client.getElements(dim, hierarchy)).map(e => e.Name ?? e.name).filter(Boolean)
    if (!names.length || !elements.length) return { elements, values: {} }

    const attrDim = `}ElementAttributes_${dim}`
    const cols = names.map(n => `[${mdxName(attrDim)}].[${mdxName(attrDim)}].[${mdxName(n)}]`).join(',')
    const mdx = `SELECT {${cols}} ON COLUMNS, {TM1SUBSETALL([${mdxName(dim)}].[${mdxName(hierarchy)}])} ON ROWS FROM [${mdxName(attrDim)}]`

    const result = await client.executeMDX(mdx, Math.max(50_000, elements.length * names.length + 100))
    const axes = [...(result.Axes ?? [])].sort((a, b) => (a.Ordinal ?? 0) - (b.Ordinal ?? 0))
    const colTuples = axes[0]?.Tuples ?? []
    const rowTuples = axes[1]?.Tuples ?? []
    const colName = (i) => colTuples[i]?.Members?.[0]?.Name ?? names[i] ?? null
    const rowName = (i) => rowTuples[i]?.Members?.[0]?.Name ?? null

    const values = {}
    const colCount = Math.max(1, colTuples.length || names.length)
    for (const cell of result.Cells ?? []) {
        const ordinal = Number(cell.Ordinal ?? 0)
        const r = Math.floor(ordinal / colCount)
        const c = ordinal % colCount
        const element = rowName(r)
        const attribute = colName(c)
        if (!element || !attribute) continue
        const v = cell.Value
        if (v === null || v === undefined || v === '') continue
        ;(values[element] ??= {})[attribute] = v
    }
    return { elements, values }
}

// One dimension's file content, read from the live server. Merges every
// hierarchy's elements by name (v11's shared per-element value).
async function readDimensionAttributes(client, dim, { hierarchies = null } = {}) {
    const attributes = await client.getElementAttributes(dim)
    const hs = hierarchies ?? await client.getHierarchies(dim).catch(() => [dim])
    const list = (hs?.length ? hs : [dim])
    const byName = new Map()
    for (const h of list) {
        let r
        try { r = await readHierarchyAttributeValues(client, dim, h, attributes) }
        catch { r = { elements: [], values: {} } }        // a hierarchy the account cannot read is skipped, not fatal
        for (const name of r.elements ?? []) if (!byName.has(name)) byName.set(name, {})
        for (const [name, vals] of Object.entries(r.values ?? {})) {
            byName.set(name, { ...(byName.get(name) ?? {}), ...vals })
        }
    }
    return {
        text: serialiseAttributes(dim, {
            attributes,
            elements: [...byName.entries()].map(([Name, Values]) => ({ Name, Values })),
        }),
        attributes,
    }
}

// Every model dimension's file, read in bulk. Control (`}`) objects are never
// model dimensions and are skipped.
async function collectAttrsFiles(client, { dimensions = null } = {}) {
    const dims = (dimensions ?? await client.getDimensions())
        .filter(n => n && !String(n).startsWith('}'))
        .sort((a, b) => a.localeCompare(b))
    const files = {}
    for (const dim of dims) {
        try {
            files[attrsPath(dim)] = (await readDimensionAttributes(client, dim)).text
        } catch {
            // Keep the file present so a removal is visible; an unreadable
            // dimension is reported by the caller's summary, not hidden.
            files[attrsPath(dim)] = serialiseAttributes(dim, { attributes: [], elements: [] })
        }
    }
    return files
}

function clearWorkTree(work) {
    for (const name of fs.readdirSync(work)) {
        if (name === '.git') continue
        fs.rmSync(path.join(work, name), { recursive: true, force: true })
    }
}

// Write a snapshot of attributes to attrs-<server>. Returns the commit (or the
// existing one when nothing changed). `files` is { 'attributes/Dim.json': text }.
async function writeAttrsBranch(server, { repoUrl, token, gitUser, files, message, by = null } = {}) {
    if (!repoUrl) return { ok: false, changed: false, error: `No repository for ${server}.` }
    if (!files || typeof files !== 'object') return { ok: false, changed: false, error: 'No attribute files to write.' }
    const branch = attrsBranch(server)
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1attrs-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token ?? ''))
        git(work, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        let existing = null
        try { existing = (git(work, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`).trim() || null) } catch { existing = null }

        if (existing) git(work, 'checkout', '-q', '-B', branch, existing)
        else git(work, 'checkout', '-q', '--orphan', branch)

        clearWorkTree(work)
        for (const [rel, text] of Object.entries(files)) {
            const p = path.join(work, rel)
            fs.mkdirSync(path.dirname(p), { recursive: true })
            fs.writeFileSync(p, String(text ?? ''))
        }
        git(work, 'add', '-A')
        const dirty = git(work, 'status', '--porcelain').trim()
        if (!dirty) {
            return { ok: true, changed: false, branch, commit: existing, note: 'attributes unchanged' }
        }
        git(work, '-c', `user.name=${gitUser ?? 'TM1 IDE'}`, '-c', `user.email=${require('./git-identity').email()}`,
            'commit', '-q', '-m', message || `Attributes of ${server}${by ? ` (${by})` : ''}`)
        const commit = git(work, 'rev-parse', 'HEAD').trim()
        if (existing) {
            git(work, 'push', '-q', `--force-with-lease=refs/heads/${branch}:${existing}`, 'origin', `HEAD:refs/heads/${branch}`)
        } else {
            git(work, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`)
        }
        return { ok: true, changed: true, branch, commit, previous: existing }
    } catch (e) {
        return { ok: false, changed: false, branch, error: sanitize(e.message, token) }
    } finally {
        fs.rmSync(work, { recursive: true, force: true })
    }
}

// Read one dimension's file as of a commit. Returns null when that commit has
// no file for it (the dimension did not exist then, or had no attributes).
function readAttrsAt(work, commit, dim) {
    try { return parseAttributes(git(work, 'show', `${commit}:${attrsPath(dim)}`)) }
    catch { return null }
}

// The current attrs-<server> head, or null when the branch does not exist yet.
function attrsHead(repoUrl, server, { token = null, gitUser = null } = {}) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1attrs-'))
    try {
        git(work, 'init', '-q')
        git(work, 'remote', 'add', 'origin', authUrl(repoUrl, gitUser, token ?? ''))
        git(work, 'fetch', '-q', 'origin', `+refs/heads/${attrsBranch(server)}:refs/remotes/origin/${attrsBranch(server)}`)
        return git(work, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${attrsBranch(server)}`).trim() || null
    } catch { return null }
    finally { fs.rmSync(work, { recursive: true, force: true }) }
}

module.exports = {
    attrsBranch, attrsPath, serialiseAttributes, parseAttributes,
    readHierarchyAttributeValues, readDimensionAttributes, collectAttrsFiles,
    writeAttrsBranch, readAttrsAt, attrsHead, mdxName,
}
