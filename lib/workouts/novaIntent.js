const { hasKnownNovaExercises } = require('./novaParse');
const { questionText } = require('./novaVoice');

const WEEK_PLAN_RE =
    /\b((one|1|a)\s+week|weekly|7\s*days?|seven\s*days?|week[- ]long)\b/i;
const PLAN_NOUN_RE = /\b(plan|schedule|program|routine|split|training)\b/i;
const CREATE_VERB_RE = /\b(create|make|build|design|suggest|give|need|want|draft|write)\b/i;
const SESSION_CREATE_RE = /\b(create|make|build|save|log|add)\b/i;

function looksLikeWeekPlan(text) {
    const q = String(text || '').trim();
    if (!q) return false;
    if (WEEK_PLAN_RE.test(q) && PLAN_NOUN_RE.test(q)) return true;
    if (WEEK_PLAN_RE.test(q) && CREATE_VERB_RE.test(q)) return true;
    return /\b(training plan|workout plan|week plan)\b/i.test(q);
}

function looksLikeSessionCreate(text) {
    const q = String(text || '').trim();
    if (!q || looksLikeWeekPlan(q)) return false;
    if (!hasKnownNovaExercises(q)) return false;
    if (SESSION_CREATE_RE.test(q)) return true;
    return hasKnownNovaExercises(q) && /\b(and|,)\b/.test(q);
}

function detectNovaIntent(input = {}) {
    const explicit = String(input.intent || '').trim().toLowerCase();
    const q = questionText(input);

    if (looksLikeWeekPlan(q)) return 'plan';
    if (explicit === 'guide') return 'recommend';
    if (explicit === 'create') return 'create';
    if (['recommend', 'swap', 'explain', 'plan'].includes(explicit)) return explicit;
    if (input.workoutId && !q) return 'swap';
    if (looksLikeSessionCreate(q)) return 'create';
    return 'recommend';
}

module.exports = {
    looksLikeWeekPlan,
    looksLikeSessionCreate,
    detectNovaIntent,
};
