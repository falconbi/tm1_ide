'use strict'

// Parse a cube's rules into reviewable items: the target area, the measures it
// writes, the DB() cubes it reads, and the feeders. This is a static reading aid,
// not an evaluation order.

// Replace comment characters with spaces (same length) so offsets/line numbers survive.
function stripCommentsKeep(text) {
    let out = ''
    let i = 0, inStr = false
    while (i < text.length) {
        const ch = text[i]
        if (inStr) {
            out += ch
            if (ch === "'") {
                if (text[i + 1] === "'") { out += text[++i] }   // '' is an escaped quote
                else inStr = false
            }
            i++
            continue
        }
        if (ch === "'") { inStr = true; out += ch; i++; continue }
        if (ch === '#' || (ch === '/' && text[i + 1] === '/')) {
            while (i < text.length && text[i] !== '\n') { out += ' '; i++ }
            continue
        }
        out += ch; i++
    }
    return out
}

function splitStatements(text) {
    const out = []
    let start = 0, inStr = false
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch === "'") {
            if (inStr && text[i + 1] === "'") { i++; continue }
            inStr = !inStr
        }
        if (ch === ';' && !inStr) {
            out.push({ text: text.slice(start, i + 1), start })
            start = i + 1
        }
    }
    if (text.slice(start).trim()) out.push({ text: text.slice(start), start })
    return out
}

const splitList = s => {
    const out = []
    let cur = '', inStr = false
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]
        if (ch === "'") {
            if (inStr && s[i + 1] === "'") { cur += "''"; i++; continue }
            inStr = !inStr
        }
        if (ch === ',' && !inStr) { out.push(cur); cur = '' } else cur += ch
    }
    out.push(cur)
    return out.map(x => x.trim().replace(/^'|'$/g, '').replace(/''/g, "'").replace(/\]\]/g, ']')).filter(Boolean)
}

function bracketedElements(text) {
    const els = []
    // Element names may contain a literal ] encoded as ]] (same rule as shared/pivot/cellset.js).
    const re = /\[((?:[^\]]|\]\])*)\]/g
    let m
    while ((m = re.exec(text)) !== null) els.push(...splitList(m[1]))
    return [...new Set(els)]
}

function dbCubes(text) {
    const out = []
    const re = /\bDB\s*\(\s*'((?:[^']|'')*)'/gi
    let m
    while ((m = re.exec(text)) !== null) {
        const name = m[1].replace(/''/g, "'")
        if (!out.includes(name)) out.push(name)
    }
    return out
}

function parseRuleLens(rulesText, { measureElements = new Set() } = {}) {
    const raw = String(rulesText ?? '')
    const clean = stripCommentsKeep(raw)
    const feederAt = clean.search(/^\s*FEEDERS\s*;/im)
    const calcText = feederAt >= 0 ? clean.slice(0, feederAt) : clean
    const feederText = feederAt >= 0 ? clean.slice(feederAt).replace(/^\s*FEEDERS\s*;/i, '') : ''

    const lineOf = pos => 1 + (raw.slice(0, pos).match(/\n/g)?.length ?? 0)
    const cleanLine = pos => lineOf(pos)
    const items = []

    for (const st of splitStatements(calcText)) {
        const marker = st.text.match(/=\s*([NCS])\s*:/i)
        if (!marker) continue
        const eq = st.text.indexOf(marker[0])
        const area = st.text.slice(0, eq).trim()
        const expression = st.text.slice(eq + marker[0].length).trim().replace(/;\s*$/, '')
        const elements = bracketedElements(area)
        const measures = elements.filter(e => measureElements.has(e))
        items.push({
            type: 'calc', area, areaElements: elements, measures,
            expression, dbSources: dbCubes(expression), line: cleanLine(st.start),
        })
    }

    for (const st of splitStatements(feederText)) {
        const arrow = st.text.indexOf('=>')
        if (arrow < 0) continue
        const source = st.text.slice(0, arrow).trim()
        const target = st.text.slice(arrow + 2).trim().replace(/;\s*$/, '')
        const sourceEls = bracketedElements(source)
        const targetEls = bracketedElements(target)
        const targetCubes = dbCubes(target)
        items.push({
            type: 'feeder', area: source, areaElements: sourceEls,
            measures: sourceEls.filter(e => measureElements.has(e)),
            expression: target, dbSources: [], targetCubes, line: cleanLine(st.start),
        })
    }

    const cubesRead = [...new Set(items.flatMap(i => i.dbSources))]
    return {
        items,
        summary: {
            calc: items.filter(i => i.type === 'calc').length,
            feeders: items.filter(i => i.type === 'feeder').length,
            cubesRead,
            measures: [...new Set(items.flatMap(i => i.measures))],
        },
    }
}

module.exports = { parseRuleLens, stripCommentsKeep, splitStatements }
