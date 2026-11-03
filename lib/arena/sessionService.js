const { withTransaction } = require('../dbQuery');
const { isMissingRelation } = require('../db/errors');
const {
    ready,
    q,
    loadPublishedEvent,
    loadStations,
    ensureJoined,
    loadUser,
    assertAthlete,
    eventStatus,
} = require('./arenaService');
const { simulationEngine } = require('./engine');
const { loadEngineInputs } = require('../athlete/engineInputs');
const { httpError, displayTime } = require('./times');

const DECISIONS = new Set(['hold', 'push', 'back_off']);
const OPEN_STATUSES = new Set(['prepared', 'active', 'held']);

function transact(options, work) {
    if (options?.query) return work(options.query);
    return withTransaction((client) => work((sql, params) => client.query(sql, params)));
}

function sessionDto(row, extras = {}) {
    return {
        id: row.id,
        eventId: row.event_id,
        eventVersionId: row.event_version_id,
        participantId: row.participant_id,
        status: row.status,
        currentSequence: Number(row.current_sequence),
        preparedAt: row.prepared_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        abandonedAt: row.abandoned_at,
        elapsed: displayTime(extras.elapsedMs == null ? null : extras.elapsedMs),
        remainingTarget: extras.remainingTarget || null,
        engine: extras.engine,
        dna: extras.dna || row.dna_snapshot || null,
        evidenceSnapshot: extras.evidenceSnapshot || row.evidence_snapshot || null,
        segments: extras.segments || [],
        leaderboardPreview: extras.leaderboardPreview || { available: false, entries: [] },
    };
}

function elapsedMs(row, now) {
    if (!row.started_at) return null;
    const end = row.finished_at || row.abandoned_at || now;
    return Math.max(0, new Date(end).getTime() - new Date(row.started_at).getTime());
}

async function loadOwnedSession(userId, sessionId, query) {
    try {
        const { rows } = await query(
            `
            /* arena:load_session */
            SELECT *
            FROM arena_race_sessions
            WHERE id = $1 AND user_id = $2
            `,
            [sessionId, userId]
        );
        return rows[0] || null;
    } catch (error) {
        if (isMissingRelation(error)) return null;
        throw error;
    }
}

async function loadSegments(sessionId, query) {
    const { rows } = await query(
        `
        /* arena:session_segments */
        SELECT sequence, station_key, segment_type, title, status, started_at, completed_at, elapsed_ms, athlete_decision
        FROM arena_race_segments
        WHERE session_id = $1
        ORDER BY sequence
        `,
        [sessionId]
    );
    return rows.map((row) => ({
        sequence: Number(row.sequence),
        key: row.station_key,
        type: row.segment_type,
        title: row.title,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        elapsed: displayTime(row.elapsed_ms == null ? null : Number(row.elapsed_ms)),
        decision: row.athlete_decision,
    }));
}

async function seedSegments(sessionId, stations, query) {
    for (const station of stations) {
        await query(
            `
            /* arena:insert_segment */
            INSERT INTO arena_race_segments (
                session_id, sequence, station_key, segment_type, title, status
            )
            VALUES ($1,$2,$3,$4,$5, CASE WHEN $2 = 1 THEN 'active' ELSE 'pending' END)
            `,
            [sessionId, station.sequence, station.key, station.type, station.title]
        );
    }
}

