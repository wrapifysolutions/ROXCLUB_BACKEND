const { queryWithHardTimeout } = require('../dbQuery');
const { isMissingRelation } = require('../db/errors');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { simulationEngine } = require('./engine');
const { ensureArenaTables } = require('./ensureSchema');
const { httpError, parseClock, parsePace, displayTime, displayPace } = require('./times');
const { athleteRulesTemplate } = require('./rulesTemplate');

const PAGE_MAX = 50;
const PACING = new Set(['conservative', 'target', 'aggressive']);
const GENDER_MEN = new Set(['male', 'man', 'm']);
const GENDER_WOMEN = new Set(['female', 'woman', 'f']);

async function ready(options) {
    if (options?.query) return;
    await ensureOnboardingProfileSchema();
    await ensureArenaTables(options);
}

function q(options) {
    return options?.query || ((sql, params) => queryWithHardTimeout(sql, params, 8000));
}

function page(query) {
    const limit = Math.min(PAGE_MAX, Math.max(1, Number(query?.limit) || 20));
    const offset = Math.max(0, Number(query?.offset) || 0);
    return { limit, offset };
}

function eventStatus(row, now = new Date()) {
    const stored = row.status;
    if (stored === 'draft' || stored === 'closed') return stored;
    const start = row.starts_at ? new Date(row.starts_at) : null;
    const end = row.ends_at ? new Date(row.ends_at) : null;
    if (start && now < start) return 'upcoming';
    if (end && now > end) return 'closed';
    if (stored === 'open' || stored === 'upcoming') {
        if (start && end && now >= start && now <= end) return 'open';
        return stored;
    }
    return stored;
}

function eventCard(row, now) {
    const status = eventStatus(row, now);
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        imageKey: row.image_key || null,
        location: row.location || '',
        startsAt: row.starts_at || null,
        endsAt: row.ends_at || null,
        eventType: row.event_type,
        sportType: row.sport_type || null,
        visibility: row.visibility || 'public',
        division: row.division,
        category: row.category,
        difficulty: row.difficulty || null,
        status,
        clubRestricted: Boolean(row.club_id),
        versionId: row.version_id || null,
        versionNo: row.version_no || null,
    };
}

