const { queryWithHardTimeout, withTransaction } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { assertApprovedCoach } = require('../admin/coachReviewService');
const { getWorkout } = require('../workouts/workoutCatalog');
const { addDays } = require('../onboarding/programCatalog');

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

const NOTIFICATION = {
    delivered: false,
    reason: 'NO_NOTIFICATION_PROVIDER',
};

async function ready(options) {
    if (options?.query) return;
    await ensureOnboardingProfileSchema();
}

function useTransaction(options) {
    if (options.transaction) return options.transaction;
    return (work) => withTransaction((client) => work((sql, params) => client.query(sql, params)));
}

function clean(value, max) {
    return String(value || '').trim().slice(0, max);
}

function parseStructure(body, { requireComplete = false } = {}) {
    const title = clean(body?.title ?? body?.name, 140);
    const description = clean(body?.description, 2000);
    const trainingGoal = clean(body?.trainingGoal ?? body?.goal, 80);
    const durationWeeks = Number(body?.durationWeeks);
    if (!title || !trainingGoal) {
        throw httpError('INVALID_PROGRAM', 400, 'Program title and training goal are required');
    }
    if (!Number.isInteger(durationWeeks) || durationWeeks < 1 || durationWeeks > 52) {
        throw httpError('INVALID_PROGRAM', 400, 'durationWeeks must be a whole number from 1 to 52');
    }
    const rawSessions = Array.isArray(body?.sessions) ? body.sessions : [];
    const seen = new Set();
    const sessions = [];
    const unknown = [];
    for (const item of rawSessions) {
        const weekNumber = Number(item?.weekNumber);
        const dayOfWeek = Number(item?.dayOfWeek);
        const workoutId = String(item?.workoutId || '').trim();
        if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > durationWeeks) {
            throw httpError('INVALID_PROGRAM', 400, 'Each session weekNumber must fall inside the program duration');
        }
        if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
            throw httpError('INVALID_PROGRAM', 400, 'dayOfWeek must be a whole number from 1 to 7');
        }
        const key = `${weekNumber}:${dayOfWeek}`;
        if (seen.has(key)) {
            throw httpError('INVALID_PROGRAM', 400, 'A program week can place only one workout on a day');
        }
        seen.add(key);
        if (!workoutId || !getWorkout(workoutId)) unknown.push(workoutId || '(blank)');
        else sessions.push({ weekNumber, dayOfWeek, workoutId });
    }
    if (unknown.length) {
        const error = httpError('UNKNOWN_WORKOUT', 400, 'One or more workout IDs are not in the playable catalog');
        error.workoutIds = [...new Set(unknown)];
        throw error;
    }
    if (requireComplete) {
        const missingWeeks = [];
        for (let week = 1; week <= durationWeeks; week += 1) {
            if (!sessions.some((session) => session.weekNumber === week)) missingWeeks.push(week);
        }
        if (!sessions.length || missingWeeks.length) {
            const error = httpError(
                'PROGRAM_SCHEDULE_INCOMPLETE',
                409,
                'Every week of the program needs at least one existing workout before assignment'
            );
            error.missingWeeks = missingWeeks;
            throw error;
        }
    }
    return { title, description, trainingGoal, durationWeeks, sessions };
}

function sessionRows(versionId, sessions) {
    return sessions.map((session) => ({
        version_id: versionId,
        week_number: session.weekNumber,
        day_of_week: session.dayOfWeek,
        workout_id: session.workoutId,
    }));
}

async function ownProgram(userId, programId, query) {
    const { rows } = await query(
        `
        /* club:load_program */
        SELECT p.id, p.club_id, p.coach_user_id, p.title, p.description, p.training_goal, p.status,
               c.coach_user_id AS club_coach_user_id
        FROM coach_programs p
        JOIN clubs c ON c.id = p.club_id
        WHERE p.id = $1
        `,
        [programId]
    );
    const program = rows[0];
    if (!program) throw httpError('PROGRAM_NOT_FOUND', 404, 'Program not found');
    if (program.coach_user_id !== userId || program.club_coach_user_id !== userId) {
        throw httpError('CLUB_FORBIDDEN', 403, 'This program belongs to another club');
    }
    return program;
}

async function latestVersion(programId, query) {
    const { rows } = await query(
        `
        /* club:load_latest_version */
        SELECT id, program_id, version_no, duration_weeks, frozen_at
        FROM coach_program_versions
        WHERE program_id = $1
        ORDER BY version_no DESC
        LIMIT 1
        `,
        [programId]
    );
    return rows[0] || null;
}

