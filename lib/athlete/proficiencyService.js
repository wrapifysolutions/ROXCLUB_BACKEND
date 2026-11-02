const { queryWithHardTimeout } = require('../dbQuery');
const { presentStationCatalog, TIER_PENDING } = require('./proficiencyPresenter');
const { STATION_KEYS } = require('./stationKeys');

function q(options) {
    return options?.query || ((sql, params) => queryWithHardTimeout(sql, params, 8000));
}

async function getStationProficiency(userId, options = {}) {
    const query = q(options);
    let rows = [];
    try {
        const result = await query(
            `
            /* engine:proficiency */
            SELECT station_key, evidence_count, status, score, score_status, model_version,
                   last_evidence_status, last_activity_id, current_tier, peak_tier, tier_status,
                   last_source, last_duration_sec, last_reps, last_load_kg, last_distance_m
            FROM station_proficiency
            WHERE user_id = $1
            ORDER BY station_key
            `,
            [userId]
        );
        rows = result.rows;
    } catch (error) {
        if (error.code !== '42P01' && error.code !== '42703') throw error;
    }
    return {
        athleteId: userId,
        pendingModel: true,
        reason: TIER_PENDING,
        stations: presentStationCatalog(rows),
        stationKeys: STATION_KEYS,
    };
}

module.exports = { getStationProficiency };
