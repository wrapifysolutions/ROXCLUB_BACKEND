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
                    durationSec: split.duration_sec,
                    distanceM: split.distance_m,
                    reps: split.reps,
                    loadKg: split.load_kg,
                    paceSecPerKm: split.pace_sec_per_km,
                    splitSecPer500m: split.split_sec_per_500m,
                    repRate: split.rep_rate,
                    avgHr: split.avg_hr,
                    inputMethod: split.input_method,
                    data: split.data || {},
                }),
            ]
        );
    }
    return splits.length;
}

async function runStationEvidence(activityId, query) {
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
    return stations.length;
}

module.exports = { runDnaEvidence, runStationEvidence };