async function versionSessions(versionId, query) {
    const { rows } = await query(
        `
        /* club:load_version_sessions */
        SELECT week_number, day_of_week, workout_id
        FROM coach_program_sessions
        WHERE version_id = $1
        ORDER BY week_number, day_of_week
        `,
        [versionId]
    );
    return rows.map((row) => ({
        weekNumber: Number(row.week_number),
        dayOfWeek: Number(row.day_of_week),
        workoutId: row.workout_id,
    }));
}

async function insertSessions(versionId, sessions, query) {
    if (!sessions.length) return;
    await query(
        `
        /* club:insert_sessions */
        INSERT INTO coach_program_sessions (version_id, week_number, day_of_week, workout_id)
        SELECT x.version_id, x.week_number, x.day_of_week, x.workout_id
        FROM jsonb_to_recordset($1::jsonb) AS x(
            version_id uuid,
            week_number int,
            day_of_week int,
            workout_id text
        )
        `,
        [JSON.stringify(sessionRows(versionId, sessions))]
    );
}

function programDto(program, version, sessions) {
    return {
        id: program.id,
        clubId: program.club_id,
        coachUserId: program.coach_user_id,
        title: program.title,
        description: program.description,
        trainingGoal: program.training_goal,
        status: program.status,
        visibility: 'club',
        publishedToGallery: false,
        version: version
            ? {
                  id: version.id,
                  versionNo: Number(version.version_no),
                  durationWeeks: Number(version.duration_weeks),
                  frozenAt: version.frozen_at || null,
                  sessions,
              }
            : null,
    };
}

async function createCoachProgram(userId, body, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await assertApprovedCoach(userId, options);
    const fields = parseStructure(body);
    const club = await query(
        `
        /* club:load_by_coach */
        SELECT id, coach_user_id
        FROM clubs
        WHERE coach_user_id = $1
        `,
        [userId]
    );
    if (!club.rows[0]) throw httpError('CLUB_NOT_FOUND', 404, 'Create a club before creating a program');
    const transaction = useTransaction(options);
    return transaction(async (tx) => {
        const inserted = await tx(
            `
            /* club:insert_program */
            INSERT INTO coach_programs (club_id, coach_user_id, title, description, training_goal, status)
            VALUES ($1, $2, $3, $4, $5, 'draft')
            RETURNING id, club_id, coach_user_id, title, description, training_goal, status
            `,
            [club.rows[0].id, userId, fields.title, fields.description, fields.trainingGoal]
        );
        const program = inserted.rows[0];
        const version = await tx(
            `
            /* club:insert_version */
            INSERT INTO coach_program_versions (program_id, version_no, duration_weeks)
            VALUES ($1, 1, $2)
            RETURNING id, program_id, version_no, duration_weeks, frozen_at
            `,
            [program.id, fields.durationWeeks]
        );
        await insertSessions(version.rows[0].id, fields.sessions, tx);
        return programDto(program, version.rows[0], fields.sessions);
    });
}

async function updateCoachProgram(userId, programId, body, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await assertApprovedCoach(userId, options);
    const program = await ownProgram(userId, programId, query);
    const current = await latestVersion(programId, query);
    if (!current) throw httpError('PROGRAM_NOT_FOUND', 404, 'Program version not found');
    const existingSessions = await versionSessions(current.id, query);
    const fields = parseStructure({
        title: body?.title ?? program.title,
        description: body?.description ?? program.description,
        trainingGoal: body?.trainingGoal ?? program.training_goal,
        durationWeeks: body?.durationWeeks ?? current.duration_weeks,
        sessions: body?.sessions ?? existingSessions,
    });
    const transaction = useTransaction(options);
    return transaction(async (tx) => {
        const updated = await tx(
            `
            /* club:update_program */
            UPDATE coach_programs
            SET title = $2, description = $3, training_goal = $4, updated_at = NOW()
            WHERE id = $1 AND coach_user_id = $5
            RETURNING id, club_id, coach_user_id, title, description, training_goal, status
            `,
            [program.id, fields.title, fields.description, fields.trainingGoal, userId]
        );
        if (!current.frozen_at) {
            await tx(
                `
                /* club:update_version */
                UPDATE coach_program_versions
                SET duration_weeks = $2
                WHERE id = $1 AND frozen_at IS NULL
                `,
                [current.id, fields.durationWeeks]
            );
            await tx(
                `
                /* club:replace_sessions */
                DELETE FROM coach_program_sessions
                WHERE version_id = $1
                `,
                [current.id]
            );
            await insertSessions(current.id, fields.sessions, tx);
            return programDto(updated.rows[0], { ...current, duration_weeks: fields.durationWeeks }, fields.sessions);
        }
        const version = await tx(
            `
            /* club:insert_version */
            INSERT INTO coach_program_versions (program_id, version_no, duration_weeks)
            VALUES ($1, $2, $3)
            RETURNING id, program_id, version_no, duration_weeks, frozen_at
            `,
            [program.id, Number(current.version_no) + 1, fields.durationWeeks]
        );
        await insertSessions(version.rows[0].id, fields.sessions, tx);
        return programDto(updated.rows[0], version.rows[0], fields.sessions);
    });
}