function stationDto(row) {
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

async function loadUser(userId, query) {
    const { rows } = await query(
        `
        /* arena:load_user */
        SELECT id, email, display_name, gender, account_type, onboarding_completed
        FROM users
        WHERE id = $1
        `,
        [userId]
    );
    if (!rows[0]) throw httpError('USER_NOT_FOUND', 404, 'User not found');
    return rows[0];
}

function assertAthlete(user) {
    if (user.account_type === 'admin') {
        throw httpError('ROLE_NOT_ALLOWED', 403, 'Admin accounts cannot join Arena events here');
    }
}

const LIST_EVENTS_SQL = `
        /* arena:list_events */
        SELECT
            e.*,
            v.id AS version_id,
            v.version_no,
            v.format_key,
            v.estimated_duration_ms,
            v.frozen_at
        FROM arena_events e
        LEFT JOIN LATERAL (
            SELECT id, version_no, format_key, estimated_duration_ms, frozen_at
            FROM arena_event_versions
            WHERE event_id = e.id
            ORDER BY version_no DESC
            LIMIT 1
        ) v ON TRUE
        WHERE e.status <> 'draft'
          AND e.published_at IS NOT NULL
        ORDER BY e.starts_at NULLS LAST, e.title
        `;

async function listedEvents(query, now) {
    try {
        const { rows } = await query(LIST_EVENTS_SQL);
        return rows.map((row) => eventCard(row, now));
    } catch (error) {
        if (error.code === '42P01') return [];
        throw error;
    }
}

async function getArenaHome(userId, options = {}) {
    await ready(options);
    const query = q(options);
    const now = options.now || new Date();
    const events = await listedEvents(query, now);
    const featured = events.filter((event) => event.status === 'open').slice(0, 3);
    let eligibility = null;
    if (userId) {
        const user = await loadUser(userId, query);
        eligibility = {
            authenticated: true,
            onboardingCompleted: Boolean(user.onboarding_completed),
            accountType: user.account_type || null,
            clubRequired: false,
            programActiveDoesNotBlock: true,
        };
    }
    return {
        featured,
        events,
        shortcuts: {
            leaderboard: '/api/arena/leaderboard',
            history: '/api/arena/history',
        },
        eligibility,
        simulationEngine: simulationEngine(),
    };
}

async function listEvents(options = {}) {
    await ready(options);
    const now = options.now || new Date();
    const events = await listedEvents(q(options), now);
    return { events };
}

async function loadPublishedEvent(eventId, query) {
    let rows;
    try {
        ({ rows } = await query(
        `
        /* arena:load_event */
        SELECT
            e.*,
            v.id AS version_id,
            v.version_no,
            v.format_key,
            v.estimated_duration_ms,
            v.rules,
            v.frozen_at
        FROM arena_events e
        LEFT JOIN LATERAL (
            SELECT id, version_no, format_key, estimated_duration_ms, rules, frozen_at
            FROM arena_event_versions
            WHERE event_id = e.id
            ORDER BY version_no DESC
            LIMIT 1
        ) v ON TRUE
        WHERE e.id = $1
          AND e.status <> 'draft'
          AND e.published_at IS NOT NULL
        `,
        [eventId]
        ));
    } catch (error) {
        if (isMissingRelation(error)) {
            throw httpError('EVENT_NOT_FOUND', 404, 'Arena event not found');
        }
        throw error;
    }
    if (!rows[0] || !rows[0].version_id) {
        throw httpError('EVENT_NOT_FOUND', 404, 'Arena event not found');
    }
    return rows[0];
}

async function loadStations(versionId, query) {
    const { rows } = await query(
        `
        /* arena:list_stations */
        SELECT sequence, segment_type, station_key, title, distance_m, repetitions, load_kg, instructions
        FROM arena_event_stations
        WHERE version_id = $1
        ORDER BY sequence
        `,
        [versionId]
    );
    return rows.map(stationDto);
}

async function getEvent(eventId, userId, options = {}) {
    await ready(options);
    const query = q(options);
    const now = options.now || new Date();
    const row = await loadPublishedEvent(eventId, query);
    const stations = await loadStations(row.version_id, query);
    const card = eventCard(row, now);
    let participation = null;
    if (userId) {
        const { rows } = await query(
            `
            /* arena:load_participation */
            SELECT id, status, event_version_id, joined_at
            FROM arena_participants
            WHERE event_id = $1 AND user_id = $2
            `,
            [eventId, userId]
        );
        if (rows[0]) {
            participation = {
                id: rows[0].id,
                status: rows[0].status,
                eventVersionId: rows[0].event_version_id,
                joinedAt: rows[0].joined_at,
            };
        }
    }
    const rules = row.rules && typeof row.rules === 'object' ? row.rules : {};
    return {
        event: {
            ...card,
            description: row.description || '',
            estimatedDuration: displayTime(
                row.estimated_duration_ms == null ? null : Number(row.estimated_duration_ms)
            ),
            overview: rules.overview || '',
            format: {
                key: row.format_key,
                versionNo: row.version_no,
                frozenAt: row.frozen_at,
                summary: rules.formatSummary || '',
            },
            stations,
            tabs: ['overview', 'format', 'stations', 'rules'],
        },
        participation,
        simulationEngine: simulationEngine(),
    };
}

async function getEventRules(eventId, options = {}) {
    await ready(options);
    const query = q(options);
    const row = await loadPublishedEvent(eventId, query);
    const stations = await loadStations(row.version_id, query);
    const rules = row.rules && typeof row.rules === 'object' ? row.rules : {};
    return athleteRulesTemplate({ event: row, rules, stations });
}

async function latestReadiness(userId, query) {
    try {
        const { rows } = await query(
            `
            /* arena:latest_readiness */
            SELECT score, status, confidence, local_date
            FROM daily_readiness
            WHERE user_id = $1
            ORDER BY local_date DESC
            LIMIT 1
            `,
            [userId]
        );
        return rows[0] || null;
    } catch (error) {
        if (error.code === '42P01') return null;
        throw error;
    }
}

async function joinEvent(userId, eventId, options = {}) {
    await ready(options);
    const query = q(options);
    const now = options.now || new Date();
    const user = await loadUser(userId, query);
    assertAthlete(user);
    const event = await loadPublishedEvent(eventId, query);
    const status = eventStatus(event, now);
    if (status !== 'open') {
        throw httpError('EVENT_NOT_OPEN', 409, 'This event is not open for participation');
    }
    if (event.club_id) {
        const { rows: memberships } = await query(
            `
            /* arena:club_membership */
            SELECT id
            FROM club_memberships
            WHERE club_id = $1 AND athlete_user_id = $2 AND status = 'accepted'
            `,
            [event.club_id, userId]
        );
        if (!memberships[0]) {
            throw httpError('CLUB_REQUIRED', 403, 'This event is limited to accepted club members');
        }
    }
    try {
        const inserted = await query(
            `
            /* arena:join */
            INSERT INTO arena_participants (event_id, event_version_id, user_id, status, joined_at, updated_at)
            VALUES ($1, $2, $3, 'joined', NOW(), NOW())
            RETURNING *
            `,
            [eventId, event.version_id, userId]
        );
        return {
            participant: {
                id: inserted.rows[0].id,
                eventId,
                eventVersionId: event.version_id,
                status: 'joined',
                joinedAt: inserted.rows[0].joined_at,
            },
            programActiveDoesNotBlock: true,
        };
    } catch (error) {
        if (error.code === '23505') {
            throw httpError('ALREADY_JOINED', 409, 'You have already joined this event');
        }
        throw error;
    }
}

async function loadOwnParticipation(userId, eventId, query) {
    let rows;
    try {
        ({ rows } = await query(
        `
        /* arena:load_participation */
        SELECT id, status, event_version_id, user_id, event_id, joined_at
        FROM arena_participants
        WHERE event_id = $1 AND user_id = $2
        `,
        [eventId, userId]
        ));
    } catch (error) {
        if (isMissingRelation(error)) {
            throw httpError('NOT_JOINED', 404, 'Join the event before saving a race strategy');
        }
        throw error;
    }
    if (!rows[0]) throw httpError('NOT_JOINED', 404, 'Join the event before saving a race strategy');
    return rows[0];
}

function validationState({ goalTimeMs, runPaceMsPerKm, stationTargets, eventStations }) {
    const issues = [];
    if (goalTimeMs != null && runPaceMsPerKm != null) {
        issues.push({
            code: 'GOAL_PACE_NOT_RECONCILED',
            message: 'Goal time and run pace are stored separately. No approved pacing model exists to make them match.',
        });
    }
    const allowed = new Set(eventStations.filter((row) => row.type === 'station').map((row) => row.key));
    for (const key of Object.keys(stationTargets || {})) {
        if (!allowed.has(key)) {
            issues.push({
                code: 'UNKNOWN_STATION',
                message: `Station ${key} is not part of this event version`,
            });
        }
    }
    const blocking = issues.filter((item) => item.code === 'UNKNOWN_STATION');
    return {
        status: blocking.length ? 'invalid' : 'accepted',
        reconciled: false,
        predictionAvailable: false,
        issues,
    };
}

function parseStationTargets(body, eventStations) {
    const raw = body?.stationTargets || body?.splits || {};
    if (raw && typeof raw !== 'object') {
        throw httpError('INVALID_SPLITS', 400, 'stationTargets must be an object of station keys to target times');
    }
    const allowed = new Set(eventStations.filter((row) => row.type === 'station').map((row) => row.key));
    const targets = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!allowed.has(key)) {
            throw httpError('UNKNOWN_STATION', 400, `Station ${key} is not part of this event version`);
        }
        const time = value && typeof value === 'object' ? value.targetTime || value.clock || value.milliseconds : value;
        targets[key] = { targetMs: parseClock(time, { field: `stationTargets.${key}` }) };
    }
    return targets;
}

