// Anthropic (Claude) messages API adapter.

module.exports = {
    name: 'anthropic',

    async complete({ apiKey, model, system, user, maxTokens }) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model,
                system,
                max_tokens: maxTokens,
                messages: [{ role: 'user', content: user }],
            }),
        })
        if (!r.ok) throw new Error(`AI provider HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
        const d = await r.json()
        const text = d.content?.[0]?.text
        if (typeof text !== 'string' || !text.trim()) throw new Error('AI provider returned no content')
        return text.trim()
    },
}