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
    fs.writeFileSync(file, JSON.stringify(all, null, 2))
    return next
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

module.exports = { readPrefs, savePrefs, themeCss, MODES, FILE }