async function getStrategy(userId, eventId, options = {}) {
    await ready(options);
    const query = q(options);
    const participant = await loadOwnParticipation(userId, eventId, query);
    const stations = await loadStations(participant.event_version_id, query);
    const { rows } = await query(
        `
        /* arena:load_strategy */
        SELECT *
        FROM arena_race_strategies
        WHERE participant_id = $1
        `,
        [participant.id]
    );
    const row = rows[0];
    const targets = row?.station_targets || {};
    return {
        eventId,
        participantId: participant.id,
        eventVersionId: participant.event_version_id,
        strategyVersion: row ? Number(row.strategy_version) : 0,
        goalTime: displayTime(row?.goal_time_ms == null ? null : Number(row.goal_time_ms)),
        runPace: displayPace(row?.run_pace_ms_per_km == null ? null : Number(row.run_pace_ms_per_km)),
        pacingStrategy: row?.pacing_strategy || 'target',
        stationTargets: targets,
        racePlan: stations.map((station) => ({
            ...station,
            target: station.type === 'station' ? targets[station.key] || null : null,
        })),
        validation: row?.validation || { status: 'empty', predictionAvailable: false, issues: [] },
        simulationEngine: simulationEngine({ pacingStrategy: row?.pacing_strategy }),
    };
}

