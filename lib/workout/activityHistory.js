const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

function asObject(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return {};
    }
}

function encodeCursor(row) {
    return Buffer.from(
        JSON.stringify({
            startAt: row.start_at instanceof Date ? row.start_at.toISOString() : String(row.start_at),
            id: String(row.id),
        }),
        'utf8'
    ).toString('base64url');
}

function decodeCursor(cursor) {
    if (!cursor) return null;
    try {
        const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
        if (!parsed?.startAt || !parsed?.id) return null;
        return { startAt: String(parsed.startAt), id: String(parsed.id) };
    } catch (_) {
        return null;
    }
}

function toHistoryItem(row) {
    const result = asObject(row.result);
    return {
        activityId: row.id,
        sessionId: row.session_id || null,
        workoutId: row.workout_id || null,
        title: row.name,
        activityType: row.activity_type,
        startAt: row.start_at,
        endAt: row.end_at,
        durationSec: row.duration_sec == null ? null : Number(row.duration_sec),
        distanceM: row.distance_m == null ? null : Number(row.distance_m),
        avgHr: row.avg_hr == null ? null : Number(row.avg_hr),
        evidenceStatus: row.evidence_status || null,
        roxzoneTotalSec: Number(row.roxzone_total_sec) || 0,
        sources: Array.isArray(row.sources) ? row.sources : asObject(row.sources),
        totalXp: result.totalXp == null ? null : Number(result.totalXp),
        coinsEarned: result.coinsEarned == null ? null : Number(result.coinsEarned),
        completedCount: result.completedCount == null ? null : Number(result.completedCount),
        totalCount: result.totalCount == null ? null : Number(result.totalCount),
        subtitle: result.subtitle || null,
        sessionStatus: row.session_status || null,
    };
}

async function listActivityHistory(userId, options = {}) {
    if (!options.query) await ensureOnboardingProfileSchema();
    const query = options.query || queryWithHardTimeout;
    const safeLimit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    if (options.cursor && !cursor) {
        throw httpError('INVALID_CURSOR', 400, 'cursor is invalid');
    }

    const params = [userId];
    let where = 'a.user_id = $1';
    if (cursor) {
        params.push(cursor.startAt, cursor.id);
        where += ` AND (a.start_at, a.id) < ($2::timestamptz, $3::uuid)`;
    }
    params.push(safeLimit + 1);

    const { rows } = await query(
        `
        /* workout:activity_history */
        SELECT a.id, a.session_id, a.workout_id, a.name, a.activity_type, a.start_at, a.end_at,
               a.duration_sec, a.distance_m, a.avg_hr, a.evidence_status, a.roxzone_total_sec,
               a.sources, ws.result, ws.status AS session_status
        FROM activities a
        LEFT JOIN workout_sessions ws ON ws.id = a.session_id
        WHERE ${where}
        ORDER BY a.start_at DESC, a.id DESC
        LIMIT $${params.length}
        `,
        params,
        8000
    );

    const page = rows.slice(0, safeLimit);
    return {
        activities: page.map(toHistoryItem),
        nextCursor: rows.length > safeLimit ? encodeCursor(page[page.length - 1]) : null,
    };
}

module.exports = {
    listActivityHistory,
    toHistoryItem,
};
