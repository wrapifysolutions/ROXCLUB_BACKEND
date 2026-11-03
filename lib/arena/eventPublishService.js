const { queryWithHardTimeout, withTransaction } = require('../dbQuery');
const { isMissingRelation } = require('../db/errors');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { assertApprovedCoach, assertAdmin } = require('../admin/coachReviewService');
const {
    DEFAULT_HYBRID_STATIONS,
    defaultByKey,
    defaultBySequence,
} = require('./defaultStations');
const { ensureArenaTables } = require('./ensureSchema');
const { httpError } = require('./times');
const {
    SEGMENT_TYPES,
    coachEventForm,
    parseCoachEvent,
    assertStationWork,
} = require('./eventContract');

const SEGMENT_TYPE_SET = new Set(SEGMENT_TYPES);

async function ready(options) {
    if (options?.query) return;
    await ensureOnboardingProfileSchema();
    await ensureArenaTables(options);
}

function q(options) {
    return options?.query || ((sql, params) => queryWithHardTimeout(sql, params, 8000));
}

function transact(options, work) {
    if (options?.query) return work(options.query);
    return withTransaction((client) => work((sql, params) => client.query(sql, params)));
}

function clean(value, max) {
    return String(value || '').trim().slice(0, max);
}

function slugify(title) {
    const base = clean(title, 160)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return base || 'arena-event';
}

function publishStatus(startsAt, endsAt, now) {
    if (startsAt && now < startsAt) return 'upcoming';
    if (endsAt && now > endsAt) return 'closed';
    return 'open';
}