async function saveStrategy(userId, eventId, body, options = {}) {
    await ready(options);
    const query = q(options);
    const user = await loadUser(userId, query);
    assertAthlete(user);
    const participant = await loadOwnParticipation(userId, eventId, query);
    if (participant.status === 'completed') {
        throw httpError('STRATEGY_LOCKED', 409, 'A completed race strategy cannot be edited');
    }
    const stations = await loadStations(participant.event_version_id, query);
    const { rows: existingRows } = await query(
        `
        /* arena:load_strategy */
        SELECT *
        FROM arena_race_strategies
        WHERE participant_id = $1
        `,
        [participant.id]
    );
    const existing = existingRows[0] || {};
    const goalTimeMs =
        body?.goalTime == null && body?.goalTimeMs == null
            ? existing.goal_time_ms == null
                ? null
                : Number(existing.goal_time_ms)
            : parseClock(body.goalTime ?? body.goalTimeMs, { field: 'goalTime' });
    const runPaceMsPerKm =
        body?.runPace == null && body?.runPaceMsPerKm == null
            ? existing.run_pace_ms_per_km == null
                ? null
                : Number(existing.run_pace_ms_per_km)
            : parsePace(body.runPace ?? body.runPaceMsPerKm);
    const pacingStrategy = String(body?.pacingStrategy || existing.pacing_strategy || 'target')
        .trim()
        .toLowerCase();
    if (!PACING.has(pacingStrategy)) {
        throw httpError('INVALID_PACING', 400, 'pacingStrategy must be conservative, target, or aggressive');
    }
    const stationTargets =
        body?.stationTargets || body?.splits
            ? parseStationTargets(body, stations)
            : existing.station_targets || {};
    const validation = validationState({ goalTimeMs, runPaceMsPerKm, stationTargets, eventStations: stations });
    if (validation.status === 'invalid') {
        throw httpError('INVALID_STRATEGY', 400, validation.issues[0]?.message || 'Strategy is invalid');
    }
    await query(
        `
        /* arena:upsert_strategy */
        INSERT INTO arena_race_strategies (
            participant_id, user_id, event_id, event_version_id, strategy_version,
            goal_time_ms, run_pace_ms_per_km, pacing_strategy, station_targets, validation, updated_at
        )
        VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8::jsonb,$9::jsonb, NOW())
        ON CONFLICT (participant_id) DO UPDATE SET
            strategy_version = arena_race_strategies.strategy_version + 1,
            goal_time_ms = EXCLUDED.goal_time_ms,
            run_pace_ms_per_km = EXCLUDED.run_pace_ms_per_km,
            pacing_strategy = EXCLUDED.pacing_strategy,
            station_targets = EXCLUDED.station_targets,
            validation = EXCLUDED.validation,
            updated_at = NOW()
        RETURNING *
        `,
        [
            participant.id,
            userId,
            eventId,
            participant.event_version_id,
            goalTimeMs,
            runPaceMsPerKm,
            pacingStrategy,
            JSON.stringify(stationTargets),
            JSON.stringify(validation),
        ]
    );
    return getStrategy(userId, eventId, { ...options, query });
}

