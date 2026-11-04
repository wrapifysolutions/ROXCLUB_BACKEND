const { buildXp, totalXpOf } = require('../workout/xpService');
const { insertXpRows, replaceActivityXp } = require('../workout/xpLedger');

function startOfUtcDay(instant) {
    const date = instant ? new Date(instant) : new Date();
    if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
    return date.toISOString().slice(0, 10);
}

async function priorSessionsToday(userId, startAt, query) {
    try {
        const { rows } = await query(
            `
            /* engine:import_xp_prior */
            SELECT COUNT(DISTINCT activity_id)::int AS count
            FROM xp_ledger
            WHERE user_id = $1
              AND reason LIKE 'session_base%'
              AND created_at >= $2::date
              AND created_at < ($2::date + INTERVAL '1 day')
            `,
            [userId, startOfUtcDay(startAt)]
        );
        return Number(rows[0]?.count) || 0;
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return 0;
        throw error;
    }
}

async function activityXpNet(userId, activityId, query) {
    try {
        const { rows } = await query(
            `
            /* engine:import_xp_net */
            SELECT COALESCE(SUM(xp), 0)::int AS xp, COUNT(*)::int AS rows
            FROM xp_ledger
            WHERE user_id = $1 AND activity_id = $2
            `,
            [userId, activityId]
        );
        return { xp: Number(rows[0]?.xp) || 0, rows: Number(rows[0]?.rows) || 0 };
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return { xp: 0, rows: 0 };
        throw error;
    }
}

async function awardImportedActivityXp(userId, activityId, payload, query) {
    if (!userId || !activityId) return [];
    try {
        const { clusterAlreadyAwardedXp } = require('./identityLinks');
        if (await clusterAlreadyAwardedXp(userId, activityId, query)) return [];
    } catch (error) {
        if (error.code === 'DATABASE_NOT_READY' || error.code === '42P01' || error.code === '42703') {
            return [];
        }
        throw error;
    }

    const priorToday = await priorSessionsToday(userId, payload?.startAt, query);
    const rows = buildXp({
        workoutType: payload?.workoutType === 'recovery' ? 'recovery' : 'imported',
        partial: false,
        finishedWork: [{ name: payload?.activityType || payload?.name || 'workout' }],
        priorSessionsToday: priorToday,
        durationSec: payload?.durationSec,
        averageHr: payload?.avgHr,
    });
    const existing = await activityXpNet(userId, activityId, query);
    if (existing.rows > 0 && existing.xp === totalXpOf(rows)) return [];
    if (existing.rows > 0) {
        return replaceActivityXp(userId, activityId, rows, query, { at: payload?.startAt });
    }
    return insertXpRows(userId, activityId, rows, query, { at: payload?.startAt });
}

module.exports = { awardImportedActivityXp, startOfUtcDay };
