const { throwIfMissingRelation } = require('../db/errors');

function mapImportedType(sport) {
    const text = String(sport || '').toLowerCase();
    if (text.includes('run')) return 'running';
    if (text.includes('ride') || text.includes('cycl')) return 'cycling';
    if (text.includes('walk')) return 'walking';
    if (text.includes('row')) return 'rowing';
    if (text.includes('swim')) return 'swimming';
    if (text.includes('ski')) return 'workout';
    if (text.includes('workout') || text.includes('weight')) return 'workout';
    return 'other';
}

function provenanceEntry(source, externalId) {
    return {
        source,
        externalId: externalId == null ? null : String(externalId),
        capturedAt: new Date().toISOString(),
    };
}

async function upsertCanonicalImportedActivity(userId, payload, query) {
    if (!userId || !payload?.externalId || !payload.startAt) return null;
    const source = String(payload.source || '').toUpperCase();
    if (!source) return null;
    const type = mapImportedType(payload.activityType);
    const name = payload.name || `${source} ${type}`;
    const provenance = JSON.stringify([provenanceEntry(source, payload.externalId)]);
    const sources = JSON.stringify([source]);
    try {
        const { rows } = await query(
            `
            /* engine:upsert_canonical */
            INSERT INTO activities (
                user_id, source, sources, provenance, activity_type, name,
                start_at, end_at, duration_sec, distance_m, avg_hr, evidence_status, external_id
            )
            VALUES (
                $1, $2, $3::jsonb, $4::jsonb, $5, $6,
                $7, $8, $9, $10, $11, 'STANDARD', $12
            )
            ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL
            DO UPDATE SET
                name = EXCLUDED.name,
                activity_type = EXCLUDED.activity_type,
                start_at = EXCLUDED.start_at,
                end_at = EXCLUDED.end_at,
                duration_sec = EXCLUDED.duration_sec,
                distance_m = EXCLUDED.distance_m,
                avg_hr = EXCLUDED.avg_hr,
                updated_at = NOW()
            RETURNING id
            `,
            [
                userId,
                source,
                sources,
                provenance,
                type,
                name,
                payload.startAt,
                payload.endAt || null,
                payload.durationSec ?? null,
                payload.distanceM ?? null,
                payload.avgHr ?? null,
                String(payload.externalId),
            ]
        );
        const activityId = rows[0]?.id || null;
        if (activityId) {
            const { throwIfMissingRelation } = require('../db/errors');
const { proposeIdentityLinks } = require('./identityLinks');
            await proposeIdentityLinks(
                userId,
                {
                    id: activityId,
                    source,
                    startAt: payload.startAt,
                    durationSec: payload.durationSec,
                    activityType: type,
                },
                query
            ).catch((error) => {
                if (error.code === 'DATABASE_NOT_READY' || error.code === '42P01' || error.code === '42703') {
                    console.error('identity link propose skipped', error.message);
                    return;
                }
                throw error;
            });
        }
        return activityId;
    } catch (error) {
        throwIfMissingRelation(error, 'activities');
    }
}

module.exports = {
    mapImportedType,
    upsertCanonicalImportedActivity,
};