async function getHistory(userId, options = {}) {
    await ready(options);
    const { limit, offset } = page(options.queryParams || {});
    const query = q(options);
    let rows;
    try {
        ({ rows } = await query(
        `
        /* arena:history */
        SELECT
            s.id,
            s.status AS session_status,
            s.started_at,
            s.finished_at,
            s.abandoned_at,
            e.id AS event_id,
            e.title,
            e.image_key,
            e.starts_at,
            e.ends_at,
            e.category,
            r.id AS result_id,
            r.total_elapsed_ms,
            r.result_status,
            r.evidence_source,
            r.evidence_confidence,
            r.competitive_eligible
        FROM arena_race_sessions s
        JOIN arena_events e ON e.id = s.event_id
        LEFT JOIN arena_race_results r ON r.session_id = s.id
        WHERE s.user_id = $1
        ORDER BY COALESCE(s.finished_at, s.abandoned_at, s.started_at, s.prepared_at) DESC
        LIMIT $2 OFFSET $3
        `,
        [userId, limit, offset]
        ));
    } catch (error) {
        if (isMissingRelation(error)) {
            return { races: [], pagination: { limit, offset } };
        }
        throw error;
    }
    return {
        races: rows.map((row) => {
            const official =
                row.session_status === 'completed' &&
                row.competitive_eligible === true &&
                ['verified', 'standard'].includes(row.result_status);
            return {
                id: row.id,
                eventId: row.event_id,
                eventName: row.title,
                eventImage: row.image_key,
                eventDates: { startsAt: row.starts_at, endsAt: row.ends_at },
                category: row.category,
                raceStatus: row.session_status,
                officialCompleted: official,
                finishTime: displayTime(row.total_elapsed_ms == null ? null : Number(row.total_elapsed_ms)),
                resultStatus: row.result_status || null,
                evidenceStatus: row.result_status || null,
                evidenceSource: row.evidence_source || null,
            };
        }),
        pagination: { limit, offset },
    };
}

async function getHistoryItem(userId, sessionId, options = {}) {
    await ready(options);
    const query = q(options);
    let rows;
    try {
        ({ rows } = await query(
        `
        /* arena:history_item */
        SELECT
            s.*,
            e.title,
            e.image_key,
            e.starts_at AS event_starts_at,
            e.ends_at AS event_ends_at,
            e.category,
            r.id AS result_id,
            r.total_elapsed_ms,
            r.result_status,
            r.evidence_source,
            r.evidence_confidence,
            r.competitive_eligible
        FROM arena_race_sessions s
        JOIN arena_events e ON e.id = s.event_id
        LEFT JOIN arena_race_results r ON r.session_id = s.id
        WHERE s.id = $1 AND s.user_id = $2
        `,
        [sessionId, userId]
        ));
    } catch (error) {
        if (isMissingRelation(error)) {
            throw httpError('HISTORY_NOT_FOUND', 404, 'Race history not found');
        }
        throw error;
    }
    if (!rows[0]) throw httpError('HISTORY_NOT_FOUND', 404, 'Race history not found');
    const row = rows[0];
    const { rows: splits } = await query(
        `
        /* arena:session_segments */
        SELECT sequence, station_key, segment_type, title, status, started_at, completed_at, elapsed_ms, athlete_decision
        FROM arena_race_segments
        WHERE session_id = $1
        ORDER BY sequence
        `,
        [sessionId]
    );
    const official =
        row.status === 'completed' &&
        row.competitive_eligible === true &&
        ['verified', 'standard'].includes(row.result_status);
    return {
        id: row.id,
        eventId: row.event_id,
        eventName: row.title,
        eventImage: row.image_key,
        eventDates: { startsAt: row.event_starts_at, endsAt: row.event_ends_at },
        category: row.category,
        raceStatus: row.status,
        officialCompleted: official,
        finishTime: displayTime(row.total_elapsed_ms == null ? null : Number(row.total_elapsed_ms)),
        resultStatus: row.result_status || null,
        evidenceStatus: row.result_status || null,
        evidenceSource: row.evidence_source || null,
        splits: splits.map((split) => ({
            sequence: Number(split.sequence),
            key: split.station_key,
            type: split.segment_type,
            title: split.title,
            status: split.status,
            elapsed: displayTime(split.elapsed_ms == null ? null : Number(split.elapsed_ms)),
            decision: split.athlete_decision,
        })),
    };
}

