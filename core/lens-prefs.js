'use strict'

// Each person's Lens app preferences (today: their theme), remembered per
// server + user on the Lens app's machine (data/lens-prefs.json, not in git) —
// so they follow the person to any computer, with no TM1 write access needed.
const fs   = require('fs')
const path = require('path')
const THEMES = require('../shared/lens-themes.json')

const FILE = path.join(__dirname, '..', 'data', 'lens-prefs.json')
const MODES = ['system', 'light', 'dark']
const DEFAULTS = { mode: 'system', palette: THEMES.default }

const load = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} } }
const keyOf = (server, user) => `${server}::${String(user).toLowerCase()}`

function readPrefs(server, user, file = FILE) {
    return Object.assign({}, DEFAULTS, load(file)[keyOf(server, user)] ?? {})
}

function savePrefs(server, user, prefs = {}, file = FILE) {
    const next = readPrefs(server, user, file)
    if (prefs.mode !== undefined) {
        if (!MODES.includes(prefs.mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`)
        next.mode = prefs.mode
    }
    if (prefs.palette !== undefined) {
        if (!THEMES.themes[prefs.palette]) throw new Error(`unknown theme "${prefs.palette}"`)
        next.palette = prefs.palette
    }
    const all = load(file)
    all[keyOf(server, user)] = next
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // Write beside the file, then rename: a crash or full disk never leaves a
    // half-written preferences file that loses everyone's themes.
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2))
    fs.renameSync(tmp, file)
    return next
}


// The keys themeCss actually reads. Every theme may rely on base for the rest.
const REQUIRED_THEME_KEYS = ['bg', 'panel', 'ink', 'soft', 'faint', 'rule', 'accent']

function validateThemes(catalog = THEMES) {
    const errors = []
    for (const mode of ['light', 'dark']) {
        const base = catalog?.base?.[mode]
        if (!base || typeof base !== 'object') errors.push(`base.${mode} is missing`)
        else for (const key of REQUIRED_THEME_KEYS) if (typeof base[key] !== 'string') errors.push(`base.${mode}.${key} is missing`)
    }
    const themes = catalog?.themes
    if (!themes || typeof themes !== 'object' || !Object.keys(themes).length) errors.push('themes is empty')
    else for (const [name, theme] of Object.entries(themes)) {
        if (!theme?.label || !String(theme.label).trim()) errors.push(`themes.${name}.label is missing`)
        for (const mode of ['light', 'dark']) {
            const effective = { ...(catalog.base?.[mode] ?? {}), ...(theme?.[mode] ?? {}) }
            for (const key of REQUIRED_THEME_KEYS) if (typeof effective[key] !== 'string') errors.push(`themes.${name}.${mode}.${key} is missing`)
        }
    }
    if (catalog?.default && !themes?.[catalog.default]) errors.push(`default theme "${catalog.default}" is not defined`)
    if (errors.length) throw new Error(`Lens themes are invalid: ${errors.join('; ')}`)
    return true
}

// The theme's colours for the Lens app's own pages, as CSS variables — for
// 'system', both sets with a prefers-color-scheme switch.
function themeCss({ mode, palette } = DEFAULTS) {
    const pick = isDark => Object.assign({}, THEMES.base[isDark ? 'dark' : 'light'], (THEMES.themes[palette] ?? THEMES.themes[THEMES.default])[isDark ? 'dark' : 'light'])
    const vars = (c, isDark) => `--app-bg:${c.bg};--app-panel:${c.panel};--app-ink:${c.ink};--app-soft:${c.soft};--app-faint:${c.faint};--app-rule:${c.rule};--app-accent:${c.accent};--app-head:${isDark ? c.panel : c.ink};--app-head-ink:${isDark ? c.ink : c.panel};color-scheme:${isDark ? 'dark' : 'light'}`
    if (mode === 'light') return `:root{${vars(pick(false), false)}}`
    if (mode === 'dark') return `:root{${vars(pick(true), true)}}`
    return `:root{${vars(pick(false), false)}}@media (prefers-color-scheme:dark){:root{${vars(pick(true), true)}}}`
}

module.exports = { readPrefs, savePrefs, themeCss, validateThemes, MODES, FILE }
