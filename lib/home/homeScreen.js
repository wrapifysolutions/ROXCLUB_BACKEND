const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { isoDate } = require('../onboarding/schedule');
const { workoutById } = require('../onboarding/programCatalog');
const { getHomeWatchData } = require('./athleteDna');
const { buildHomeResponse } = require('./homeState');
const { listCategories } = require('../workouts/workoutCatalog');
const { resolveUserTimezone } = require('../readiness/userTimezone');
const { ensureTodayReadiness } = require('../readiness/readinessService');
const { getHomeWeek } = require('../plan/planService');
const { normalizeGender } = require('../onboarding/programMatch');

function weekStart(iso) {
    const date = new Date(`${iso}T00:00:00Z`);
    const day = date.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    date.setUTCDate(date.getUTCDate() - diff);
    return date.toISOString().slice(0, 10);
}

function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

async function optionalQuery(sql, params) {
    try {
        return await queryWithHardTimeout(sql, params, 8000);
    } catch (error) {
        if (error.code === '42P01') return { rows: [] };
        throw error;
    }
}

function asDailyReadiness(value) {
    if (!value) return null;
    const row = typeof value === 'string' ? JSON.parse(value) : value;
    return {
        score: row.score == null ? null : Number(row.score),
        status: row.status,
        confidence: row.confidence,
        signalsUsed: row.signals_used || row.signalsUsed || {},
        modelVersion: row.model_version || row.modelVersion,
        localDate: row.local_date || row.localDate,
    };
}

const DNA_COLUMNS_CURRENT = `
            dna.status AS dna_status,
            dna.attributes AS dna_attributes,
            dna.strength,
            dna.engine,
            dna.endurance,
            dna.power,
            dna.mobility,
            dna.speed,
            dna.model_version AS dna_model_version,
            dna.peak_endurance,
            dna.peak_engine,
            dna.peak_strength,
            dna.peak_power,
            dna.peak_speed,
            dna.peak_mobility`;

const DNA_COLUMNS_WITHOUT_SPEED = `
            dna.status AS dna_status,
            dna.attributes AS dna_attributes,
            dna.strength,
            dna.engine,
            dna.endurance,
            dna.power,
            dna.mobility,
            NULL::numeric AS speed,
            dna.model_version AS dna_model_version,
            NULL::numeric AS peak_endurance,
            NULL::numeric AS peak_engine,
            NULL::numeric AS peak_strength,
            NULL::numeric AS peak_power,
            NULL::numeric AS peak_speed,
            NULL::numeric AS peak_mobility`;

const DNA_COLUMNS_LEGACY = `
            dna.status AS dna_status,
            dna.attributes AS dna_attributes,
            dna.strength,
            dna.engine,
            dna.endurance,
            dna.power,
            dna.mobility,
            NULL::numeric AS speed,
            NULL::varchar AS dna_model_version,
            NULL::numeric AS peak_endurance,
            NULL::numeric AS peak_engine,
            NULL::numeric AS peak_strength,
            NULL::numeric AS peak_power,
            NULL::numeric AS peak_speed,
            NULL::numeric AS peak_mobility`;

function homeProfileSql(dnaColumns) {
    return `
        SELECT
            COALESCE(u.display_name, oq.display_name) AS display_name,
            COALESCE(u.gender, oq.gender) AS gender,
            u.onboarding_completed,
            oq.avatar_config,
            oq.is_completed,
            ${dnaColumns},
            rg.event AS race_event,
            rg.event_date AS race_date,
            (
                SELECT COUNT(*)::int FROM (
                    SELECT ss.id
                    FROM scheduled_sessions ss
                    WHERE ss.user_id = u.id AND ss.completed_at IS NOT NULL
                    UNION
                    SELECT ws.id
                    FROM workout_sessions ws
                    WHERE ws.user_id = u.id
                      AND ws.status IN ('completed', 'partial')
                      AND ws.scheduled_session_id IS NULL
                ) finished
            ) AS completed_sessions,
            (
                SELECT COALESCE(SUM(xl.xp), 0)::int
                FROM xp_ledger xl
                WHERE xl.user_id = u.id
            ) AS xp_total,
            (
                SELECT rc.score
                FROM readiness_checkins rc
                WHERE rc.user_id = u.id AND rc.checked_on = $2::date
            ) AS checkin_score,
            (
                SELECT json_build_object(
                    'score', dr.score,
                    'status', dr.status,
                    'confidence', dr.confidence,
                    'signals_used', dr.signals_used,
                    'model_version', dr.model_version,
                    'local_date', dr.local_date::text
                )
                FROM daily_readiness dr
                WHERE dr.user_id = u.id AND dr.local_date = $2::date
            ) AS daily_readiness
        FROM users u
        LEFT JOIN onboarding_questions oq ON oq.user_id = u.id
        LEFT JOIN athlete_dna dna ON dna.user_id = u.id
        LEFT JOIN race_goals rg ON rg.user_id = u.id
        WHERE u.id = $1
        `;
}

async function loadHomeProfileRow(userId, today, query = queryWithHardTimeout) {
    const variants = [DNA_COLUMNS_CURRENT, DNA_COLUMNS_WITHOUT_SPEED, DNA_COLUMNS_LEGACY];
    let lastError;
    for (const dnaColumns of variants) {
        try {
            return await query(homeProfileSql(dnaColumns), [userId, today], 8000);
        } catch (error) {
            if (error.code !== '42703') throw error;
            lastError = error;
        }
    }
    throw lastError;
}

