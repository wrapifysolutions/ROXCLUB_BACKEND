const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { isoDate } = require('../onboarding/schedule');
const { workoutById } = require('../onboarding/programCatalog');
const { getHomeWatchData } = require('./athleteDna');
const { buildHomeResponse } = require('./homeState');

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

async function loadHomeScreen(userId, timeZone) {
    await ensureOnboardingProfileSchema();
    const today = isoDate(timeZone);
    const start = weekStart(today);

    const { rows } = await queryWithHardTimeout(
        `
        SELECT
            COALESCE(u.display_name, oq.display_name) AS display_name,
            u.onboarding_completed,
            oq.avatar_config,
            oq.is_completed,
            dna.status AS dna_status,
            dna.attributes AS dna_attributes,
            dna.strength,
            dna.engine,
            dna.endurance,
            dna.power,
            dna.mobility,
            rg.event AS race_event,
            rg.event_date AS race_date,
            (
                SELECT COUNT(*)::int
                FROM scheduled_sessions ss
                WHERE ss.user_id = u.id AND ss.completed_at IS NOT NULL
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
            ) AS checkin_score
        FROM users u
        LEFT JOIN onboarding_questions oq ON oq.user_id = u.id
        LEFT JOIN athlete_dna dna ON dna.user_id = u.id
        LEFT JOIN race_goals rg ON rg.user_id = u.id
        WHERE u.id = $1
        `,
        [userId, today],
        8000
    );

    const profile = rows[0];
    if (!profile || (!profile.onboarding_completed && !profile.is_completed)) return null;

    const todaySession = await queryWithHardTimeout(
        `
        SELECT workout_id, title, duration_min, scheduled_on::text AS scheduled_on,
               plan_day, week_number
        FROM scheduled_sessions
        WHERE user_id = $1 AND scheduled_on = $2::date
        `,
        [userId, today],
        8000
    );

    const weekSessions = await queryWithHardTimeout(
        `
        SELECT workout_id, title, duration_min, scheduled_on::text AS scheduled_on,
               completed_at, week_number
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
        watch = watchData.athlete_dna;
    } catch (error) {
        console.error('home watch data error', error.message);
    }

    return buildHomeResponse({
        name: String(profile.display_name || '').trim(),
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
        },
        todaySession: todaySession.rows[0] || null,
        xpTotal: profile.xp_total,
        completedSessions: profile.completed_sessions,
        checkInScore: profile.checkin_score,
        thisWeek: {
            start,
            sessions: weekSessions.rows.map((session) => ({
                id: session.workout_id,
                title: session.title,
                durationMin: Number(session.duration_min),
                scheduledOn: session.scheduled_on,
                completed: Boolean(session.completed_at),
            })),
        },
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
    });
}

module.exports = { loadHomeScreen };