async function getCoachProgram(userId, programId, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await assertApprovedCoach(userId, options);
    const program = await ownProgram(userId, programId, query);
    const version = await latestVersion(programId, query);
    const sessions = version ? await versionSessions(version.id, query) : [];
    const assignments = await query(
        `
        /* club:list_assignments */
        SELECT id, athlete_user_id, version_id, source, broadcast_id, created_at
        FROM program_assignments
        WHERE program_id = $1
        ORDER BY created_at DESC
        `,
        [programId]
    );
    return {
        ...programDto(program, version, sessions),
        assignments: assignments.rows.map((row) => ({
            id: row.id,
            athleteUserId: row.athlete_user_id,
            versionId: row.version_id,
            source: row.source,
            broadcastId: row.broadcast_id,
            createdAt: row.created_at,
        })),
    };
}

async function listCoachPrograms(userId, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await assertApprovedCoach(userId, options);
    const { rows } = await query(
        `
        /* club:list_programs */
        SELECT p.id, p.club_id, p.coach_user_id, p.title, p.description, p.training_goal, p.status
        FROM coach_programs p
        JOIN clubs c ON c.id = p.club_id
        WHERE p.coach_user_id = $1 AND c.coach_user_id = $1
        ORDER BY p.created_at DESC
        `,
        [userId]
    );
    return {
        programs: rows.map((row) => ({
            id: row.id,
            clubId: row.club_id,
            title: row.title,
            description: row.description,
            trainingGoal: row.training_goal,
            status: row.status,
            visibility: 'club',
            publishedToGallery: false,
        })),
    };
}

function calendarRows(programId, sessions, startDate) {
    return sessions.map((session) => {
        const workout = getWorkout(session.workoutId);
        const offset = (session.weekNumber - 1) * 7 + (session.dayOfWeek - 1);
        return {
            program_id: programId,
            workout_id: session.workoutId,
            title: workout?.title || session.workoutId,
            duration_min: Number(workout?.durationMin) || 0,
            scheduled_on: addDays(startDate, offset),
            plan_day: String(session.dayOfWeek),
            week_number: session.weekNumber,
        };
    });
}

function startDateFor(body, today) {
    const startDate = body?.startDate || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || ''))) {
        throw httpError('INVALID_DATE', 400, 'startDate must be YYYY-MM-DD');
    }
    return startDate;
}

async function freezeVersion(version, query) {
    if (version.frozen_at) return version;
    const frozen = await query(
        `
        /* club:freeze_version */
        UPDATE coach_program_versions
        SET frozen_at = NOW()
        WHERE id = $1 AND frozen_at IS NULL
        RETURNING id, program_id, version_no, duration_weeks, frozen_at
        `,
        [version.id]
    );
    return frozen.rows[0] || version;
}

