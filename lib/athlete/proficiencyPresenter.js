const { STATION_KEYS } = require('./stationKeys');

const TIER_PENDING = 'STATION_PROFICIENCY_TIERS_NOT_APPROVED';

function numberOrNull(value) {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function emptyStation(key) {
    return {
        key,
        evidenceCount: 0,
        status: 'CALIBRATING',
        currentTier: null,
        peakTier: null,
        tierStatus: 'PENDING_MODEL',
        score: null,
        scoreStatus: 'PENDING_MODEL',
        modelVersion: 'pending_v0',
        pendingModel: true,
        reason: TIER_PENDING,
        lastEvidence: null,
    };
}

function presentStation(row) {
    const key = row.station_key || row.key;
    const evidenceCount = Number(row.evidence_count || row.evidenceCount) || 0;
    return {
        key,
        evidenceCount,
        status: row.status || (evidenceCount > 0 ? 'CALIBRATING' : 'CALIBRATING'),
        currentTier: row.current_tier || row.currentTier || null,
        peakTier: row.peak_tier || row.peakTier || null,
        tierStatus: row.tier_status || row.tierStatus || 'PENDING_MODEL',
        score: null,
        scoreStatus: 'PENDING_MODEL',
        modelVersion: row.model_version || row.modelVersion || 'pending_v0',
        pendingModel: true,
        reason: TIER_PENDING,
        lastEvidenceStatus: row.last_evidence_status || row.lastEvidenceStatus || null,
        lastEvidence: row.last_activity_id
            ? {
                  activityId: row.last_activity_id,
                  source: row.last_source || null,
                  evidenceStatus: row.last_evidence_status || null,
                  durationSec: numberOrNull(row.last_duration_sec),
                  reps: numberOrNull(row.last_reps),
                  loadKg: numberOrNull(row.last_load_kg),
                  distanceM: numberOrNull(row.last_distance_m),
              }
            : null,
    };
}

function presentStationCatalog(rows = []) {
    const byKey = new Map(rows.map((row) => [row.station_key || row.key, presentStation(row)]));
    return STATION_KEYS.map((key) => byKey.get(key) || emptyStation(key));
}

module.exports = {
    TIER_PENDING,
    emptyStation,
    presentStation,
    presentStationCatalog,
};
