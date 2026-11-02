const DEFAULT_TIMEOUT_MS = 8000;

function providerStatus(env = process.env) {
    const apiKey = String(env.OPENAI_API_KEY || env.ARENA_AI_API_KEY || '').trim();
    const baseUrl = String(env.OPENAI_BASE_URL || env.ARENA_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = String(env.OPENAI_MODEL || env.ARENA_AI_MODEL || 'gpt-4o-mini').trim();
    if (!apiKey) {
        return {
            available: false,
            provider: 'none',
            model: null,
            reason: 'AI_PROVIDER_NOT_CONFIGURED',
            message: 'No Arena AI provider is configured. Set OPENAI_API_KEY to enable model explanations.',
        };
    }
    return {
        available: true,
        provider: 'openai-compatible',
        model,
        baseUrl,
        reason: null,
        message: null,
        apiKey,
    };
}

async function completeChat({ system, user, timeoutMs = DEFAULT_TIMEOUT_MS, env = process.env, fetchImpl }) {
    const status = providerStatus(env);
    if (!status.available) {
        const error = new Error(status.message);
        error.code = status.reason;
        error.status = 503;
        throw error;
    }
    const fetchFn = fetchImpl || fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchFn(`${status.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${status.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: status.model,
                temperature: 0.2,
                max_tokens: 400,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
            }),
            signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload?.error?.message || 'AI provider request failed');
            error.status = response.status >= 500 ? 502 : 502;
            error.code = response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_FAILED';
            error.retryable = response.status === 429 || response.status >= 500;
            throw error;
        }
        const text = String(payload?.choices?.[0]?.message?.content || '').trim();
        if (!text) {
            const error = new Error('AI provider returned an empty explanation');
            error.code = 'AI_EMPTY_RESPONSE';
            error.status = 502;
            throw error;
        }
        return { text, model: status.model, provider: status.provider };
    } finally {
        clearTimeout(timer);
    }
}

async function completeChatWithRetry(options) {
    try {
        return await completeChat(options);
    } catch (error) {
        if (error.retryable) return completeChat(options);
        throw error;
    }
}

module.exports = {
    providerStatus,
    completeChat,
    completeChatWithRetry,
};
