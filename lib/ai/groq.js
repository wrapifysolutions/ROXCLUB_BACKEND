const { completeConfiguredChat } = require('./provider');

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

function groqStatus(env = process.env) {
    const apiKey = String(env.GROQ_API_KEY || '').trim();
    const baseUrl = String(env.GROQ_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = String(env.GROQ_MODEL || DEFAULT_MODEL).trim();
    if (!apiKey) {
        return {
            available: false,
            provider: 'none',
            model: null,
            reason: 'GROQ_NOT_CONFIGURED',
            message: 'NOVA chat is catalog-only until GROQ_API_KEY is set.',
        };
    }
    return {
        available: true,
        provider: 'groq',
        model,
        baseUrl,
        reason: null,
        message: null,
        apiKey,
    };
}

function shouldUseGroq(options = {}, env = process.env) {
    if (options.completeChat) return true;
    if (options.skipVoice) return false;
    if (process.env.NODE_TEST_CONTEXT && process.env.GROQ_IN_TESTS !== 'true') return false;
    return groqStatus(options.env || env).available;
}

async function completeGroqChat(options = {}) {
    const env = options.env || process.env;
    if (typeof options.completeChat === 'function') {
        return options.completeChat(options);
    }
    return completeConfiguredChat(groqStatus(env), {
        system: options.system,
        user: options.user,
        messages: options.messages,
        timeoutMs: options.timeoutMs || 6000,
        temperature: options.temperature ?? 0.45,
        maxTokens: options.maxTokens || 280,
        fetchImpl: options.fetchImpl,
    });
}

module.exports = {
    DEFAULT_MODEL,
    groqStatus,
    shouldUseGroq,
    completeGroqChat,
};
