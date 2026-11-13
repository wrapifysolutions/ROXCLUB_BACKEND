const { groqStatus, shouldUseGroq, completeGroqChat } = require('../ai/groq');

const NOVA_SYSTEM_PROMPT = [
    'You are NOVA, the RoxClub training guide.',
    'Speak like a warm, human coach: encouraging, clear, and specific.',
    'Always stay positive. Never shame, scold, or tell the athlete they failed, cannot, or are behind.',
    'Guide training and workouts only. If the question is general, kindly steer it back to a next training step.',
    'Use ONLY the JSON facts. Do not invent workouts, exercises, distances, HYROX official formulas, XP, DNA, or medical advice.',
    'Name a workout only if that exact title appears in facts.workouts.',
    'If facts.medicalBoundary is set, do not diagnose. Offer the approved recovery option and remind them they may still train.',
    '2 to 4 short sentences. Second person. No markdown. No bullet lists of invented moves.',
].join(' ');

const NEGATIVE_RE =
    /\b(can't|cannot|failed|failure|you're not|you are not|give up|worst|too late|never be|no point|don't bother|do not bother)\b/i;
const INVENTED_OFFICIAL_RE = /\b(official hyrox formula|hyrox world championship qualifying standard|secret race formula)\b/i;

function looksLikeQuestion(text) {
    const q = String(text || '').trim();
    if (!q) return false;
    if (q.includes('?')) return true;
    return /^(what|why|how|when|where|who|which|can|could|should|would|is|are|do|does|did|am|may|help|please|tell|explain|guide|i\b|i'm|im\s|my\s)/i.test(
        q
    );
}

function recentUserNotes(input = {}) {
    const messages = Array.isArray(input.messages) ? input.messages : [];
    return messages
        .filter((row) => row && row.role === 'user' && row.content)
        .slice(-3)
        .map((row) => String(row.content).trim().slice(0, 200));
}

function questionText(input = {}) {
    const direct = String(input.q || '').trim();
    if (direct) return direct.slice(0, 500);
    const notes = recentUserNotes(input);
    return notes.length ? notes[notes.length - 1] : '';
}

function workoutFacts(result = {}) {
    const rows = [];
    if (result.workout?.title) {
        rows.push({
            id: result.workout.id || null,
            title: result.workout.title,
            durationMin: result.workout.durationMin || null,
            difficulty: result.workout.difficulty || null,
            type: result.workout.type || null,
        });
    }
    for (const item of result.workouts || []) {
        if (!item?.title) continue;
        if (rows.some((row) => row.id && item.id && row.id === item.id)) continue;
        rows.push({
            id: item.id || null,
            title: item.title,
            durationMin: item.durationMin || null,
            difficulty: item.difficulty || null,
            type: item.type || null,
        });
    }
    return rows.slice(0, 6);
}

function allowedTitles(result) {
    return new Set(workoutFacts(result).map((row) => String(row.title).toLowerCase()));
}

function catalogReply(result = {}, input = {}) {
    const q = questionText(input);
    const first = workoutFacts(result)[0];
    const medical = result.classification?.medicalBoundary;

    if (medical) {
        return first
            ? `Thanks for looking after yourself today. ${first.title} is an approved recovery-friendly option in your library, and you can still train if you want to.`
            : 'Thanks for looking after yourself today. An approved recovery session is waiting in your library, and you can still train.';
    }

    if (result.intent === 'create' && first) {
        return `Nice — that session is mapped from your own text. ${first.title} is ready to review and start whenever you are. You've got this.`;
    }

    if (result.intent === 'explain' && first) {
        return `${first.title} is an approved RoxClub session. It is a strong, clear piece of work — start when you are ready.`;
    }

    if (result.intent === 'swap' && first) {
        return `Great call checking options. ${first.title} is an approved alternative with a similar stimulus, and you can still train the original.`;
    }

    if (first && looksLikeQuestion(q)) {
        return `Great question. A strong next step is ${first.title} (${first.durationMin} min) from your RoxClub library. Start when you feel ready — every session counts.`;
    }

    if (first) {
        return `${first.title} is a solid pick from your approved library. You are in a good place to train — start whenever you are ready.`;
    }

    return 'You are in a good place to train. Open your RoxClub library, pick a session that fits today, and start when you are ready.';
}

function sanitizeReply(text, result) {
    const cleaned = String(text || '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 700);
    if (!cleaned || NEGATIVE_RE.test(cleaned) || INVENTED_OFFICIAL_RE.test(cleaned)) return null;

    const titles = allowedTitles(result);
    if (titles.size) {
        const quoted = cleaned.match(/"([^"]{3,80})"/g) || [];
        for (const raw of quoted) {
            const title = raw.slice(1, -1).toLowerCase();
            if (title && !titles.has(title) && /workout|session|protocol/i.test(title)) return null;
        }
    }
    return cleaned;
}

function voiceFacts(result, input) {
    return {
        athleteQuestion: questionText(input),
        intent: result.intent,
        readinessStatus: result.readinessStatus || null,
        medicalBoundary: result.classification?.medicalBoundary || null,
        workouts: workoutFacts(result),
        mayStillTrain: result.userMayStillTrain !== false,
        catalogNote: result.explanation || null,
        recentUserNotes: recentUserNotes(input),
        rules: {
            aiMayInvent: false,
            officialHyroxFormulas: false,
            tone: 'positive',
        },
    };
}

async function attachNovaVoice(result, input = {}, options = {}) {
    const fallback = catalogReply(result, input);
    const withVoice = {
        ...result,
        asked: looksLikeQuestion(questionText(input)) ? 'question' : 'session',
        reply: fallback,
        voice: { tone: 'positive', provider: 'catalog' },
    };

    if (!shouldUseGroq(options, options.env || process.env) && typeof options.completeChat !== 'function') {
        return withVoice;
    }

    try {
        const completion = await completeGroqChat({
            ...options,
            system: NOVA_SYSTEM_PROMPT,
            user: JSON.stringify(voiceFacts(withVoice, input)),
        });
        const cleaned = sanitizeReply(completion?.text, withVoice);
        if (!cleaned) return withVoice;
        withVoice.reply = cleaned;
        withVoice.voice = {
            tone: 'positive',
            provider: completion.provider || 'groq',
            model: completion.model || null,
        };
        return withVoice;
    } catch (error) {
        console.warn('NOVA Groq voice skipped', error.code || error.message, error.message || '');
        return withVoice;
    }
}

module.exports = {
    NOVA_SYSTEM_PROMPT,
    looksLikeQuestion,
    questionText,
    catalogReply,
    sanitizeReply,
    attachNovaVoice,
    groqStatus,
};
