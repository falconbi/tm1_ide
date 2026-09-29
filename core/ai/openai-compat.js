// OpenAI-compatible chat completions adapter.
// One wire format covers OpenAI, Groq, Mistral, Grok, Together, Ollama, llama.cpp,
// vLLM, and every other server that speaks POST /chat/completions — the only
// differences are baseUrl, apiKey and model name, all supplied by the registry.

module.exports = {
    name: 'openai-compatible',

    async complete({ baseUrl, apiKey, model, system, user, maxTokens }) {
        const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user',   content: user },
                ],
                max_tokens: maxTokens,
            }),
        })
        if (!r.ok) throw new Error(`AI provider HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
        const d = await r.json()
        const text = d.choices?.[0]?.message?.content
        if (typeof text !== 'string' || !text.trim()) throw new Error('AI provider returned no content')
        return text.trim()
    },
}