function firstNumber(...values) {
    for (const value of values) {
        if (value == null || value === '') continue;
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function stationResponse(row) {
    return {
        sequence: Number(row.sequence),
        type: row.segment_type,
        key: row.station_key,
        title: row.title,
        distanceM: row.distance_m == null ? null : Number(row.distance_m),
        repetitions: row.repetitions == null ? null : Number(row.repetitions),
        loadKg: row.load_kg == null ? null : Number(row.load_kg),
        instructions: row.instructions || '',
    };
}

function normalizeStation(item, index, seen) {
    const key = clean(item.station_key || item.key, 80);
    const fallback = defaultByKey(key) || defaultBySequence(item.sequence) || {};
    const sequence = Number(item.sequence || fallback.sequence || index + 1);
    const type = String(item.segment_type || item.type || fallback.segment_type || 'station')
        .trim()
        .toLowerCase();
    const title = clean(item.title, 120) || fallback.title || key;
    if (!Number.isInteger(sequence) || sequence < 1) {
        throw httpError('INVALID_STATION', 400, 'Each station needs a sequence');
    }
    if (!SEGMENT_TYPE_SET.has(type)) {
        throw httpError('INVALID_STATION', 400, 'station type must be run, station, or roxzone');
    }
    if (!key || !title) {
        throw httpError('INVALID_STATION', 400, 'Each station needs a key and title');
    }
    if (seen.has(sequence)) {
        throw httpError('INVALID_STATION', 400, 'Station sequence must be unique');
    }
    seen.add(sequence);
    return {
        sequence,
        segment_type: type,
        station_key: key,
        title,
        distance_m: firstNumber(item.distance_m, item.distanceM, fallback.distance_m),
        repetitions: firstNumber(item.repetitions, fallback.repetitions),
        load_kg: firstNumber(item.load_kg, item.loadKg, fallback.load_kg),
        instructions: clean(item.instructions, 2000) || fallback.instructions || '',
    };
}

function parseStations(raw) {
    const seen = new Set();
    if (!Array.isArray(raw) || raw.length === 0) {
        return DEFAULT_HYBRID_STATIONS.map((item, index) => normalizeStation(item, index, seen));
    }

    const merged = new Map(DEFAULT_HYBRID_STATIONS.map((row) => [row.sequence, { ...row }]));
    raw.forEach((item, index) => {
        const key = clean(item.station_key || item.key, 80);
        const sequence = Number(item.sequence) || defaultByKey(key)?.sequence || index + 1;
        const base = merged.get(sequence) || defaultByKey(key) || {};
        merged.set(sequence, { ...base, ...item, sequence, station_key: key || base.station_key });
    });

    return [...merged.values()]
        .sort((left, right) => Number(left.sequence) - Number(right.sequence))
        .map((item, index) => normalizeStation(item, index, seen));
}

function eventDto(row, extras = {}) {
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description || '',
        imageKey: row.image_key || null,
        location: row.location || '',
        eventType: row.event_type,
        sportType: row.sport_type || null,
        visibility: row.visibility || 'public',
        timezone: row.timezone || 'UTC',
        maxParticipants: row.max_participants == null ? null : Number(row.max_participants),
        division: row.division,
        category: row.category,
        difficulty: row.difficulty || null,
        status: row.status,
        reviewStatus: row.review_status || 'pending',
        startsAt: row.starts_at || null,
        endsAt: row.ends_at || null,
        publishedAt: row.published_at || null,
        createdByUserId: row.created_by_user_id || null,
        rejectionReason: row.rejection_reason || null,
        versionId: row.version_id || extras.versionId || null,
        versionNo: row.version_no == null ? extras.versionNo || null : Number(row.version_no),
        stations: extras.stations ? extras.stations.map(stationResponse) : undefined,
        visibleToAthletes: Boolean(row.published_at) && row.status !== 'draft',
    };
}

function dbMissing(error) {
    return isMissingRelation(error) || error.code === '42P01' || error.code === '42703';
}

function notReady() {
    return httpError(
        'DATABASE_NOT_READY',
        503,
        'Arena event tables are not migrated yet. Run scripts/migrate.js with explicit approval.'
    );
}

async function createCoachEvent(userId, body, options = {}) {
    await ready(options);
    await assertApprovedCoach(userId, options);
    const draft = parseCoachEvent(body);
    const stations = parseStations(body?.stations);
    stations.forEach(assertStationWork);
    const rules = {
        aboutRules: draft.aboutRules,
        overview: draft.aboutRules,
        generalRules: draft.generalRules,
        categoryLoads: draft.categoryLoads,
        formatSummary: draft.formatSummary,
        orderFixed: draft.orderFixed,
        movementStandards: draft.movementStandards,
        requiredWork: draft.requiredWork,
        evidence: draft.evidence,
        roxzone: draft.roxzone,
        penalties: draft.penalties,
        sportType: draft.sportType,
    };

    try {
        return await transact(options, async (query) => {
            const slugBase = slugify(body?.slug || draft.title);
            const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
            const inserted = await query(
                `
                /* arena:coach_insert_event */
                INSERT INTO arena_events (
                    slug, title, description, image_key, location, event_type, division,
                    category, difficulty, club_id, created_by_user_id, review_status,
                    status, starts_at, ends_at, sport_type, visibility, timezone, max_participants
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending','draft',$12,$13,$14,$15,$16,$17)
                RETURNING *
                `,
                [
                    slug,
                    draft.title,
                    draft.description,
                    draft.imageKey,
                    draft.location,
                    draft.eventType,
                    draft.division,
                    draft.category,
                    draft.difficulty,
                    draft.clubId,
                    userId,
                    draft.startsAt,
                    draft.endsAt,
                    draft.sportType,
                    draft.visibility,
                    draft.timezone,
                    draft.maxParticipants,
                ]
            );
            const event = inserted.rows[0];
            const version = await query(
                `
                /* arena:coach_insert_version */
                INSERT INTO arena_event_versions (
                    event_id, version_no, format_key, estimated_duration_ms, rules
                )
                VALUES ($1, 1, $2, $3, $4::jsonb)
                RETURNING *
                `,
                [
                    event.id,
                    draft.formatKey,
                    draft.estimatedDurationMs,
                    JSON.stringify(rules),
                ]
            );
            for (const station of stations) {
                await query(
                    `
                    /* arena:coach_insert_station */
                    INSERT INTO arena_event_stations (
                        version_id, sequence, segment_type, station_key, title,
                        distance_m, repetitions, load_kg, instructions
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                    `,
                    [
                        version.rows[0].id,
                        station.sequence,
                        station.segment_type,
                        station.station_key,
                        station.title,
                        Number.isFinite(station.distance_m) ? station.distance_m : null,
                        Number.isFinite(station.repetitions) ? station.repetitions : null,
                        Number.isFinite(station.load_kg) ? station.load_kg : null,
                        station.instructions,
                    ]
                );
            }
            return {
                event: eventDto(event, {
                    versionId: version.rows[0].id,
                    versionNo: 1,
                    stations,
                }),
                reviewStatus: 'pending',
                visibleToAthletes: false,
                message: 'Event submitted. An admin must publish it before athletes can see it.',
            };
        });
    } catch (error) {
        if (dbMissing(error)) throw notReady();
        if (error.status) throw error;
        throw error;
    }
}

async function listCoachEvents(userId, options = {}) {
    await ready(options);
    await assertApprovedCoach(userId, options);
    const query = q(options);
    try {
        const { rows } = await query(
            `
            /* arena:coach_list_events */
            SELECT e.*, v.id AS version_id, v.version_no
            FROM arena_events e
            LEFT JOIN LATERAL (
                SELECT id, version_no
                FROM arena_event_versions
                WHERE event_id = e.id
                ORDER BY version_no DESC
                LIMIT 1
            ) v ON TRUE
            WHERE e.created_by_user_id = $1
            ORDER BY e.created_at DESC
            `,
            [userId]
        );
        return { events: rows.map((row) => eventDto(row)) };
    } catch (error) {
        if (dbMissing(error)) return { events: [] };
        throw error;
    }
}

async function listAdminEvents(actorId, status, options = {}) {
    await ready(options);
    const query = q(options);
    await assertAdmin(actorId, query);
    const filter = status || 'pending';
    try {
        const { rows } = await query(
            `
            /* arena:admin_list_events */
            SELECT e.*, v.id AS version_id, v.version_no
            FROM arena_events e
            LEFT JOIN LATERAL (
                SELECT id, version_no
                FROM arena_event_versions
                WHERE event_id = e.id
                ORDER BY version_no DESC
                LIMIT 1
            ) v ON TRUE
            WHERE ($1::text = 'all' OR e.review_status = $1)
            ORDER BY e.created_at DESC
            `,
            [filter]
        );
        return { events: rows.map((row) => eventDto(row)) };
    } catch (error) {
        if (dbMissing(error)) return { events: [] };
        throw error;
    }
}

async function reviewCoachEvent(actorId, eventId, action, body, options = {}) {
    await ready(options);
    const now = options.now || new Date();
    return transact(options, async (query) => {
        await assertAdmin(actorId, query);
        let rows;
        try {
            ({ rows } = await query(
                `
                /* arena:admin_load_event */
                SELECT *
                FROM arena_events
                WHERE id = $1
                `,
                [eventId]
            ));
        } catch (error) {
            if (dbMissing(error)) throw notReady();
            throw error;
        }
        const event = rows[0];
        if (!event) throw httpError('EVENT_NOT_FOUND', 404, 'Arena event not found');
        if (action === 'publish') {
            if (event.review_status === 'rejected') {
                throw httpError('INVALID_STATUS', 409, 'A rejected event cannot be published');
            }
            const status = publishStatus(
                event.starts_at ? new Date(event.starts_at) : null,
                event.ends_at ? new Date(event.ends_at) : null,
                now
            );
            const updated = await query(
                `
                /* arena:admin_publish */
                UPDATE arena_events
                SET review_status = 'approved',
                    status = $3,
                    published_at = NOW(),
                    reviewed_by = $2,
                    reviewed_at = NOW(),
                    rejection_reason = NULL,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *
                `,
                [eventId, actorId, status]
            );
            return {
                event: eventDto(updated.rows[0]),
                visibleToAthletes: true,
                message: 'Event published. Athletes can now see it on Arena Home.',
            };
        }
        if (action === 'reject') {
            const reason = clean(body?.reason, 400);
            const updated = await query(
                `
                /* arena:admin_reject */
                UPDATE arena_events
                SET review_status = 'rejected',
                    status = 'draft',
                    published_at = NULL,
                    reviewed_by = $2,
                    reviewed_at = NOW(),
                    rejection_reason = $3,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *
                `,
                [eventId, actorId, reason || null]
            );
            return {
                event: eventDto(updated.rows[0]),
                visibleToAthletes: false,
                message: 'Event rejected. Athletes will not see it.',
            };
        }
        throw httpError('INVALID_ACTION', 400, 'Unsupported review action');
    });
}

module.exports = {
    createCoachEvent,
    listCoachEvents,
    listAdminEvents,
    reviewCoachEvent,
    coachEventForm,
};
