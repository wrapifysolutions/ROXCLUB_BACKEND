const { completeConfiguredChat } = require('./provider');

const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const RETIRED_MODELS = {
    'llama-3.3-70b-versatile': DEFAULT_MODEL,
    'llama-3.1-8b-instant': DEFAULT_MODEL,
};

function resolveModel(raw) {
    const model = String(raw || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    return RETIRED_MODELS[model] || model;
}

function groqStatus(env = process.env) {
    const apiKey = String(env.GROQ_API_KEY || '').trim();
    const baseUrl = String(env.GROQ_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = resolveModel(env.GROQ_MODEL);
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
        timeoutMs: options.timeoutMs || 10000,
        temperature: options.temperature ?? 0.45,
        maxTokens: options.maxTokens || 1024,
        fetchImpl: options.fetchImpl,
    });
}

module.exports = {
    DEFAULT_MODEL,
    groqStatus,
    shouldUseGroq,
    completeGroqChat,
};
