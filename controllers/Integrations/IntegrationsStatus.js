const pool = require('../../lib/pool');
const { ensureStravaTables } = require('../../lib/strava/stravaTokens');
const { ensureStravaDataTables, countStoredActivities } = require('../../lib/strava/stravaSync');
const { ensureZeppTables } = require('../../lib/zepp/zeppTokens');
const { ensureZeppDataTables, countZeppSamples } = require('../../lib/zepp/zeppDataStore');
const {
    ensureAppleHealthTables,
    summarizeAppleHealth,
} = require('../../lib/appleHealth/appleHealthStore');
const { getZeppAvailability } = require('../../lib/zeppConfig/zeppConfig');
const { ensureOnboardingProfileSchema } = require('../../lib/onboarding/schema');

/**
 * For onboarding screen "Connect your data" (Strava / Zepp / Apple Health).
 */
const getAllIntegrationsStatus = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        await ensureStravaTables();
        await ensureStravaDataTables();
        await ensureZeppTables();
        await ensureZeppDataTables();
        await ensureAppleHealthTables();

        const { rows } = await pool.query(
            `
            SELECT provider, status, provider_user_id, connected_at, last_synced_at, last_error
            FROM user_integrations
            WHERE user_id = $1
              AND provider IN ('strava', 'zepp', 'apple_health')
            `,
            [userId]
        );

        const byProvider = Object.fromEntries(rows.map((row) => [row.provider, row]));

        const [stravaCount, zeppCounts, appleSummary] = await Promise.all([
            countStoredActivities(userId).catch(() => 0),
            countZeppSamples(userId).catch(() => ({})),
            summarizeAppleHealth(userId).catch(() => ({})),
        ]);

        const counts = {
            strava: { activities: stravaCount },
            zepp: zeppCounts,
            apple_health: Object.fromEntries(
                Object.entries(appleSummary).map(([type, info]) => [type, info.count])
            ),
        };

        const zeppAvailability = getZeppAvailability();

        const build = (provider, label, description, extra = {}) => {
            const row = byProvider[provider];
            const connected = row?.status === 'connected';
            const available = extra.available !== false;
            return {
                provider,
                label,
                description,
                available,
                connected,
                status: connected
                    ? row.status
                    : available
                      ? row?.status || 'disconnected'
                      : 'unavailable',
                button: connected ? 'Connected' : available ? 'Connect' : 'Use Strava',
                connectedAt: row?.connected_at || null,
                lastSyncedAt: row?.last_synced_at || null,
                lastError: row?.last_error || extra.hint || null,
                hint: extra.hint || null,
                suggestProvider: extra.suggestProvider || null,
                dataCount: counts[provider] || {},
            };
        };

        return res.status(200).json({
            success: true,
            integrations: [
                build(
                    'zepp',
                    'Amazfit/Zepp',
                    zeppAvailability.ready
                        ? 'Syncs runs, workouts, HR, sleep and recovery data.'
                        : 'Watch data via Zepp app. If Zepp already syncs to Strava, connect Strava.',
                    {
                        available: zeppAvailability.ready,
                        hint: zeppAvailability.hint,
                        suggestProvider: zeppAvailability.ready ? null : 'strava',
                    }
                ),
                build(
                    'strava',
                    'Strava',
                    'Sync workouts and get route & segment data.'
                ),
                build(
                    'apple_health',
                    'Apple Health',
                    'Core health data: HRV, sleep, resting HR and steps.'
                ),
            ],
        });
    } catch (error) {
        console.error('Integrations status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch integrations status',
        });
    }
};

const getWorkoutsFeed = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);

        await ensureStravaDataTables();
        await ensureZeppDataTables();
        await ensureAppleHealthTables();
        await ensureOnboardingProfileSchema();

        const { rows } = await pool.query(
            `
            (
                SELECT
                    'strava'::text AS source,
                    strava_activity_id::text AS external_id,
                    COALESCE(name, sport_type, activity_type, 'Workout') AS name,
                    COALESCE(sport_type, activity_type, 'workout') AS sport_type,
                    start_at,
                    distance,
                    moving_time AS duration_seconds,
                    calories,
                    average_heartrate
                FROM strava_activities
                WHERE user_id = $1
                  AND NOT EXISTS (
                    SELECT 1 FROM activities a
                    WHERE a.user_id = strava_activities.user_id
                      AND a.provenance @> jsonb_build_array(
                        jsonb_build_object('source', 'strava', 'externalId', strava_activities.strava_activity_id::text)
                      )
                  )
            )
            UNION ALL
            (
                SELECT
                    'zepp'::text AS source,
                    external_id,
                    COALESCE(name, sport_type, 'Workout') AS name,
                    COALESCE(sport_type, sample_type, 'activity') AS sport_type,
                    start_at,
                    distance,
                    duration_seconds,
                    calories,
                    average_heartrate
                FROM zepp_health_samples
                WHERE user_id = $1 AND sample_type = 'activity'
                  AND NOT EXISTS (
                    SELECT 1 FROM activities a
                    WHERE a.user_id = zepp_health_samples.user_id
                      AND a.provenance @> jsonb_build_array(
                        jsonb_build_object('source', 'zepp', 'externalId', zepp_health_samples.external_id)
                      )
                  )
            )
            UNION ALL
            (
                SELECT
                    'apple_health'::text AS source,
                    external_id,
                    COALESCE(metadata->>'name', 'Workout') AS name,
                    COALESCE(metadata->>'sport_type', 'workout') AS sport_type,
                    start_at,
                    NULLIF(value, 0) AS distance,
                    CASE
                        WHEN (metadata->>'duration_seconds') ~ '^[0-9]+$'
                        THEN (metadata->>'duration_seconds')::int
                    END AS duration_seconds,
                    CASE
                        WHEN (metadata->>'calories') ~ '^[0-9]+(\\.[0-9]+)?$'
                        THEN (metadata->>'calories')::numeric
                    END AS calories,
                    CASE
                        WHEN (metadata->>'average_heartrate') ~ '^[0-9]+(\\.[0-9]+)?$'
                        THEN (metadata->>'average_heartrate')::numeric
                    END AS average_heartrate
                FROM apple_health_samples
                WHERE user_id = $1 AND sample_type = 'workout'
                  AND NOT EXISTS (
                    SELECT 1 FROM activities a
                    WHERE a.user_id = apple_health_samples.user_id
                      AND a.provenance @> jsonb_build_array(
                        jsonb_build_object('source', 'apple_health', 'externalId', apple_health_samples.external_id)
                      )
                  )
            )
            UNION ALL
            (
                SELECT
                    'ROXCLUB_NATIVE'::text AS source,
                    id::text AS external_id,
                    name,
                    activity_type AS sport_type,
                    start_at,
                    distance_m AS distance,
                    duration_sec AS duration_seconds,
                    NULL::numeric AS calories,
                    avg_hr AS average_heartrate
                FROM activities
                WHERE user_id = $1
            )
            ORDER BY start_at DESC NULLS LAST
            LIMIT $2
            `,
            [userId, limit]
        );

        return res.status(200).json({
            success: true,
            count: rows.length,
            workouts: rows,
        });
    } catch (error) {
        console.error('Workouts feed error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch workouts',
        });
    }
};

module.exports = { getAllIntegrationsStatus, getWorkoutsFeed };