async function loadHomeScreen(userId, timeZone) {
    await ensureOnboardingProfileSchema();
    const zone = await resolveUserTimezone(userId, timeZone);
    const today = isoDate(zone);
    const start = weekStart(today);

    const { rows } = await loadHomeProfileRow(userId, today);

    const profile = rows[0];
    if (!profile || (!profile.onboarding_completed && !profile.is_completed)) return null;

    const todaySession = await queryWithHardTimeout(
        `
        SELECT workout_id, title, duration_min, scheduled_on::text AS scheduled_on,
               plan_day, week_number, completed_at, status
        FROM scheduled_sessions
        WHERE user_id = $1 AND scheduled_on = $2::date
        `,
        [userId, today],
        8000
    );

    const weekSessions = await queryWithHardTimeout(
        `
        SELECT workout_id, title, duration_min, scheduled_on::text AS scheduled_on,
               completed_at, week_number, status
        FROM scheduled_sessions
        WHERE user_id = $1
          AND scheduled_on >= $2::date
          AND scheduled_on < $3::date
        ORDER BY scheduled_on
        `,
        [userId, start, addDays(start, 7)],
        8000
    );

    const categoryCounts = new Map();
    for (const session of weekSessions.rows) {
        const category = workoutById(session.workout_id)?.category || 'training';
        categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }

    const syncResult = await optionalQuery(
        `
        SELECT provider, status, last_synced_at
        FROM user_integrations
        WHERE user_id = $1
        `,
        [userId]
    );

    let unreadNotifications = 0;
    try {
        const unread = await queryWithHardTimeout(
            `
            SELECT COUNT(*)::int AS count
            FROM notifications
            WHERE user_id = $1 AND read_at IS NULL
            `,
            [userId],
            8000
        );
        unreadNotifications = Number(unread.rows[0]?.count) || 0;
    } catch (error) {
        if (error.code !== '42P01') throw error;
    }

    let watch = null;
    try {
        const watchData = await getHomeWatchData(userId);
        watch = {
            ...(watchData.athlete_dna || {}),
            thisWeek: watchData.this_week || null,
        };
    } catch (error) {
        console.error('home watch data error', error.message);
    }

    const dailyReadiness = await todayReadiness(userId, today, profile.daily_readiness);
    const adaptation = reducedLoadFor(dailyReadiness, todaySession.rows[0] || null);
    const seasonal = await loadSeasonal(userId);
    return buildHomeResponse({
        name: String(profile.display_name || '').trim(),
        gender: normalizeGender(profile.gender),
        avatar: profile.avatar_config,
        dnaStatus: profile.dna_status,
        watch,
        dna: {
            attributes: profile.dna_attributes,
            strength: profile.strength,
            engine: profile.engine,
            endurance: profile.endurance,
            power: profile.power,
            mobility: profile.mobility,
            speed: profile.speed,
            model_version: profile.dna_model_version,
            peak_endurance: profile.peak_endurance,
            peak_engine: profile.peak_engine,
            peak_strength: profile.peak_strength,
            peak_power: profile.peak_power,
            peak_speed: profile.peak_speed,
            peak_mobility: profile.peak_mobility,
        },
        todaySession: todaySession.rows[0] || null,
        xpTotal: profile.xp_total,
        completedSessions: completedAfterDedupe(dailyReadiness, profile.completed_sessions),
        checkInScore: profile.checkin_score,
        thisWeek: await homeWeekStrip(userId, today),
        categories: [...categoryCounts.entries()].map(([id, count]) => ({ id, count })),
        nextGoal: profile.race_event
            ? { event: profile.race_event, date: profile.race_date }
            : null,
        sync: {
            providers: syncResult.rows.map((row) => ({
                provider: row.provider,
                status: row.status,
                lastSyncedAt: row.last_synced_at,
            })),
        },
        unreadNotifications,
        featuredCategories: listCategories({ homeOnly: true }),
        dailyReadiness,
        adaptation,
        seasonal,
    });
}

async function loadSeasonal(userId) {
    try {
        const { loadSeasonalPoints } = require('../workout/xpLedger');
        const seasonal = await loadSeasonalPoints(userId, queryWithHardTimeout);
        return { ...seasonal, resets: true, affectsLevel: false };
    } catch (error) {
        console.error('home seasonal error', error.message);
        return { key: null, points: 0, resets: true, affectsLevel: false };
    }
}

function reducedLoadFor(readiness, session) {
    try {
        const { suggestReducedLoad } = require('../plan/adaptationService');
        return suggestReducedLoad({
            status: readiness?.status,
            todaySession: session,
        });
    } catch (error) {
        console.error('home adaptation error', error.message);
        return null;
    }
}

function completedAfterDedupe(readiness, fallback) {
    const count = readiness?.signalsUsed?.completedSessions;
    if (count == null) return Number(fallback) || 0;
    return Number(count) || 0;
}

async function homeWeekStrip(userId, today) {
    try {
        return await getHomeWeek(userId, today);
    } catch (error) {
        console.error('home week error', error.message);
        return { completed: 0, total: 0, days: [] };
    }
}

async function todayReadiness(userId, today, stored) {
    try {
        const fresh = await ensureTodayReadiness(userId, today);
        return fresh.today;
    } catch (error) {
        console.error('home readiness error', error.message);
        return asDailyReadiness(stored);
    }
}

module.exports = { loadHomeScreen, loadHomeProfileRow, homeProfileSql };