async function materializeAssignment(athleteId, { program, version, sessions, startDate, source, broadcastId, actorId }, query) {
    await query(
        `
        /* club:lock_user */
        SELECT id FROM users WHERE id = $1 FOR UPDATE
        `,
        [athleteId]
    );
    const existingAssignment = await query(
        `
        /* club:load_assignment */
        SELECT id, version_id
        FROM program_assignments
        WHERE version_id = $1 AND athlete_user_id = $2
        `,
        [version.id, athleteId]
    );
    if (existingAssignment.rows[0]) {
        return {
            athleteId,
            status: 'already_assigned',
            assignmentId: existingAssignment.rows[0].id,
            versionId: version.id,
        };
    }
    const enrollment = await query(
        `
        /* club:load_user_program */
        SELECT program_id, coach_program_version_id
        FROM user_programs
        WHERE user_id = $1
        `,
        [athleteId]
    );
    if (enrollment.rows[0]) {
        throw httpError('PROGRAM_ACTIVE', 409, 'An active program already exists; switching programs is not supported');
    }
    const rows = calendarRows(program.id, sessions, startDate);
    const dates = rows.map((row) => row.scheduled_on);
    const conflicts = await query(
        `
        /* club:existing_dates */
        SELECT scheduled_on::text AS scheduled_on
        FROM scheduled_sessions
        WHERE user_id = $1 AND scheduled_on = ANY($2::date[])
        `,
        [athleteId, dates]
    );
    if (conflicts.rows.length) {
        const error = httpError('SCHEDULE_CONFLICT', 409, 'Assignment overlaps an existing scheduled session');
        error.dates = conflicts.rows.map((row) => row.scheduled_on);
        throw error;
    }
    await query(
        `
        /* club:insert_user_program */
        INSERT INTO user_programs (user_id, program_id, start_date, coach_program_version_id)
        VALUES ($1, $2, $3::date, $4)
        `,
        [athleteId, program.id, startDate, version.id]
    );
    await query(
        `
        /* club:insert_scheduled */
        INSERT INTO scheduled_sessions (
            user_id, program_id, workout_id, title, duration_min,
            scheduled_on, plan_day, week_number
        )
        SELECT
            $1, x.program_id, x.workout_id, x.title, x.duration_min,
            x.scheduled_on::date, x.plan_day, x.week_number
        FROM jsonb_to_recordset($2::jsonb) AS x(
            program_id text,
            workout_id text,
            title text,
            duration_min int,
            scheduled_on text,
            plan_day text,
            week_number int
        )
        `,
        [athleteId, JSON.stringify(rows)]
    );
    const assignment = await query(
        `
        /* club:insert_assignment */
        INSERT INTO program_assignments (
            program_id, version_id, club_id, athlete_user_id, source, broadcast_id, assigned_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        `,
        [program.id, version.id, program.club_id, athleteId, source, broadcastId, actorId]
    );
    await query(
        `
        /* club:mark_club_program */
        UPDATE coach_programs
        SET status = 'club', updated_at = NOW()
        WHERE id = $1 AND status = 'draft'
        `,
        [program.id]
    );
    return {
        athleteId,
        status: 'assigned',
        assignmentId: assignment.rows[0].id,
        versionId: version.id,
        sessionCount: rows.length,
        startDate,
    };
}

async function prepareAssignment(userId, programId, query) {
    await assertApprovedCoach(userId, optionsSafe(query));
    const program = await ownProgram(userId, programId, query);
    const version = await latestVersion(programId, query);
    if (!version) throw httpError('PROGRAM_NOT_FOUND', 404, 'Program version not found');
    const sessions = await versionSessions(version.id, query);
    parseStructure(
        {
            title: program.title,
            description: program.description,
            trainingGoal: program.training_goal,
            durationWeeks: Number(version.duration_weeks),
            sessions,
        },
        { requireComplete: true }
    );
    return { program, version, sessions };
}

function optionsSafe(query) {
    return { query };
}

async function acceptedAthleteIds(clubId, query) {
    const { rows } = await query(
        `
        /* club:accepted_ids */
        SELECT athlete_user_id
        FROM club_memberships
        WHERE club_id = $1 AND status = 'accepted'
        ORDER BY requested_at
        `,
        [clubId]
    );
    return rows.map((row) => row.athlete_user_id);
}

async function assertMembers(clubId, athleteIds, query) {
    const accepted = new Set(await acceptedAthleteIds(clubId, query));
    const missing = athleteIds.filter((id) => !accepted.has(id));
    if (missing.length) {
        const error = httpError('ATHLETE_NOT_IN_CLUB', 403, 'Every athlete must be an accepted member of this club');
        error.athleteIds = missing;
        throw error;
    }
}

