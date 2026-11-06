const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { isoDate } = require('../onboarding/schedule');
const { resolveUserTimezone } = require('../readiness/userTimezone');
const { ensureTodayReadiness } = require('../readiness/readinessService');
const {
    getWorkout,
    getCategoryName,
    findCategory,
    listAllLibraryWorkouts,
} = require('./workoutCatalog');
const { toWorkoutListItem } = require('./workoutDto');

const GOVERNANCE = {
    mode: 'approved_content',
    aiMayInvent: false,
    conversationalDiscovery: false,
    source: 'roxclub_library',
};

const LOW_READINESS = new Set(['FATIGUED', 'RECOVERY_NEEDED']);
const MEDICAL_RE = /\b(injur(?:y|ed)|pain|hurt|rehab|diagnos(?:e|is)|physio|physical therapist)\b/i;

const CATEGORY_HINTS = [
    { re: /\b(hyrox|hybrid|race|station)\b/i, categoryId: 'cat_hybrid_race', type: 'hybrid' },
    { re: /\b(run|running|track|road|interval|sprint|tempo|threshold)\b/i, categoryId: 'cat_track', type: 'run' },
    { re: /\b(strength|gym|lift|barbell|legs|upper|bodyweight)\b/i, categoryId: 'cat_strength', type: 'strength' },
    { re: /\b(recover(?:y)?|mobility|easy|sore|tired|rest)\b/i, categoryId: 'cat_recovery', type: 'recovery' },
    { re: /\b(ergs?|skierg|row(?:ing)?)\b/i, categoryId: 'cat_ergs' },
    { re: /\b(power|explosive)\b/i, categoryId: 'cat_power' },
    { re: /\b(aerobic|zone\s*2|endurance)\b/i, categoryId: 'cat_aerobic', type: 'run' },
    { re: /\b(condition(?:ing)?|circuit)\b/i, categoryId: 'cat_conditioning' },
];

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

function titleCaseDifficulty(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'beginner') return 'Beginner';
    if (raw === 'intermediate') return 'Intermediate';
    if (raw === 'advanced') return 'Advanced';
    return null;
}

function parseDuration(text) {
    const match = String(text || '').match(/\b(15|20|25|30|35|40|45|50|55|60)\s*(min|mins|minute|minutes)?\b/i);
    if (!match) return null;
    return Number(match[1]);
}

function classifyQuery(text) {
    const q = String(text || '').trim().slice(0, 200);
    const classified = {
        q: q || null,
        categoryId: null,
        type: null,
        maxDuration: parseDuration(q),
        difficulty: titleCaseDifficulty((q.match(/\b(beginner|intermediate|advanced)\b/i) || [])[1]),
        preferReducedLoad: false,
        preferHome: /\b(home|house|apartment|no\s+gym)\b/i.test(q),
        medicalBoundary: null,
    };

    if (!q) return classified;

    if (MEDICAL_RE.test(q)) {
        classified.preferReducedLoad = true;
        classified.categoryId = 'cat_recovery';
        classified.type = 'recovery';
        classified.medicalBoundary =
            'ROXCLUB cannot diagnose injury or generate rehab. An approved recovery option is offered. This is not medical advice.';
        return classified;
    }

    for (const hint of CATEGORY_HINTS) {
        if (hint.re.test(q)) {
            classified.categoryId = hint.categoryId;
            classified.type = hint.type || null;
            break;
        }
    }

    if (/\b(easy|recovery|sore|tired)\b/i.test(q)) {
        classified.preferReducedLoad = true;
    }

    return classified;
}

function mergeFilters(classified, explicit = {}) {
    const categoryId = explicit.categoryId || classified.categoryId;
    const category = categoryId ? findCategory(categoryId) : null;
    if (categoryId && !category) {
        throw httpError('CATEGORY_NOT_FOUND', 404, 'Category not found');
    }

    let maxDuration = explicit.maxDuration != null && String(explicit.maxDuration).trim() !== ''
        ? explicit.maxDuration
        : classified.maxDuration;
    if (maxDuration != null && String(maxDuration).toLowerCase() !== 'any') {
        maxDuration = Number(maxDuration);
        if (!Number.isFinite(maxDuration) || maxDuration < 0) {
            throw httpError('INVALID_MAX_DURATION', 400, 'maxDuration must be a non-negative number or Any');
        }
    } else {
        maxDuration = null;
    }

    return {
        q: explicit.q != null && String(explicit.q).trim() !== '' ? String(explicit.q).trim().slice(0, 200) : classified.q,
        categoryId: category ? category.id : null,
        type: explicit.type || classified.type,
        difficulty: titleCaseDifficulty(explicit.difficulty) || classified.difficulty,
        maxDuration,
        preferReducedLoad: Boolean(classified.preferReducedLoad || explicit.preferReducedLoad),
        preferHome: Boolean(classified.preferHome),
        medicalBoundary: classified.medicalBoundary,
    };
}

function isApproved(workout) {
    return Boolean(workout && workout.showInLibrary && workout.id);
}

