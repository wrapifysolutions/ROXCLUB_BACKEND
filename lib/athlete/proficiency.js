const { stationKeyFromName } = require('./stationKeys');
const { throwIfMissingRelation } = require('../db/errors');

async function recordStationProficiency(userId, activityId, stations, evidenceStatus, query, extras = {}) {
    if (!userId || !Array.isArray(stations) || stations.length === 0) return 0;
    let written = 0;
    for (const split of stations) {
        const key = stationKeyFromName(split.name);
        if (!key) continue;
        const activityIndex = split.activity_index ?? split.activityIndex;
        if (activityIndex == null) continue;
        try {
            const inserted = await query(
                `
                /* engine:insert_proficiency_evidence */
                INSERT INTO station_proficiency_evidence (
                    user_id, station_key, activity_id, activity_index, source,
                    evidence_status, duration_sec, reps, load_kg, distance_m, provenance
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
                ON CONFLICT (user_id, station_key, activity_id, activity_index) DO NOTHING
                RETURNING activity_id
                `,
                [
                    userId,
                    key,
                    activityId,
                    activityIndex,
                    extras.source || null,
                    evidenceStatus || null,
                    split.duration_sec ?? split.durationSec ?? null,
                    split.reps ?? null,
                    split.load_kg ?? split.loadKg ?? null,
                    split.distance_m ?? split.distanceM ?? null,
                    JSON.stringify({
                        name: split.name,
                        inputMethod: split.input_method || split.inputMethod || null,
                    }),
                ]
            );
            if (!inserted.rows[0]) continue;

            await query(
                `
                /* engine:upsert_proficiency */
                INSERT INTO station_proficiency (
                    user_id, station_key, evidence_count, last_activity_id,
                    last_evidence_status, status, score, score_status, model_version,
                    current_tier, peak_tier, tier_status, last_source,
                    last_duration_sec, last_reps, last_load_kg, last_distance_m,
                    last_provenance, updated_at
                )
                VALUES (
                    $1, $2, 1, $3, $4, 'CALIBRATING', NULL, 'PENDING_MODEL', 'pending_v0',
                    NULL, NULL, 'PENDING_MODEL', $5, $6, $7, $8, $9, $10::jsonb, NOW()
                )
                ON CONFLICT (user_id, station_key)
                DO UPDATE SET
                    evidence_count = station_proficiency.evidence_count + 1,
                    last_activity_id = EXCLUDED.last_activity_id,
                    last_evidence_status = EXCLUDED.last_evidence_status,
                    status = 'CALIBRATING',
                    score = station_proficiency.score,
                    score_status = COALESCE(station_proficiency.score_status, 'PENDING_MODEL'),
                    current_tier = station_proficiency.current_tier,
                    peak_tier = station_proficiency.peak_tier,
                    tier_status = 'PENDING_MODEL',
                    last_source = EXCLUDED.last_source,
                    last_duration_sec = EXCLUDED.last_duration_sec,
                    last_reps = EXCLUDED.last_reps,
                    last_load_kg = EXCLUDED.last_load_kg,
                    last_distance_m = EXCLUDED.last_distance_m,
                    last_provenance = EXCLUDED.last_provenance,
                    updated_at = NOW()
                RETURNING evidence_count, status, model_version
                `,
                [
                    userId,
                    key,
                    activityId,
                    evidenceStatus || null,
                    extras.source || null,
                    split.duration_sec ?? split.durationSec ?? null,
                    split.reps ?? null,
                    split.load_kg ?? split.loadKg ?? null,
                    split.distance_m ?? split.distanceM ?? null,
                    JSON.stringify({ name: split.name }),
                ]
            );

            await query(
                `
                /* engine:insert_proficiency_history */
                INSERT INTO station_proficiency_history (
                    user_id, station_key, evidence_count, status, current_tier, peak_tier, model_version
                )
                SELECT user_id, station_key, evidence_count, status, current_tier, peak_tier, model_version
                FROM station_proficiency
                WHERE user_id = $1 AND station_key = $2
                `,
                [userId, key]
            );
            written += 1;
        } catch (error) {
            throwIfMissingRelation(error, 'station_proficiency');
        }
    }
    return written;
}

module.exports = { recordStationProficiency };
