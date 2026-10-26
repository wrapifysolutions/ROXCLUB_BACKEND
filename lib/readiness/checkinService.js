const { query: dbQuery, queryWithHardTimeout, withTransaction } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { computeReadiness, gatherSignals, toReadiness } = require('./readinessService');

const FIELDS = [
    ['energy', 'energy'],
    ['soreness', 'soreness'],
    ['sleepQuality', 'sleep_quality'],
    ['stress', 'stress'],
];

function invalidCheckin() {
    const error = new Error('energy, soreness, sleepQuality, and stress must be integers from 1 to 5');
    error.status = 400;
    error.code = 'INVALID_CHECKIN';
    return error;
}

function readAnswers(body) {
    const answers = {};
    for (const [field] of FIELDS) {
        const value = body?.[field];
        if (!Number.isInteger(value) || value < 1 || value > 5) throw invalidCheckin();
        answers[field] = value;
    }
    return answers;
}

function toCheckin(row) {
    if (!row || row.energy == null) return null;
    return {
        id: row.id == null ? null : Number(row.id),
        localDate: row.local_date,
        energy: row.energy,
        soreness: row.soreness,
        sleepQuality: row.sleep_quality,
        stress: row.stress,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at || null,
    };
}

function shouldPromptFrom(row) {
    const hasCheckin = row?.energy != null;
    const dismissed = row?.prompt_status === 'dismissed';
    return !hasCheckin && !dismissed;
}

async function loadToday(userId, localDate, query) {
    const { rows } = await query(
        `
        /* readiness:load_today */
        SELECT
            c.id,
            c.local_date::text AS local_date,
            c.energy,
            c.soreness,
            c.sleep_quality,
            c.stress,
            c.updated_at,
            p.status AS prompt_status
        FROM (SELECT $1::uuid AS user_id, $2::date AS local_date) AS day
        LEFT JOIN readiness_checkins c
            ON c.user_id = day.user_id AND c.local_date = day.local_date
        LEFT JOIN checkin_prompts p
            ON p.user_id = day.user_id AND p.local_date = day.local_date
        `,
        [userId, localDate],
        8000
    );
    return rows[0] || null;
}

async function getTodayCheckin(userId, localDate, query = queryWithHardTimeout) {
    if (query === queryWithHardTimeout) await ensureOnboardingProfileSchema();
    const row = await loadToday(userId, localDate, query);
    return {
        shouldPrompt: shouldPromptFrom(row),
        checkin: toCheckin(row),
    };
}

async function upsertPrompt(userId, localDate, status, query) {
    await query(
        `
        /* readiness:upsert_prompt */
        INSERT INTO checkin_prompts (user_id, local_date, status)
        VALUES ($1, $2::date, $3)
        ON CONFLICT (user_id, local_date)
        DO UPDATE SET
            status = CASE
                WHEN checkin_prompts.status = 'completed' AND EXCLUDED.status = 'dismissed'
                    THEN checkin_prompts.status
                ELSE EXCLUDED.status
            END,
            updated_at = NOW()
        `,
        [userId, localDate, status],
        8000
    );
}

async function dismissCheckin(userId, localDate, query = queryWithHardTimeout) {
    if (query === queryWithHardTimeout) await ensureOnboardingProfileSchema();
    await upsertPrompt(userId, localDate, 'dismissed', query);
    const today = await getTodayCheckin(userId, localDate, query);
    return {
        shouldPrompt: today.shouldPrompt,
        status: today.checkin ? 'completed' : 'dismissed',
    };
}

async function runSubmit(userId, answers, localDate, query, gather) {
    const { rows } = await query(
        `
        /* readiness:upsert_checkin */
        INSERT INTO readiness_checkins (
            user_id, local_date, energy, soreness, sleep_quality, stress, updated_at
        )
        VALUES ($1, $2::date, $3, $4, $5, $6, NOW())
        ON CONFLICT (user_id, local_date)
        DO UPDATE SET
            energy = EXCLUDED.energy,
            soreness = EXCLUDED.soreness,
            sleep_quality = EXCLUDED.sleep_quality,
            stress = EXCLUDED.stress,
            updated_at = NOW()
        RETURNING id, local_date::text AS local_date, energy, soreness, sleep_quality, stress, updated_at
        `,
        [userId, localDate, answers.energy, answers.soreness, answers.sleepQuality, answers.stress],
        8000
    );
    await upsertPrompt(userId, localDate, 'completed', query);

    const signals = await gather(userId, localDate, query);
    const computed = computeReadiness({
        ...signals,
        checkin: answers,
    });
    const { rows: readinessRows } = await query(
        `
        /* readiness:upsert_readiness */
        INSERT INTO daily_readiness (
            user_id, local_date, score, status, confidence, signals_used, model_version, computed_at
        )
        VALUES ($1, $2::date, $3, $4, $5, $6::jsonb, $7, NOW())
        ON CONFLICT (user_id, local_date)
        DO UPDATE SET
            score = EXCLUDED.score,
            status = EXCLUDED.status,
            confidence = EXCLUDED.confidence,
            signals_used = EXCLUDED.signals_used,
            model_version = EXCLUDED.model_version,
            computed_at = NOW()
        RETURNING id, local_date::text AS local_date, score, status, confidence,
                  signals_used, model_version, computed_at
        `,
        [
            userId,
            localDate,
            computed.score,
            computed.status,
            computed.confidence,
            JSON.stringify(computed.signalsUsed),
            computed.modelVersion,
        ],
        8000
    );

    return {
        checkin: toCheckin(rows[0]),
        readiness: toReadiness(readinessRows[0]),
    };
}

async function submitCheckin(userId, body, localDate, options = {}) {
    const answers = readAnswers(body);
    const query = options.query;
    const gather = options.gather || gatherSignals;
    if (query) return runSubmit(userId, answers, localDate, query, gather);
    await ensureOnboardingProfileSchema();
    const signals = await gather(userId, localDate, dbQuery);
    return withTransaction((client) =>
        runSubmit(
            userId,
            answers,
            localDate,
            (sql, params) => client.query(sql, params),
            async () => signals
        )
    );
}

module.exports = {
    readAnswers,
    getTodayCheckin,
    dismissCheckin,
    submitCheckin,
};