async function assignCoachProgram(userId, programId, body, today, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    const prepared = await prepareAssignment(userId, programId, query);
    const startDate = startDateFor(body, today);
    const broadcast = body?.broadcast === true;
    const athleteIds = Array.isArray(body?.athleteIds)
        ? [...new Set(body.athleteIds.map((id) => String(id || '').trim()).filter(Boolean))]
        : [];
    if (broadcast === (athleteIds.length > 0)) {
        throw httpError('INVALID_ASSIGNMENT', 400, 'Choose athleteIds or broadcast, not both and not neither');
    }
    if (!broadcast) await assertMembers(prepared.program.club_id, athleteIds, query);

    const transaction = useTransaction(options);

    if (!broadcast) {
        try {
            const results = await transaction(async (tx) => {
                const frozen = await freezeVersion(prepared.version, tx);
                const version = frozen.frozen_at ? frozen : prepared.version;
                const assigned = [];
                for (const athleteId of athleteIds) {
                    assigned.push(
                        await materializeAssignment(
                            athleteId,
                            {
                                program: prepared.program,
                                version,
                                sessions: prepared.sessions,
                                startDate,
                                source: 'targeted',
                                broadcastId: null,
                                actorId: userId,
                            },
                            tx
                        )
                    );
                }
                return { versionId: version.id, assigned };
            });
            return {
                mode: 'targeted',
                versionId: results.versionId,
                frozen: true,
                results: results.assigned,
                notification: NOTIFICATION,
            };
        } catch (error) {
            if (error.code === '23505') {
                throw httpError('PROGRAM_ACTIVE', 409, 'An active program already exists; switching programs is not supported');
            }
            throw error;
        }
    }

    const frozen = await transaction(async (tx) => freezeVersion(prepared.version, tx));
    const version = frozen.frozen_at ? frozen : prepared.version;
    const applyToFutureMembers = body?.applyToFutureMembers !== false;
    const broadcastRow = await query(
        `
        /* club:upsert_broadcast */
        INSERT INTO club_broadcasts (club_id, program_id, version_id, apply_to_future_members, created_by)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (club_id, version_id)
        DO UPDATE SET apply_to_future_members = EXCLUDED.apply_to_future_members
        RETURNING id, apply_to_future_members
        `,
        [prepared.program.club_id, prepared.program.id, version.id, applyToFutureMembers, userId]
    );
    const broadcastId = broadcastRow.rows[0].id;
    const members = await acceptedAthleteIds(prepared.program.club_id, query);
    const results = [];
    for (const athleteId of members) {
        try {
            const result = await transaction((tx) =>
                materializeAssignment(
                    athleteId,
                    {
                        program: prepared.program,
                        version,
                        sessions: prepared.sessions,
                        startDate,
                        source: 'broadcast',
                        broadcastId,
                        actorId: userId,
                    },
                    tx
                )
            );
            results.push(result);
        } catch (error) {
            if (error.code === 'PROGRAM_ACTIVE' || error.code === 'SCHEDULE_CONFLICT') {
                results.push({ athleteId, status: error.code === 'PROGRAM_ACTIVE' ? 'program_active' : 'schedule_conflict' });
                continue;
            }
            if (error.code === '23505') {
                results.push({ athleteId, status: 'program_active' });
                continue;
            }
            throw error;
        }
    }
    return {
        mode: 'broadcast',
        broadcastId,
        applyToFutureMembers: broadcastRow.rows[0].apply_to_future_members,
        versionId: version.id,
        frozen: true,
        results,
        notification: NOTIFICATION,
    };
}

async function applyFutureBroadcasts(athleteId, clubId, today, options = {}) {
    const query = options.query || queryWithHardTimeout;
    const transaction = useTransaction(options);
    const { rows } = await query(
        `
        /* club:future_broadcasts */
        SELECT b.id, b.program_id, b.version_id, b.created_by, b.apply_to_future_members
        FROM club_broadcasts b
        WHERE b.club_id = $1 AND b.apply_to_future_members = TRUE
        ORDER BY b.created_at
        `,
        [clubId]
    );
    const results = [];
    for (const broadcast of rows) {
        const programResult = await query(
            `
            /* club:load_program_for_broadcast */
            SELECT p.id, p.club_id, p.coach_user_id, p.title, p.description, p.training_goal, p.status
            FROM coach_programs p
            WHERE p.id = $1 AND p.club_id = $2
            `,
            [broadcast.program_id, clubId]
        );
        const versionResult = await query(
            `
            /* club:load_version */
            SELECT id, program_id, version_no, duration_weeks, frozen_at
            FROM coach_program_versions
            WHERE id = $1
            `,
            [broadcast.version_id]
        );
        const program = programResult.rows[0];
        const version = versionResult.rows[0];
        if (!program || !version) continue;
        const sessions = await versionSessions(version.id, query);
        try {
            const result = await transaction((tx) =>
                materializeAssignment(
                    athleteId,
                    {
                        program,
                        version,
                        sessions,
                        startDate: today,
                        source: 'broadcast',
                        broadcastId: broadcast.id,
                        actorId: broadcast.created_by,
                    },
                    tx
                )
            );
            results.push(result);
        } catch (error) {
            if (error.code === 'PROGRAM_ACTIVE' || error.code === 'SCHEDULE_CONFLICT' || error.code === '23505') {
                results.push({
                    athleteId,
                    broadcastId: broadcast.id,
                    status: error.code === 'SCHEDULE_CONFLICT' ? 'schedule_conflict' : 'program_active',
                });
                continue;
            }
            throw error;
        }
    }
    return results;
}

module.exports = {
    createCoachProgram,
    updateCoachProgram,
    getCoachProgram,
    listCoachPrograms,
    assignCoachProgram,
    applyFutureBroadcasts,
    parseStructure,
    NOTIFICATION,
};
