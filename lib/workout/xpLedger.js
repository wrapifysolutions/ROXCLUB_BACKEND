const { xpConfig } = require('./xpService');
const { withSavepoint } = require('../db/savepoint');

function ledgerReason(reason) {
    return String(reason || 'xp').slice(0, 80);
}

function reversalReason(reason) {
    return ledgerReason(`rev:${reason}`);
}

function withRevision(reason, revision) {
    if (!revision || revision <= 1) return ledgerReason(reason);
    return ledgerReason(`${reason}#${revision}`);
}

function currentSeasonKey(instant) {
    const date = instant ? new Date(instant) : new Date();
    if (Number.isNaN(date.getTime())) return currentSeasonKey();
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isReversalReason(reason) {
    return String(reason || '').startsWith('rev:');
}

async function nextRevision(activityId, query) {
    try {
        const { rows } = await withSavepoint(query, 'xp_revision', () =>
            query(
                `
                /* workout:xp_revision */
                SELECT reason
                FROM xp_ledger
                WHERE activity_id = $1
                `,
                [activityId]
            )
        );
        let max = 0;
        for (const row of rows) {
            const reason = String(row.reason || '');
            if (isReversalReason(reason)) continue;
            const match = reason.match(/#(\d+)$/);
            max = Math.max(max, match ? Number(match[1]) : 1);
        }
        return max + (max > 0 ? 1 : 0) || 1;
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return 1;
        throw error;
    }
}

async function insertXpRows(userId, activityId, rows, query, options = {}) {
    if (!userId || !activityId || !rows?.length) return [];
    const revision = options.revision || 1;
    const seasonKey = options.seasonKey || currentSeasonKey(options.at);
    const written = [];
    for (const row of rows) {
        if (!row?.xp) continue;
        const reason = withRevision(row.reason, revision);
        try {
            await withSavepoint(query, 'insert_xp', () =>
                query(
                    `
                    /* workout:insert_xp */
                    /* engine:import_xp */
                    INSERT INTO xp_ledger (user_id, xp, reason, activity_id, calc_version)
                    VALUES ($1, $2, $3, $4, $5)
                    `,
                    [userId, row.xp, reason, activityId, xpConfig.calcVersion]
                )
            );
            written.push({ ...row, reason });
        } catch (error) {
            if (error.code === '23505') continue;
            if (error.code === '42P01' || error.code === '42703') return written;
            throw error;
        }
        try {
            await withSavepoint(query, 'insert_seasonal', () =>
                query(
                    `
                    /* workout:insert_seasonal */
                    INSERT INTO seasonal_points_ledger (
                        user_id, season_key, points, reason, activity_id, calc_version
                    )
                    VALUES ($1, $2, $3, $4, $5, $6)
                    `,
                    [userId, seasonKey, row.xp, reason, activityId, xpConfig.calcVersion]
                )
            );
        } catch (error) {
            if (error.code === '42P01' || error.code === '42703') continue;
            throw error;
        }
    }
    return written;
}

async function reverseActivityXp(userId, activityId, query, options = {}) {
    if (!userId || !activityId) return [];
    let rows = [];
    try {
        const result = await withSavepoint(query, 'load_xp', () =>
            query(
                `
                /* workout:load_xp_for_activity */
                SELECT reason, xp
                FROM xp_ledger
                WHERE user_id = $1 AND activity_id = $2
                `,
                [userId, activityId]
            )
        );
        rows = result.rows || [];
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return [];
        throw error;
    }

    const net = new Map();
    for (const row of rows) {
        const reason = String(row.reason || '');
        net.set(reason, (net.get(reason) || 0) + Number(row.xp) || 0);
    }

    const reversed = [];
    const seasonKey = options.seasonKey || currentSeasonKey(options.at);
    for (const [reason, amount] of net) {
        if (isReversalReason(reason) || !amount) continue;
        const revReason = reversalReason(reason);
        if (net.get(revReason)) continue;
        try {
            await withSavepoint(query, 'reverse_xp', () =>
                query(
                    `
                    /* workout:reverse_xp */
                    INSERT INTO xp_ledger (user_id, xp, reason, activity_id, calc_version)
                    VALUES ($1, $2, $3, $4, $5)
                    `,
                    [userId, -amount, revReason, activityId, xpConfig.calcVersion]
                )
            );
            reversed.push({ reason: revReason, xp: -amount });
        } catch (error) {
            if (error.code === '23505') continue;
            if (error.code === '42P01' || error.code === '42703') return reversed;
            throw error;
        }
        try {
            await withSavepoint(query, 'reverse_seasonal', () =>
                query(
                    `
                    /* workout:reverse_seasonal */
                    INSERT INTO seasonal_points_ledger (
                        user_id, season_key, points, reason, activity_id, calc_version
                    )
                    VALUES ($1, $2, $3, $4, $5, $6)
                    `,
                    [userId, seasonKey, -amount, revReason, activityId, xpConfig.calcVersion]
                )
            );
        } catch (error) {
            if (error.code === '42P01' || error.code === '42703') continue;
            throw error;
        }
    }
    return reversed;
}

async function replaceActivityXp(userId, activityId, rows, query, options = {}) {
    await reverseActivityXp(userId, activityId, query, options);
    const revision = await nextRevision(activityId, query);
    return insertXpRows(userId, activityId, rows, query, { ...options, revision: Math.max(revision, 2) });
}

async function loadSeasonalPoints(userId, query, seasonKey = currentSeasonKey()) {
    try {
        const { rows } = await query(
            `
            /* workout:seasonal_sum */
            SELECT COALESCE(SUM(points), 0)::int AS points
            FROM seasonal_points_ledger
            WHERE user_id = $1 AND season_key = $2
            `,
            [userId, seasonKey]
        );
        return { key: seasonKey, points: Number(rows[0]?.points) || 0 };
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') {
            return { key: seasonKey, points: 0 };
        }
        throw error;
    }
}

module.exports = {
    currentSeasonKey,
    insertXpRows,
    reverseActivityXp,
    replaceActivityXp,
    loadSeasonalPoints,
    nextRevision,
};
