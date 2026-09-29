// Google Gemini generateContent adapter.

module.exports = {
    name: 'gemini',

    async complete({ baseUrl, apiKey, model, system, user, maxTokens }) {
        const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: system }] },
                contents: [{ role: 'user', parts: [{ text: user }] }],
                generationConfig: { maxOutputTokens: maxTokens },
            }),
        })
        if (!r.ok) throw new Error(`AI provider HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
        const d = await r.json()
        const text = d.candidates?.[0]?.content?.parts?.map(p => p.text).join('')
        if (typeof text !== 'string' || !text.trim()) throw new Error('AI provider returned no content')
        return text.trim()
    },
}