function genderMatches(filter, gender) {
    const value = String(gender || '').trim().toLowerCase();
    if (filter === 'men') return GENDER_MEN.has(value);
    if (filter === 'women') return GENDER_WOMEN.has(value);
    return true;
}

async function getLeaderboard(options = {}) {
    await ready(options);
    const query = q(options);
    const params = options.queryParams || {};
    const eventId = String(params.eventId || params.event || '').trim();
    if (!eventId) {
        return {
            entries: [],
            comparable: false,
            reason: 'EVENT_REQUIRED',
            message: 'Performance rankings are only comparable within a single event version.',
            pagination: page(params),
        };
    }
    const event = await loadPublishedEvent(eventId, query);
    const divisionFilter = String(params.division || params.category || 'all')
        .trim()
        .toLowerCase();
    const resultStatus = String(params.resultStatus || 'official').trim().toLowerCase();
    const { limit, offset } = page(params);
    let rows;
    try {
        ({ rows } = await query(
        `
        /* arena:leaderboard */
        SELECT
            r.id,
            r.user_id,
            r.total_elapsed_ms,
            r.result_status,
            r.evidence_source,
            r.evidence_confidence,
            r.competitive_eligible,
            r.event_version_id,
            u.display_name,
            u.gender
        FROM arena_race_results r
        JOIN users u ON u.id = r.user_id
        WHERE r.event_id = $1
          AND r.event_version_id = $2
          AND r.competitive_eligible = TRUE
          AND r.result_status IN ('verified', 'standard')
        ORDER BY r.total_elapsed_ms ASC, r.created_at ASC, r.id ASC
        `,
        [eventId, event.version_id]
        ));
    } catch (error) {
        if (isMissingRelation(error)) rows = [];
        else throw error;
    }
    const eligible = rows.filter((row) => {
        if (resultStatus !== 'official' && row.result_status !== resultStatus) return false;
        if (divisionFilter === 'men' || divisionFilter === 'women') {
            return genderMatches(divisionFilter, row.gender);
        }
        return true;
    });
    const sliced = eligible.slice(offset, offset + limit);
    return {
        eventId,
        eventVersionId: event.version_id,
        formatKey: event.format_key,
        comparable: true,
        entries: sliced.map((row, index) => ({
            rank: offset + index + 1,
            athleteDisplayName: row.display_name || 'Athlete',
            country: null,
            finishTime: displayTime(Number(row.total_elapsed_ms)),
            evidenceStatus: row.result_status,
            evidenceSource: row.evidence_source,
            eventId,
        })),
        pagination: { limit, offset, total: eligible.length },
        simulationEngine: simulationEngine(),
    };
}

module.exports = {
    getArenaHome,
    listEvents,
    getEvent,
    getEventRules,
    joinEvent,
    getStrategy,
    saveStrategy,
    getHistory,
    getHistoryItem,
    getLeaderboard,
    loadPublishedEvent,
    loadStations,
    loadOwnParticipation,
    loadUser,
    assertAthlete,
    latestReadiness,
    eventStatus,
    q,
    ready,
};
