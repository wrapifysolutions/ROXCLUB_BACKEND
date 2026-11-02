const { queryWithHardTimeout } = require('../dbQuery');
const { presentAthleteDna, emptyDna } = require('./dnaPresenter');
const { attributeEvidenceCatalog } = require('./attributeEvidence');

function q(options) {
    return options?.query || ((sql, params) => queryWithHardTimeout(sql, params, 8000));
}

async function loadAthleteDnaRow(userId, query) {
    try {
        const { rows } = await query(
            `
            /* engine:dna */
            SELECT status, model_version, strength, engine, endurance, power, speed, mobility,
                   peak_endurance, peak_engine, peak_strength, peak_power, peak_speed, peak_mobility
            FROM athlete_dna
            WHERE user_id = $1
            `,
            [userId]
        );
        return rows[0] || null;
    } catch (error) {
        if (error.code === '42703') {
            const { rows } = await query(
                `
                /* engine:dna */
                SELECT status, model_version, strength, engine, endurance, power, mobility
                FROM athlete_dna
                WHERE user_id = $1
                `,
                [userId]
            );
            return rows[0] || null;
        }
        if (error.code === '42P01') return null;
        throw error;
    }
}

async function loadDnaSnapshots(userId, query, limit = 20) {
    try {
        const { rows } = await query(
            `
            /* engine:dna_snapshots */
            SELECT model_version, status, endurance, engine, strength, power, speed, mobility, source, captured_at
            FROM athlete_dna_snapshots
            WHERE user_id = $1
            ORDER BY captured_at DESC
            LIMIT $2
            `,
            [userId, limit]
        );
        return rows.map((row) => ({
            modelVersion: row.model_version,
            status: row.status,
            endurance: row.endurance == null ? null : Number(row.endurance),
            engine: row.engine == null ? null : Number(row.engine),
            strength: row.strength == null ? null : Number(row.strength),
            power: row.power == null ? null : Number(row.power),
            speed: row.speed == null ? null : Number(row.speed),
            mobility: row.mobility == null ? null : Number(row.mobility),
            source: row.source,
            capturedAt: row.captured_at,
        }));
    } catch (error) {
        if (error.code === '42P01') return [];
        throw error;
    }
}

async function snapshotAthleteDna(userId, source, query) {
    try {
        await query(
            `
            /* engine:insert_dna_snapshot */
            INSERT INTO athlete_dna_snapshots (
                user_id, model_version, status, endurance, engine, strength, power, speed, mobility, source
            )
            SELECT user_id, model_version, status, endurance, engine, strength, power, speed, mobility, $2
            FROM athlete_dna
            WHERE user_id = $1
            `,
            [userId, source]
        );
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return;
        throw error;
    }
}

async function getAthleteDna(userId, options = {}) {
    const query = q(options);
    const row = await loadAthleteDnaRow(userId, query);
    const presented = presentAthleteDna(row);
    const history = await loadDnaSnapshots(userId, query);
    return {
        athleteId: userId,
        ...presented,
        attributeMappings: attributeEvidenceCatalog(),
        history,
    };
}

module.exports = {
    getAthleteDna,
    loadAthleteDnaRow,
    snapshotAthleteDna,
    emptyDna,
};