async function startEvent(userId, eventId, options = {}) {
    await ready(options);
    const now = options.now || new Date();
    return transact(options, async (query) => {
        const user = await loadUser(userId, query);
        assertAthlete(user);
        const event = await loadPublishedEvent(eventId, query);
        if (eventStatus(event, now) !== 'open') {
            throw httpError('EVENT_NOT_OPEN', 409, 'This event is not open');
        }
        const participant = await ensureJoined(userId, eventId, { ...options, query });
        const { rows: open } = await query(
            `
            /* arena:open_session */
            SELECT *
            FROM arena_race_sessions
            WHERE user_id = $1 AND event_id = $2 AND status IN ('prepared', 'active', 'held')
            `,
            [userId, eventId]
        );
        if (open[0]) {
            if (open[0].status === 'active') {
                throw httpError('SESSION_ACTIVE', 409, 'A race session is already active for this event');
            }
            throw httpError('SESSION_OPEN', 409, 'A race session is already prepared for this event');
        }
        const { rows: completed } = await query(
            `
            /* arena:completed_session */
            SELECT id
            FROM arena_race_sessions
            WHERE user_id = $1 AND event_id = $2 AND status = 'completed'
            LIMIT 1
            `,
            [userId, eventId]
        );
        if (completed[0]) {
            throw httpError('SESSION_COMPLETED', 409, 'This event already has a completed race session');
        }
        const stations = await loadStations(participant.event_version_id, query);
        const { rows: strategyRows } = await query(
            `
            /* arena:load_strategy */
            SELECT pacing_strategy
            FROM arena_race_strategies
            WHERE participant_id = $1
            `,
            [participant.id]
        );
        const pacingStrategy = strategyRows[0]?.pacing_strategy || 'target';
        const evidenceSnapshot = await loadEngineInputs(
            userId,
            { pacingStrategy },
            { query, now }
        );
        const dna = evidenceSnapshot.athleteDna;
        const inserted = await query(
            `
            /* arena:insert_session */
            INSERT INTO arena_race_sessions (
                participant_id, user_id, event_id, event_version_id, status,
                prepared_at, started_at, current_sequence, engine_available, dna_snapshot,
                evidence_snapshot, updated_at
            )
            VALUES ($1,$2,$3,$4,'active', NOW(), NOW(), 1, FALSE, $5::jsonb, $6::jsonb, NOW())
            RETURNING *
            `,
            [
                participant.id,
                userId,
                eventId,
                participant.event_version_id,
                JSON.stringify(dna),
                JSON.stringify(evidenceSnapshot),
            ]
        );
        const session = inserted.rows[0];
        await seedSegments(session.id, stations, query);
        await query(
            `
            /* arena:mark_started */
            UPDATE arena_participants
            SET status = 'started', updated_at = NOW()
            WHERE id = $1 AND status = 'joined'
            `,
            [participant.id]
        );
        const segments = await loadSegments(session.id, query);
        return sessionDto(session, {
            elapsedMs: 0,
            engine: evidenceSnapshot.simulationEngine || simulationEngine(evidenceSnapshot),
            dna,
            evidenceSnapshot,
            segments,
            remainingTarget: null,
        });
    });
}

async function getSession(userId, sessionId, options = {}) {
    await ready(options);
    const query = q(options);
    const now = options.now || new Date();
    const session = await loadOwnedSession(userId, sessionId, query);
    if (!session) throw httpError('SESSION_NOT_FOUND', 404, 'Race session not found');
    const segments = await loadSegments(session.id, query);
    const dna = session.dna_snapshot;
    const evidenceSnapshot = session.evidence_snapshot;
    return sessionDto(session, {
        elapsedMs: elapsedMs(session, now),
        engine: simulationEngine(evidenceSnapshot || { athleteDna: dna }),
        dna,
        evidenceSnapshot,
        segments,
    });
}

async function checkpoint(userId, sessionId, body, options = {}) {
    await ready(options);
    const now = options.now || new Date();
    const decision = body?.decision ? String(body.decision).trim().toLowerCase() : null;
    if (decision && !DECISIONS.has(decision)) {
        throw httpError('INVALID_DECISION', 400, 'decision must be hold, push, or back_off');
    }
    return transact(options, async (query) => {
        const session = await loadOwnedSession(userId, sessionId, query);
        if (!session) throw httpError('SESSION_NOT_FOUND', 404, 'Race session not found');
        if (session.status !== 'active') {
            throw httpError('SESSION_NOT_ACTIVE', 409, 'Checkpoints are only accepted on an active session');
        }
        const requested = Number(body?.sequence || session.current_sequence);
        if (requested !== Number(session.current_sequence)) {
            throw httpError('CHECKPOINT_OUT_OF_ORDER', 409, 'Checkpoints must follow the event station order');
        }
        const { rows: currentRows } = await query(
            `
            /* arena:load_segment */
            SELECT *
            FROM arena_race_segments
            WHERE session_id = $1 AND sequence = $2
            `,
            [sessionId, requested]
        );
        const current = currentRows[0];
        if (!current) throw httpError('SEGMENT_NOT_FOUND', 404, 'Race segment not found');
        const started = current.started_at ? new Date(current.started_at) : new Date(session.started_at);
        const elapsed = Math.max(0, now.getTime() - started.getTime());
        await query(
            `
            /* arena:complete_segment */
            UPDATE arena_race_segments
            SET status = 'completed',
                completed_at = NOW(),
                elapsed_ms = $3,
                athlete_decision = $4,
                started_at = COALESCE(started_at, $5)
            WHERE session_id = $1 AND sequence = $2 AND status = 'active'
            `,
            [sessionId, requested, elapsed, decision, session.started_at]
        );
        const nextSequence = requested + 1;
        const { rows: nextRows } = await query(
            `
            /* arena:load_segment */
            SELECT *
            FROM arena_race_segments
            WHERE session_id = $1 AND sequence = $2
            `,
            [sessionId, nextSequence]
        );
        if (nextRows[0]) {
            await query(
                `
                /* arena:activate_segment */
                UPDATE arena_race_segments
                SET status = 'active', started_at = NOW()
                WHERE session_id = $1 AND sequence = $2 AND status = 'pending'
                `,
                [sessionId, nextSequence]
            );
            await query(
                `
                /* arena:advance_session */
                UPDATE arena_race_sessions
                SET current_sequence = $2, updated_at = NOW()
                WHERE id = $1 AND status = 'active'
                `,
                [sessionId, nextSequence]
            );
        }
        return getSession(userId, sessionId, { query, now });
    });
}

