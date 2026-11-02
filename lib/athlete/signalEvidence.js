const { throwIfMissingRelation } = require('../db/errors');

function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

async function recordVo2maxSample(userId, sample, query) {
    const value = finiteNumber(sample?.value);
    if (!userId || value == null) return null;
    const source = String(sample.source || '').trim();
    const externalId = sample.externalId == null ? null : String(sample.externalId);
    if (!source || !externalId) {
        const error = new Error('VO2max evidence needs a source and external id');
        error.code = 'INVALID_SIGNAL';
        error.status = 400;
        throw error;
    }
    try {
        const { rows } = await query(
            `
            /* engine:upsert_signal */
            INSERT INTO athlete_signal_evidence (
                user_id, signal_key, value_numeric, unit, source, external_id, credibility, provenance, captured_at
            )
            VALUES ($1, 'vo2max', $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8::timestamptz, NOW()))
            ON CONFLICT (user_id, signal_key, source, external_id) WHERE external_id IS NOT NULL
            DO UPDATE SET
                value_numeric = EXCLUDED.value_numeric,
                unit = EXCLUDED.unit,
                credibility = EXCLUDED.credibility,
                provenance = EXCLUDED.provenance,
                captured_at = EXCLUDED.captured_at
            RETURNING id, user_id, value_numeric
            `,
            [
                userId,
                value,
                sample.unit || null,
                source,
                externalId,
                sample.credibility || 'UNASSESSED',
                JSON.stringify({
                    policy: 'store_provider_vo2max_without_dna_scoring',
                    source,
                    externalId,
                }),
                sample.capturedAt || null,
            ]
        );
        return rows[0] || null;
    } catch (error) {
        throwIfMissingRelation(error, 'athlete_signal_evidence');
    }
}

async function recordRaceCalibrationEvidence(userId, race, query) {
    if (!userId || !race?.eventName) return null;
    const source = String(race.source || '').trim();
    if (!source || source === 'ARENA_VIRTUAL') {
        const error = new Error('Virtual race results are not real calibration evidence');
        error.code = 'VIRTUAL_RACE_NOT_CALIBRATION';
        error.status = 400;
        throw error;
    }
    const status = race.verificationStatus === 'verified' ? 'verified' : 'unverified';
    try {
        const { rows } = await query(
            `
            /* engine:upsert_race_calibration */
            INSERT INTO race_calibration_evidence (
                user_id, event_name, event_date, division, finish_time_sec,
                run_splits, station_splits, roxzone_sec, verification_status, source, provenance
            )
            VALUES ($1, $2, $3::date, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11::jsonb)
            ON CONFLICT (user_id, source, event_name, event_date)
            DO UPDATE SET
                division = EXCLUDED.division,
                finish_time_sec = EXCLUDED.finish_time_sec,
                run_splits = EXCLUDED.run_splits,
                station_splits = EXCLUDED.station_splits,
                roxzone_sec = EXCLUDED.roxzone_sec,
                verification_status = EXCLUDED.verification_status,
                provenance = EXCLUDED.provenance
            RETURNING id, user_id, verification_status
            `,
            [
                userId,
                race.eventName,
                race.eventDate || null,
                race.division || null,
                finiteNumber(race.finishTimeSec),
                JSON.stringify(race.runSplits || []),
                JSON.stringify(race.stationSplits || []),
                finiteNumber(race.roxzoneSec),
                status,
                source,
                JSON.stringify({
                    policy: 'store_race_evidence_without_dna_rewrite',
                    documentation: 'Product Master V2 §11',
                    source,
                }),
            ]
        );
        return rows[0] || null;
    } catch (error) {
        throwIfMissingRelation(error, 'race_calibration_evidence');
    }
}

module.exports = {
    recordVo2maxSample,
    recordRaceCalibrationEvidence,
};
