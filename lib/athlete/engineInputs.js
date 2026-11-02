const { queryWithHardTimeout } = require('../dbQuery');
const { simulationEngine } = require('../arena/engine');
const { loadAthleteDnaRow } = require('./dnaService');
const { presentAthleteDna, emptyDna, compactCoreValues } = require('./dnaPresenter');
const { attributeEvidenceCatalog } = require('./attributeEvidence');
const { getStationProficiency } = require('./proficiencyService');

async function loadDna(userId, query) {
    const row = await loadAthleteDnaRow(userId, query);
    return presentAthleteDna(row);
}

async function loadProficiency(userId, query) {
    const result = await getStationProficiency(userId, { query });
    return result.stations;
}

async function loadReadiness(userId, query) {
    try {
        const { rows } = await query(
            `
            /* arena:latest_readiness */
            SELECT score, status, confidence, model_version, local_date
            FROM daily_readiness
            WHERE user_id = $1
            ORDER BY local_date DESC
            LIMIT 1
            `,
            [userId]
        );
        if (!rows[0]) return null;
        return {
            status: rows[0].status,
            score: rows[0].score == null ? null : Number(rows[0].score),
            confidence: rows[0].confidence || null,
            modelVersion: rows[0].model_version || null,
            localDate: rows[0].local_date || null,
        };
    } catch (error) {
        if (error.code === '42P01') return null;
        throw error;
    }
}

async function loadRecentEvidence(userId, query) {
    try {
        const { rows } = await query(
            `
            /* engine:recent_activities */
            SELECT id, source, activity_type, evidence_status, duration_sec, distance_m, start_at
            FROM activities
            WHERE user_id = $1
            ORDER BY start_at DESC
            LIMIT 20
            `,
            [userId]
        );
        const confidenceRank = { HIGH: 3, MODERATE: 2, LOW: 1 };
        const mapped = rows.map((row) => ({
            id: row.id,
            source: row.source,
            type: row.activity_type,
            evidenceStatus: row.evidence_status,
            durationSec: row.duration_sec == null ? null : Number(row.duration_sec),
            distanceM: row.distance_m == null ? null : Number(row.distance_m),
        }));
        const { loadAssociatedLinks, collapseAssociated } = require('./identityLinks');
        const links = await loadAssociatedLinks(userId, query);
        const unique = collapseAssociated(mapped, links);
        const confidences = unique
            .map((row) => {
                if (row.evidenceStatus === 'VERIFIED') return 'HIGH';
                if (row.evidenceStatus === 'STANDARD') return 'MODERATE';
                return 'LOW';
            })
            .sort((left, right) => confidenceRank[left] - confidenceRank[right]);
        const running = unique.filter((row) => row.type === 'running' || row.type === 'run');
        return {
            sampleSize: unique.length,
            recentEvidenceConfidence: confidences[0] || null,
            sources: [...new Set(unique.map((row) => row.source))],
            running: {
                activityCount: running.length,
                totalDistanceM: running.reduce((sum, row) => sum + (row.distanceM || 0), 0),
            },
            activities: unique.slice(0, 5),
        };
    } catch (error) {
        if (error.code === '42P01') {
            return { sampleSize: 0, recentEvidenceConfidence: null, sources: [], running: { activityCount: 0, totalDistanceM: 0 }, activities: [] };
        }
        throw error;
    }
}

async function loadOptionalRows(query, sql, params) {
    try {
        const { rows } = await query(sql, params);
        return rows;
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return [];
        throw error;
    }
}

async function loadBodyweight(userId, query) {
    const rows = await loadOptionalRows(
        query,
        `
        /* engine:bodyweight */
        SELECT weight_kg
        FROM body_metrics
        WHERE user_id = $1
        `,
        [userId]
    );
    const weight = rows[0]?.weight_kg;
    return weight == null ? null : Number(weight);
}

async function loadVo2max(userId, query) {
    const rows = await loadOptionalRows(
        query,
        `
        /* engine:signal_evidence */
        SELECT value_numeric, unit, source, credibility, captured_at
        FROM athlete_signal_evidence
        WHERE user_id = $1 AND signal_key = 'vo2max'
        ORDER BY captured_at DESC
        LIMIT 1
        `,
        [userId]
    );
    if (!rows[0]) return null;
    return {
        value: rows[0].value_numeric == null ? null : Number(rows[0].value_numeric),
        unit: rows[0].unit || null,
        source: rows[0].source,
        credibility: rows[0].credibility || 'UNASSESSED',
        capturedAt: rows[0].captured_at,
        appliedToDna: false,
    };
}

async function loadRaceEvidence(userId, query) {
    const rows = await loadOptionalRows(
        query,
        `
        /* engine:race_calibration */
        SELECT event_name, event_date, division, finish_time_sec, verification_status, source
        FROM race_calibration_evidence
        WHERE user_id = $1
        ORDER BY event_date DESC NULLS LAST
        `,
        [userId]
    );
    return rows.map((row) => ({
        eventName: row.event_name,
        eventDate: row.event_date,
        division: row.division,
        finishTimeSec: row.finish_time_sec == null ? null : Number(row.finish_time_sec),
        verificationStatus: row.verification_status,
        source: row.source,
        appliedToDna: false,
    }));
}

async function loadEngineInputs(userId, extras = {}, options = {}) {
    const query = options.query || ((sql, params) => queryWithHardTimeout(sql, params, 8000));
    const [athleteDna, stationProficiency, readiness, recent, bodyweightKg, vo2max, raceEvidence] = await Promise.all([
        loadDna(userId, query),
        loadProficiency(userId, query),
        loadReadiness(userId, query),
        loadRecentEvidence(userId, query),
        loadBodyweight(userId, query),
        loadVo2max(userId, query),
        loadRaceEvidence(userId, query),
    ]);
    return {
        athleteId: userId,
        athleteDna,
        attributeMappings: attributeEvidenceCatalog(),
        bodyweightKg,
        vo2max,
        raceEvidence,
        stationProficiency,
        readiness,
        recentEvidenceConfidence: recent.recentEvidenceConfidence,
        runningEvidence: recent.running,
        recentActivities: recent.activities,
        sources: recent.sources,
        pacingStrategy: extras.pacingStrategy || 'target',
        fatigueModel: { available: false, reason: 'FATIGUE_MODEL_NOT_APPROVED' },
        simulationEngine: simulationEngine({
            athleteDna,
            stationProficiency,
            readiness,
            recentEvidenceConfidence: recent.recentEvidenceConfidence,
            pacingStrategy: extras.pacingStrategy || 'target',
            fatigueModel: { available: false, reason: 'FATIGUE_MODEL_NOT_APPROVED' },
        }),
        capturedAt: (options.now || new Date()).toISOString(),
        coreDnaValues: compactCoreValues(athleteDna),
    };
}

module.exports = {
    loadEngineInputs,
    emptyDna,
};