async function finishSession(userId, sessionId, options = {}) {
    await ready(options);
    const now = options.now || new Date();
    return transact(options, async (query) => {
        const session = await loadOwnedSession(userId, sessionId, query);
        if (!session) throw httpError('SESSION_NOT_FOUND', 404, 'Race session not found');
        if (session.status === 'completed') {
            const { rows: existing } = await query(
                `
                /* arena:load_result */
                SELECT *
                FROM arena_race_results
                WHERE session_id = $1
                `,
                [sessionId]
            );
            return {
                session: await getSession(userId, sessionId, { query, now }),
                result: existing[0]
                    ? {
                          id: existing[0].id,
                          status: existing[0].result_status,
                          competitiveEligible: existing[0].competitive_eligible,
                          evidenceSource: existing[0].evidence_source,
                          totalElapsed: displayTime(Number(existing[0].total_elapsed_ms)),
                      }
                    : null,
                idempotent: true,
            };
        }
        if (session.status !== 'active') {
            throw httpError('SESSION_NOT_ACTIVE', 409, 'Only an active session can be finished');
        }
        const total = elapsedMs(session, now);
        await query(
            `
            /* arena:finish_session */
            UPDATE arena_race_sessions
            SET status = 'completed', finished_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status = 'active'
            `,
            [sessionId]
        );
        await query(
            `
            /* arena:mark_completed */
            UPDATE arena_participants
            SET status = 'completed', updated_at = NOW()
            WHERE id = $1
            `,
            [session.participant_id]
        );
        const inserted = await query(
            `
            /* arena:insert_result */
            INSERT INTO arena_race_results (
                session_id, user_id, event_id, event_version_id, total_elapsed_ms,
                result_status, evidence_source, evidence_confidence, competitive_eligible
            )
            VALUES ($1,$2,$3,$4,$5,'unverified','virtual_session','LOW', FALSE)
            RETURNING *
            `,
            [sessionId, userId, session.event_id, session.event_version_id, total]
        );
        const result = inserted.rows[0];
        await query(
            `
            /* arena:audit_result */
            INSERT INTO arena_result_audits (result_id, actor_user_id, action, payload)
            VALUES ($1, $2, 'virtual_finish', $3::jsonb)
            `,
            [
                result.id,
                userId,
                JSON.stringify({
                    competitiveEligible: false,
                    resultStatus: 'unverified',
                    source: 'virtual_session',
                    dnaUnchanged: true,
                    xpUnchanged: true,
                }),
            ]
        );
        return {
            session: await getSession(userId, sessionId, { query, now }),
            result: {
                id: result.id,
                status: result.result_status,
                competitiveEligible: false,
                evidenceSource: result.evidence_source,
                totalElapsed: displayTime(Number(result.total_elapsed_ms)),
            },
            officialRanking: false,
            athleteDnaUnchanged: true,
            idempotent: false,
        };
    });
}

async function abandonSession(userId, sessionId, options = {}) {
    await ready(options);
    const now = options.now || new Date();
    return transact(options, async (query) => {
        const session = await loadOwnedSession(userId, sessionId, query);
        if (!session) throw httpError('SESSION_NOT_FOUND', 404, 'Race session not found');
        if (session.status === 'abandoned') {
            return { session: await getSession(userId, sessionId, { query, now }), officialCompleted: false };
        }
        if (!OPEN_STATUSES.has(session.status)) {
            throw httpError('SESSION_NOT_ABANDONABLE', 409, 'Only a prepared, active, or held session can be left');
        }
        await query(
            `
            /* arena:abandon_session */
            UPDATE arena_race_sessions
            SET status = 'abandoned', abandoned_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status IN ('prepared', 'active', 'held')
            `,
            [sessionId]
        );
        await query(
            `
            /* arena:mark_withdrawn */
            UPDATE arena_participants
            SET status = 'withdrawn', updated_at = NOW()
            WHERE id = $1 AND status IN ('joined', 'started')
            `,
            [session.participant_id]
        );
        return {
            session: await getSession(userId, sessionId, { query, now }),
            officialCompleted: false,
            athleteDnaUnchanged: true,
        };
    });
}

module.exports = {
    startEvent,
    getSession,
    checkpoint,
    finishSession,
    abandonSession,
};
