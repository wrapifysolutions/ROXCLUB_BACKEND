const { throwIfMissingRelation } = require('../db/errors');
const { pendingAttributeMapping } = require('../athlete/attributeEvidence');

async function loadSplits(activityId, query) {
    const { rows } = await query(
        `
        /* workout:evidence_splits */
        SELECT activity_index, kind, name, duration_sec, distance_m, reps, load_kg,
               pace_sec_per_km, split_sec_per_500m, rep_rate, avg_hr, input_method, data
        FROM activity_splits
        WHERE activity_id = $1
        ORDER BY activity_index
        `,
        [activityId]
    );
    return rows;
}

async function runDnaEvidence(activityId, query) {
    try {
        const splits = await loadSplits(activityId, query);
        for (const split of splits) {
            await query(
                `
                /* workout:insert_dna_evidence */
                INSERT INTO activity_evidence (activity_id, activity_index, kind, name, payload)
                VALUES ($1, $2, $3, $4, $5::jsonb)
                ON CONFLICT (activity_id, activity_index) DO NOTHING
                `,
                [
                    activityId,
                    split.activity_index,
                    split.kind,
                    split.name,
                    JSON.stringify({
                        durationSec: split.duration_sec ?? null,
                        distanceM: split.distance_m ?? null,
                        reps: split.reps ?? null,
                        loadKg: split.load_kg ?? null,
                        paceSecPerKm: split.pace_sec_per_km ?? null,
                        splitSecPer500m: split.split_sec_per_500m ?? null,
                        repRate: split.rep_rate ?? null,
                        avgHr: split.avg_hr ?? null,
                        inputMethod: split.input_method || null,
                        sets: split.data?.sets || null,
                        attributeMapping: pendingAttributeMapping(),
                        provenance: {
                            activityId,
                            activityIndex: split.activity_index,
                            kind: split.kind,
                            name: split.name,
                        },
                        data: split.data || {},
                    }),
                ]
            );
        }
        return splits.length;
    } catch (error) {
        throwIfMissingRelation(error, 'activity_evidence');
    }
}

async function loadActivityOwner(activityId, query) {
    const { rows } = await query(
        `
        /* workout:load_activity_owner */
        SELECT user_id, evidence_status
        FROM activities
        WHERE id = $1
        `,
        [activityId]
    );
    return rows[0] || null;
}

async function runStationEvidence(activityId, query) {
    try {
        const splits = await loadSplits(activityId, query);
        const stations = splits.filter((split) => split.kind === 'station');
        for (const split of stations) {
            await query(
                `
                /* workout:insert_station_evidence */
                INSERT INTO station_evidence (
                    activity_id, activity_index, name, duration_sec, reps, load_kg, payload
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
                ON CONFLICT (activity_id, activity_index) DO NOTHING
                `,
                [
                    activityId,
                    split.activity_index,
                    split.name,
                    split.duration_sec,
                    split.reps,
                    split.load_kg,
                    JSON.stringify(split.data || {}),
                ]
            );
        }
        const owner = await loadActivityOwner(activityId, query);
        if (owner?.user_id && stations.length > 0) {
            const { recordStationProficiency } = require('../athlete/proficiency');
            await recordStationProficiency(
                owner.user_id,
                activityId,
                stations,
                owner.evidence_status,
                query
            );
        }
        return stations.length;
    } catch (error) {
        throwIfMissingRelation(error, 'station_evidence');
    }
}

module.exports = { runDnaEvidence, runStationEvidence };
