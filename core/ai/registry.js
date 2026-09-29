// Provider-agnostic AI text completion — the single door the IDE's AI features
// (MDX/subset generation) go through. Mirrors the connection-adapter pattern in
// core/adapters: pick a provider from config, normalise the request to
// { system, user, maxTokens }, get plain text back. No single vendor required.
//
// Configure in .env — AI is DISABLED unless a provider AND key are set:
//   AI_PROVIDER=anthropic | openai-compatible | gemini
//   AI_API_KEY=<key>
//   AI_MODEL=<model name>            (optional; sensible default per provider)
//   AI_BASE_URL=<api base url>       (optional; openai-compatible & gemini only)
//
// openai-compatible with AI_BASE_URL=http://localhost:11434/v1 + a dummy key
// talks to a local Ollama; point AI_BASE_URL at llama.cpp's OpenAI endpoint for
// a fully local model. Everything that speaks /chat/completions just works.

const adapters = {
    'anthropic':         require('./anthropic'),
    'openai-compatible': require('./openai-compat'),
    'gemini':            require('./gemini'),
}

const DEFAULTS = {
    'anthropic':         { baseUrl: 'https://api.anthropic.com',                        model: 'claude-sonnet-5' },
    'openai-compatible': { baseUrl: 'https://api.openai.com/v1',                        model: 'gpt-4o-mini' },
    'gemini':            { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' },
}

function config() {
    const provider = (process.env.AI_PROVIDER || '').trim().toLowerCase()
    const adapter  = adapters[provider]
    // Legacy fallback: no AI_PROVIDER set but an ANTHROPIC_API_KEY is -> Claude.
    const apiKey = process.env.AI_API_KEY || (!provider && process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY : '')
    const effectiveProvider = provider || (apiKey ? 'anthropic' : '')
    const effAdapter = adapters[effectiveProvider]
    if (!effAdapter || !apiKey) return null
    const def = DEFAULTS[effectiveProvider]
    return {
        adapter: effAdapter,
        apiKey,
        baseUrl: process.env.AI_BASE_URL || def.baseUrl,
        model:   process.env.AI_MODEL    || def.model,
    }
}

function isConfigured() { return !!config() }

// Name obfuscation is opt-in: set AI_OBFUSCATE_NAMES=true and every TM1 object
// name sent to the provider is swapped for an opaque token (see ./obfuscate)
// before the request leaves, then restored in the response. Enabled value
// accepts true/1/yes.
function shouldObfuscate() {
    return ['1', 'true', 'yes'].includes(String(process.env.AI_OBFUSCATE_NAMES || '').toLowerCase())
}

async function complete({ system, user, maxTokens = 1024, label = 'ai', obfuscated = false }) {
    const c = config()
    if (!c) throw new Error('AI not configured — set AI_PROVIDER and AI_API_KEY in .env')
    const t0 = Date.now()
    try {
        const out = await c.adapter.complete({ baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, system, user, maxTokens })
        audit({ label, provider: c.adapter.name, model: c.model, obfuscated, inChars: (user ?? '').length, outChars: out.length, ms: Date.now() - t0, ok: true })
        return out
    } catch (e) {
        audit({ label, provider: c.adapter.name, model: c.model, obfuscated, inChars: (user ?? '').length, ms: Date.now() - t0, ok: false, error: e.message })
        throw e
    }
}

// Audit trail for AI calls — metadata only (provider, model, sizes, timing,
// obfuscation state, outcome). Never the prompt or the response content, and
// never the TM1 object names, so this log is safe even when obfuscation is off.
function audit(entry) {
    console.log('[ai]', JSON.stringify({ t: new Date().toISOString(), ...entry }))
}

module.exports = { complete, isConfigured, shouldObfuscate }