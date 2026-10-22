const pool = require('../pool');
const { getAthlete, listAthleteActivities } = require('./stravaClient');
const { getValidAccessToken, ensureStravaTables, markStravaError } = require('./stravaTokens');
const {
    createStravaAthletesTable,
    createStravaActivitiesTable,
    createStravaActivitiesIndex,
} = require('../../models/Strava/StravaDataSchema');

let dataTablesReady = false;

async function ensureStravaDataTables() {
    await ensureStravaTables();
    if (dataTablesReady) return;
    await pool.query(createStravaAthletesTable);
    await pool.query(createStravaActivitiesTable);
    await pool.query(createStravaActivitiesIndex);
    dataTablesReady = true;
}

async function upsertAthlete(userId, athlete) {
    if (!athlete?.id) return null;

    await pool.query(
        `
        INSERT INTO strava_athletes (
            user_id, athlete_id, username, firstname, lastname,
            city, country, sex, profile_url, raw, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
            athlete_id = EXCLUDED.athlete_id,
            username = EXCLUDED.username,
            firstname = EXCLUDED.firstname,
            lastname = EXCLUDED.lastname,
            city = EXCLUDED.city,
            country = EXCLUDED.country,
            sex = EXCLUDED.sex,
            profile_url = EXCLUDED.profile_url,
            raw = EXCLUDED.raw,
            updated_at = NOW()
        `,
        [
            userId,
            String(athlete.id),
            athlete.username || null,
            athlete.firstname || null,
            athlete.lastname || null,
            athlete.city || null,
            athlete.country || null,
            athlete.sex || null,
            athlete.profile || athlete.profile_medium || null,
            JSON.stringify(athlete),
        ]
    );

    return athlete;
}

async function upsertActivity(userId, activity) {
    if (!activity?.id) return false;

    await pool.query(
        `
        INSERT INTO strava_activities (
            user_id, strava_activity_id, name, sport_type, activity_type,
            start_at, timezone, elapsed_time, moving_time, distance,
            total_elevation_gain, average_speed, max_speed,
            average_heartrate, max_heartrate, calories, map_polyline,
            raw, updated_at
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18::jsonb, NOW()
        )
        ON CONFLICT (user_id, strava_activity_id)
        DO UPDATE SET
            name = EXCLUDED.name,
            sport_type = EXCLUDED.sport_type,
            activity_type = EXCLUDED.activity_type,
            start_at = EXCLUDED.start_at,
            timezone = EXCLUDED.timezone,
            elapsed_time = EXCLUDED.elapsed_time,
            moving_time = EXCLUDED.moving_time,
            distance = EXCLUDED.distance,
            total_elevation_gain = EXCLUDED.total_elevation_gain,
            average_speed = EXCLUDED.average_speed,
            max_speed = EXCLUDED.max_speed,
            average_heartrate = EXCLUDED.average_heartrate,
            max_heartrate = EXCLUDED.max_heartrate,
            calories = EXCLUDED.calories,
            map_polyline = EXCLUDED.map_polyline,
            raw = EXCLUDED.raw,
            updated_at = NOW()
        `,
        [
            userId,
            activity.id,
            activity.name || null,
            activity.sport_type || null,
            activity.type || null,
            activity.start_date || activity.start_date_local || null,
            activity.timezone || null,
            activity.elapsed_time ?? null,
            activity.moving_time ?? null,
            activity.distance ?? null,
            activity.total_elevation_gain ?? null,
            activity.average_speed ?? null,
            activity.max_speed ?? null,
            activity.average_heartrate ?? null,
            activity.max_heartrate ?? null,
            activity.calories ?? null,
            activity.map?.summary_polyline || null,
            JSON.stringify(activity),
        ]
    );

    return true;
}

async function markSync(userId, status, errorMessage = null) {
    await pool.query(
        `
        UPDATE user_integrations
        SET
            last_synced_at = CASE WHEN $2 = 'success' THEN NOW() ELSE last_synced_at END,
            last_sync_status = $2,
            last_error = $3,
            updated_at = NOW()
        WHERE user_id = $1 AND provider = 'strava'
        `,
        [userId, status, errorMessage]
    );
}

async function syncStravaData(userId, { days = 180, maxPages = 4 } = {}) {
    await ensureStravaDataTables();

    const accessToken = await getValidAccessToken(userId);
    const athlete = await getAthlete(accessToken);
    await upsertAthlete(userId, athlete);

    if (athlete?.id) {
        await pool.query(
            `
            UPDATE user_integrations
            SET provider_user_id = $2, updated_at = NOW()
            WHERE user_id = $1 AND provider = 'strava'
            `,
            [userId, String(athlete.id)]
        );
    }

    const after = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    let saved = 0;

    for (let page = 1; page <= maxPages; page += 1) {
        const activities = await listAthleteActivities(accessToken, {
            after,
            page,
            perPage: 100,
        });

        if (!Array.isArray(activities) || activities.length === 0) {
            break;
        }

        for (const activity of activities) {
            if (await upsertActivity(userId, activity)) {
                saved += 1;
            }
        }

        if (activities.length < 100) {
            break;
        }
    }

    await markSync(userId, 'success');

    return { athlete, saved };
}

async function getStoredAthlete(userId) {
    await ensureStravaDataTables();
    const { rows } = await pool.query(
        `SELECT * FROM strava_athletes WHERE user_id = $1`,
        [userId]
    );
    return rows[0] || null;
}

async function listStoredActivities(userId, { limit = 50, offset = 0 } = {}) {
    await ensureStravaDataTables();
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const { rows } = await pool.query(
        `
        SELECT
            strava_activity_id AS id,
            name,
            sport_type,
            activity_type,
            start_at,
            elapsed_time,
            moving_time,
            distance,
            total_elevation_gain,
            average_speed,
            average_heartrate,
            max_heartrate,
            calories,
            map_polyline,
            updated_at
        FROM strava_activities
        WHERE user_id = $1
        ORDER BY start_at DESC NULLS LAST
        LIMIT $2 OFFSET $3
        `,
        [userId, safeLimit, safeOffset]
    );

    return rows;
}

async function countStoredActivities(userId) {
    await ensureStravaDataTables();
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM strava_activities WHERE user_id = $1`,
        [userId]
    );
    return rows[0]?.count || 0;
}

async function syncStravaDataSafe(userId, options) {
    try {
        return await syncStravaData(userId, options);
    } catch (error) {
        await markSync(userId, 'failed', error.message).catch(() => {});
        await markStravaError(userId, error.message).catch(() => {});
        throw error;
    }
}

module.exports = {
    ensureStravaDataTables,
    syncStravaData,
    syncStravaDataSafe,
    getStoredAthlete,
    listStoredActivities,
    countStoredActivities,
};
