// Obfuscate TM1 object names before they leave for a cloud AI provider, and
// restore them in the response. The model still sees the full structure — how
// many dimensions, which elements are leaf vs consolidated, their levels — so
// it can write valid MDX; only the names themselves are hidden behind opaque
// tokens (__O0__, __O1__, ...). The tokens are unlikely to collide with any
// real TM1 name (checked when generating) and survive round-trips through the
// model because they are short, stable and bracket-safe.

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Build a bidirectional name<->code map. `names` is the set of real TM1 object
// names that will appear in the prompt/context.
function makeMap(names) {
    const unique = [...new Set(names)].filter(n => typeof n === 'string' && n)
    const realToCode = new Map()
    const codeToReal = new Map()
    let i = 0
    for (const name of unique) {
        let code
        do { code = `__O${i++}__` } while (unique.includes(code))
        realToCode.set(name, code)
        codeToReal.set(code, name)
    }
    return { realToCode, codeToReal }
}

// Replace real names with their codes. Longest names first so a name never
// partially matches inside a longer one (e.g. "Budget" inside "Budget FX").
function obfuscateText(text, realToCode) {
    if (!text || realToCode.size === 0) return text
    const names = [...realToCode.keys()].sort((a, b) => b.length - a.length)
    let out = String(text)
    for (const name of names) {
        out = out.split(name).join(realToCode.get(name))
    }
    return out
}

// Replace codes back with the real names. Longest codes first.
function restoreText(text, codeToReal) {
    if (!text || codeToReal.size === 0) return text
    const codes = [...codeToReal.keys()].sort((a, b) => b.length - a.length)
    let out = String(text)
    for (const code of codes) {
        out = out.split(code).join(codeToReal.get(code))
    }
    return out
}

module.exports = { makeMap, obfuscateText, restoreText }