function matchesFilters(workout, filters) {
    if (!isApproved(workout)) return false;
    if (filters.categoryId && workout.categoryId !== filters.categoryId) return false;
    if (filters.type && workout.type !== filters.type) return false;
    if (filters.difficulty && workout.difficulty !== filters.difficulty) return false;
    if (filters.maxDuration != null && workout.durationMin > filters.maxDuration) return false;
    return true;
}

function textHaystack(workout) {
    return [workout.title, workout.purpose, workout.equipment, ...(workout.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function recommendScore(workout, filters, daily) {
    let score = 0;
    if (filters.categoryId && workout.categoryId === filters.categoryId) score += 5;
    if (filters.type && workout.type === filters.type) score += 4;
    if (filters.difficulty && workout.difficulty === filters.difficulty) score += 2;
    if (filters.maxDuration != null) {
        const slack = filters.maxDuration - workout.durationMin;
        if (slack >= 0 && slack <= 10) score += 3;
        else if (slack >= 0) score += 1;
    }
    if (filters.preferReducedLoad && (workout.type === 'recovery' || workout.difficulty === 'Beginner')) score += 4;
    if (filters.preferHome && /mat|bodyweight|none/i.test(workout.equipment || '')) score += 3;
    if (filters.q && textHaystack(workout).includes(filters.q.toLowerCase())) score += 2;
    if (['READY', 'PRIMED'].includes(daily?.status) && (workout.type === 'hybrid' || workout.type === 'run')) {
        score += 1;
    }
    score += Math.max(0, 4 - Math.min(Number(workout.sortOrder) || 99, 4));
    return score;
}

function stimulusScore(source, candidate) {
    let score = 0;
    if (candidate.type === source.type) score += 4;
    if (candidate.categoryId === source.categoryId) score += 3;
    const delta = Math.abs((candidate.durationMin || 0) - (source.durationMin || 0));
    if (delta <= 10) score += 3;
    else if (delta <= 20) score += 2;
    else if (delta <= 30) score += 1;
    if (candidate.difficulty === source.difficulty) score += 1;
    return score;
}

function toItem(workout) {
    return toWorkoutListItem(workout, getCategoryName(workout.categoryId));
}

function approvedItems(workouts) {
    return workouts.filter(isApproved).map(toItem);
}

function explainFilters(filters, daily, extra = '') {
    const parts = [];
    if (filters.medicalBoundary) parts.push(filters.medicalBoundary);
    if (LOW_READINESS.has(daily?.status)) {
        parts.push('Readiness is low, so approved easier library options are offered. You may still train.');
    }
    if (filters.categoryId) parts.push(`Category: ${getCategoryName(filters.categoryId)}.`);
    if (filters.maxDuration != null) parts.push(`Up to ${filters.maxDuration} min.`);
    if (filters.difficulty) parts.push(`Difficulty ${filters.difficulty} (session ability, not Level).`);
    if (filters.preferHome) parts.push('Preferring approved lower-equipment library options.');
    if (extra) parts.push(extra);
    if (parts.length === 0) {
        parts.push('Selected from the approved ROXCLUB library. No workout was invented.');
    } else if (!filters.medicalBoundary) {
        parts.push('Selected from the approved library. No workout was invented.');
    }
    return parts.join(' ');
}

function recommendFromLibrary(filters, daily, limit = 3) {
    const safeLimit = Math.min(Math.max(Number(limit) || 3, 1), 8);
    let pool = listAllLibraryWorkouts().filter((workout) => matchesFilters(workout, filters));

    if (filters.preferReducedLoad) {
        const easy = pool.filter((workout) => workout.type === 'recovery' || workout.difficulty === 'Beginner');
        if (easy.length) pool = easy;
    }

    if (filters.preferHome) {
        const home = pool.filter((workout) => /mat|bodyweight|none/i.test(workout.equipment || ''));
        if (home.length) pool = home;
    }

    if (pool.length === 0 && (filters.categoryId || filters.type || filters.maxDuration || filters.q)) {
        const relaxed = { ...filters, q: null, difficulty: null };
        pool = listAllLibraryWorkouts().filter((workout) => matchesFilters(workout, relaxed));
    }

    if (pool.length === 0) {
        pool = listAllLibraryWorkouts();
    }

    return pool
        .slice()
        .sort((left, right) => recommendScore(right, filters, daily) - recommendScore(left, filters, daily))
        .slice(0, safeLimit);
}

function alternativesFor(workout, daily, limit = 3) {
    const safeLimit = Math.min(Math.max(Number(limit) || 3, 1), 8);
    const reduced = LOW_READINESS.has(daily?.status);
    const candidates = listAllLibraryWorkouts().filter((candidate) => candidate.id !== workout.id);

    const similar = candidates
        .map((candidate) => ({ candidate, score: stimulusScore(workout, candidate) }))
        .filter((row) => row.score >= 5)
        .sort((left, right) => right.score - left.score)
        .map((row) => row.candidate);

    if (!reduced) return similar.slice(0, safeLimit);

    const easier = candidates
        .filter((candidate) => candidate.type === 'recovery' || candidate.difficulty === 'Beginner')
        .sort((left, right) => (left.durationMin || 0) - (right.durationMin || 0));

    const merged = [];
    const seen = new Set();
    for (const item of [...easier, ...similar]) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
        if (merged.length >= safeLimit) break;
    }
    return merged;
}

function explainWorkout(workout) {
    const why = [
        'Approved ROXCLUB library workout. Content is authored, not generated.',
        `Category: ${getCategoryName(workout.categoryId) || workout.categoryId}.`,
        `Difficulty ${workout.difficulty} describes the session, not your Level.`,
    ];
    if (workout.purpose) why.push(workout.purpose);
    return {
        intent: 'explain',
        governance: { ...GOVERNANCE },
        workout: {
            ...toItem(workout),
            purpose: workout.purpose || null,
            equipment: workout.equipment || null,
        },
        explanation: why.join(' '),
        why,
        userMayStillTrain: true,
    };
}

function requireApprovedWorkout(workoutId) {
    const workout = getWorkout(String(workoutId || '').trim());
    if (!isApproved(workout)) {
        throw httpError('WORKOUT_NOT_FOUND', 404, 'Workout not found in the approved library');
    }
    return workout;
}

async function loadDaily(userId, options = {}) {
    if (!options.query) await ensureOnboardingProfileSchema();
    const query = options.query || queryWithHardTimeout;
    const zone = await resolveUserTimezone(userId, options.timezone, query);
    const today = options.today || isoDate(zone);
    try {
        const readiness = await ensureTodayReadiness(userId, today, query);
        return readiness?.today || null;
    } catch (_) {
        return null;
    }
}

function resolveIntent(input = {}) {
    const explicit = String(input.intent || '').trim().toLowerCase();
    if (['recommend', 'swap', 'explain', 'create'].includes(explicit)) return explicit;
    if (input.workoutId && !input.q) return 'swap';
    return 'recommend';
}

async function getTrainAssist(userId, input = {}, options = {}) {
    const intent = resolveIntent(input);
    const classified = classifyQuery(input.q);
    const daily = options.daily !== undefined ? options.daily : await loadDaily(userId, options);

    if (intent === 'create') {
        const { createUserWorkout, toDetail } = require('./userWorkoutService');
        const workout = await createUserWorkout(userId, { q: input.q, ...input }, options.query);
        return {
            intent: 'create',
            governance: {
                ...GOVERNANCE,
                source: 'user_authored_nova',
                aiMayInvent: false,
            },
            classification: classified,
            readinessStatus: daily?.status || null,
            original: null,
            workout: toDetail(workout, false),
            workouts: [toItem(workout)],
            explanation:
                'NOVA structured your text into a ROXCLUB workout. Review or edit it, then start. No official library workout was invented.',
            userMayStillTrain: true,
        };
    }

    if (intent === 'explain') {
        const workout = requireApprovedWorkout(input.workoutId);
        return {
            ...explainWorkout(workout),
            readinessStatus: daily?.status || null,
            classification: classified,
        };
    }

    if (intent === 'swap') {
        const workout = requireApprovedWorkout(input.workoutId);
        const picks = alternativesFor(workout, daily, input.limit);
        const extra = LOW_READINESS.has(daily?.status)
            ? 'Approved reduced-load alternatives are included. You may still train the original.'
            : `Approved alternatives with similar stimulus (${workout.type}, ~${workout.durationMin} min). You may still train the original.`;
        return {
            intent: 'swap',
            governance: { ...GOVERNANCE },
            classification: classified,
            readinessStatus: daily?.status || null,
            original: toItem(workout),
            workouts: approvedItems(picks),
            explanation: explainFilters(
                { ...classified, preferReducedLoad: classified.preferReducedLoad || LOW_READINESS.has(daily?.status) },
                daily,
                extra
            ),
            userMayStillTrain: true,
        };
    }

    const filters = mergeFilters(classified, input);
    if (LOW_READINESS.has(daily?.status)) filters.preferReducedLoad = true;
    const picks = recommendFromLibrary(filters, daily, input.limit);
    return {
        intent: 'recommend',
        governance: { ...GOVERNANCE },
        classification: {
            q: filters.q,
            categoryId: filters.categoryId,
            type: filters.type,
            maxDuration: filters.maxDuration,
            difficulty: filters.difficulty,
            preferReducedLoad: filters.preferReducedLoad,
            preferHome: filters.preferHome,
            medicalBoundary: filters.medicalBoundary,
        },
        readinessStatus: daily?.status || null,
        original: null,
        workouts: approvedItems(picks),
        explanation: explainFilters(filters, daily),
        userMayStillTrain: true,
    };
}

module.exports = {
    GOVERNANCE,
    classifyQuery,
    getTrainAssist,
    recommendFromLibrary,
    alternativesFor,
    explainWorkout,
};
