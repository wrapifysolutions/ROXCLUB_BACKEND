const { sameWorkout, normalizeSession, DEDUPE_START_MS } = require('../readiness/readinessService');
const { throwIfMissingRelation } = require('../db/errors');

function orderedPair(left, right) {
    const a = String(left);
    const b = String(right);
    return a < b ? [a, b] : [b, a];
}

function asSession(row) {
    return normalizeSession({
        source: row.source,
        startAt: row.start_at || row.startAt,
        durationMin: Number(row.duration_sec ?? row.durationSec ?? 0) / 60,
        activityType: row.activity_type || row.activityType,
    });
}

function linkStatus(leftSource, rightSource) {
    const sources = [String(leftSource || '').toUpperCase(), String(rightSource || '').toUpperCase()];
    if (sources.includes('ROXCLUB_NATIVE')) return 'associated';
    return 'unresolved';
}

async function assertSameAthlete(userId, leftId, rightId, query) {
    const { rows } = await query(
        `
        /* engine:identity_owners */
        SELECT id, user_id
        FROM activities
        WHERE id = $1 OR id = $2
        `,
        [leftId, rightId]
    );
    if (rows.length !== 2 || rows.some((row) => String(row.user_id) !== String(userId))) {
        const error = new Error('Identity links must belong to one athlete');
        error.code = 'IDENTITY_CROSS_ATHLETE';
        error.status = 409;
        throw error;
    }
}

async function upsertLink(userId, leftId, rightId, status, extras, query) {
    if (!leftId || !rightId || leftId === rightId) return null;
    await assertSameAthlete(userId, leftId, rightId, query);
    const [activityA, activityB] = orderedPair(leftId, rightId);
    const { rows } = await query(
        `
        /* engine:insert_identity_link */
        INSERT INTO activity_identity_links (
            activity_a, activity_b, user_id, status, match_basis, provenance
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (activity_a, activity_b)
        DO UPDATE SET
            status = CASE
                WHEN activity_identity_links.status = 'rejected' THEN activity_identity_links.status
                WHEN activity_identity_links.status = 'associated' THEN activity_identity_links.status
                WHEN EXCLUDED.status = 'associated' THEN 'associated'
                ELSE activity_identity_links.status
            END,
            updated_at = NOW()
        RETURNING activity_a, activity_b, status
        `,
        [
            activityA,
            activityB,
            userId,
            status,
            extras.matchBasis || 'existing_same_workout_helper',
            JSON.stringify({
                policy: 'reuse_readiness_sameWorkout_no_destructive_merge',
                leftSource: extras.leftSource || null,
                rightSource: extras.rightSource || null,
            }),
        ]
    );
    return rows[0] || null;
}

async function proposeIdentityLinks(userId, activity, query) {
    if (!userId || !activity?.id || !activity.startAt) return [];
    const start = new Date(activity.startAt).getTime();
    if (!Number.isFinite(start)) return [];
    const from = new Date(start - DEDUPE_START_MS).toISOString();
    const to = new Date(start + DEDUPE_START_MS).toISOString();
    let neighbors = [];
    try {
        const result = await query(
            `
            /* engine:identity_neighbors */
            SELECT id, source, activity_type, start_at, duration_sec
            FROM activities
            WHERE user_id = $1 AND id <> $2 AND start_at >= $3 AND start_at <= $4
            `,
            [userId, activity.id, from, to]
        );
        neighbors = result.rows;
    } catch (error) {
        throwIfMissingRelation(error, 'activities');
    }
    const self = asSession({
        source: activity.source,
        startAt: activity.startAt,
        durationSec: activity.durationSec,
        activityType: activity.activityType,
    });
    if (!self) return [];
    const written = [];
    for (const neighbor of neighbors) {
        const other = asSession(neighbor);
        if (!other || !sameWorkout(self, other)) continue;
        const status = linkStatus(activity.source, neighbor.source);
        const row = await upsertLink(userId, activity.id, neighbor.id, status, {
            leftSource: activity.source,
            rightSource: neighbor.source,
        }, query);
        if (row) written.push(row);
    }
    return written;
}

async function associateNativeMatches(userId, nativeActivityId, matches, query) {
    if (!userId || !nativeActivityId || !Array.isArray(matches)) return [];
    const written = [];
    for (const match of matches) {
        if (!match?.externalId) continue;
        try {
            const { rows } = await query(
                `
                /* engine:identity_by_external */
                SELECT id, source
                FROM activities
                WHERE user_id = $1 AND UPPER(source) = UPPER($2) AND external_id = $3
                `,
                [userId, match.source, String(match.externalId)]
            );
            if (!rows[0]) continue;
            const row = await upsertLink(userId, nativeActivityId, rows[0].id, 'associated', {
                leftSource: 'ROXCLUB_NATIVE',
                rightSource: rows[0].source,
                matchBasis: 'native_complete_existing_import_match',
            }, query);
            if (row) written.push(row);
        } catch (error) {
            throwIfMissingRelation(error, 'activity_identity_links');
        }
    }
    return written;
}

async function clusterAlreadyAwardedXp(userId, activityId, query) {
    try {
        const { rows } = await query(
            `
            /* engine:cluster_xp */
            SELECT xl.activity_id
            FROM xp_ledger xl
            JOIN activity_identity_links l
              ON l.user_id = $1
             AND l.status = 'associated'
             AND (
                (l.activity_a = xl.activity_id AND l.activity_b = $2)
                OR (l.activity_b = xl.activity_id AND l.activity_a = $2)
             )
            WHERE xl.user_id = $1
            LIMIT 1
            `,
            [userId, activityId]
        );
        return Boolean(rows[0]);
    } catch (error) {
        throwIfMissingRelation(error, 'activity_identity_links');
    }
}

function collapseAssociated(activities, links) {
    const parent = new Map();
    const find = (id) => {
        if (!parent.has(id)) parent.set(id, id);
        if (parent.get(id) !== id) parent.set(id, find(parent.get(id)));
        return parent.get(id);
    };
    const union = (a, b) => {
        const pa = find(a);
        const pb = find(b);
        if (pa === pb) return;
        parent.set(pb, pa);
    };
    for (const link of links || []) {
        if (link.status !== 'associated') continue;
        union(String(link.activity_a), String(link.activity_b));
    }
    const byCluster = new Map();
    for (const activity of activities) {
        const key = find(String(activity.id));
        const existing = byCluster.get(key);
        if (!existing) {
            byCluster.set(key, activity);
            continue;
        }
        const prefer =
            String(activity.source).toUpperCase() === 'ROXCLUB_NATIVE' &&
            String(existing.source).toUpperCase() !== 'ROXCLUB_NATIVE';
        if (prefer) byCluster.set(key, activity);
    }
    return [...byCluster.values()];
}

async function loadAssociatedLinks(userId, query) {
    try {
        const { rows } = await query(
            `
            /* engine:identity_links_for_user */
            SELECT activity_a, activity_b, status
            FROM activity_identity_links
            WHERE user_id = $1 AND status = 'associated'
            `,
            [userId]
        );
        return rows;
    } catch (error) {
        throwIfMissingRelation(error, 'activity_identity_links');
    }
}

module.exports = {
    orderedPair,
    proposeIdentityLinks,
    associateNativeMatches,
    clusterAlreadyAwardedXp,
    collapseAssociated,
    loadAssociatedLinks,
    linkStatus,
};
