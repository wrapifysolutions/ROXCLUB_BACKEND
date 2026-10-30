const test = require('node:test');
const assert = require('node:assert/strict');
const programsJson = require('../data/programs.json');
const { contentStatus, getPublicDefinition } = require('../lib/programs/publicCatalog');
const { createClub, listCoaches, requestJoin, reviewJoin, athleteDetail } = require('../lib/club/clubService');
const {
    createCoachProgram,
    updateCoachProgram,
    assignCoachProgram,
    getCoachProgram,
} = require('../lib/club/coachProgramService');
const { getWeekPlan } = require('../lib/plan/planService');
const { getMyProgram } = require('../lib/programs/programService');

function harness() {
    const db = {
        seq: 1,
        users: [],
        applications: [],
        clubs: [],
        memberships: [],
        programs: [],
        versions: [],
        programSessions: [],
        assignments: [],
        broadcasts: [],
        userPrograms: [],
        scheduled: [],
        xp: [],
    };
    const nextId = (prefix) => `${prefix}-${db.seq++}`;

    const query = async (sql, params = []) => {
        if (sql.includes('coach:latest_status')) {
            const rows = db.applications
                .filter((row) => row.user_id === params[0])
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            return { rows: rows[0] ? [{ status: rows[0].status }] : [] };
        }
        if (sql.includes('club:load_by_coach')) {
            return { rows: db.clubs.filter((row) => row.coach_user_id === params[0]) };
        }
        if (sql.includes('club:load_club')) {
            return { rows: db.clubs.filter((row) => row.id === params[0]) };
        }
        if (sql.includes('club:insert_club')) {
            if (db.clubs.some((row) => row.coach_user_id === params[0])) {
                const error = new Error('duplicate');
                error.code = '23505';
                throw error;
            }
            const row = {
                id: nextId('club'),
                coach_user_id: params[0],
                name: params[1],
                description: params[2],
                specialty: params[3],
                location: params[4],
            };
            db.clubs.push(row);
            return { rows: [row] };
        }
        if (sql.includes('club:update_club')) {
            const row = db.clubs.find((item) => item.id === params[0] && item.coach_user_id === params[5]);
            Object.assign(row, { name: params[1], description: params[2], specialty: params[3], location: params[4] });
            return { rows: [row] };
        }
        if (sql.includes('club:list_coaches')) {
            const rows = db.clubs
                .map((club) => {
                    const application = db.applications
                        .filter((row) => row.user_id === club.coach_user_id)
                        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
                    if (application?.status !== 'approved') return null;
                    const user = db.users.find((item) => item.id === club.coach_user_id);
                    return {
                        id: club.id,
                        coach_user_id: club.coach_user_id,
                        club_name: club.name,
                        description: club.description,
                        specialty: club.specialty,
                        location: club.location,
                        coach_name: application.full_name || user?.display_name || 'Coach',
                        athlete_count: db.memberships.filter((row) => row.club_id === club.id && row.status === 'accepted').length,
                    };
                })
                .filter(Boolean);
            return { rows };
        }
        if (sql.includes('club:accepted_membership')) {
            return { rows: db.memberships.filter((row) => row.athlete_user_id === params[0] && row.status === 'accepted') };
        }
        if (sql.includes('club:pending_membership')) {
            return {
                rows: db.memberships.filter(
                    (row) => row.athlete_user_id === params[0] && row.club_id === params[1] && row.status === 'pending'
                ),
            };
        }
        if (sql.includes('club:insert_membership')) {
            if (db.memberships.some((row) => row.athlete_user_id === params[1] && row.club_id === params[0] && row.status === 'pending')) {
                const error = new Error('duplicate');
                error.code = '23505';
                throw error;
            }
            const row = {
                id: nextId('mem'),
                club_id: params[0],
                athlete_user_id: params[1],
                status: 'pending',
                requested_at: new Date().toISOString(),
            };
            db.memberships.push(row);
            return { rows: [row] };
        }
        if (sql.includes('club:load_membership')) {
            return { rows: db.memberships.filter((row) => row.id === params[0]) };
        }
        if (sql.includes('club:review_membership')) {
            const row = db.memberships.find((item) => item.id === params[0] && item.status === 'pending');
            if (!row) return { rows: [] };
            if (params[1] === 'accepted' && db.memberships.some((item) => item.athlete_user_id === row.athlete_user_id && item.status === 'accepted')) {
                const error = new Error('duplicate');
                error.code = '23505';
                throw error;
            }
            row.status = params[1];
            row.reviewed_by = params[2];
            return { rows: [row] };
        }
        if (sql.includes('club:list_members')) {
            return {
                rows: db.memberships
                    .filter((row) => row.club_id === params[0] && row.status === params[1])
                    .map((row) => ({
                        id: row.id,
                        athlete_user_id: row.athlete_user_id,
                        status: row.status,
                        requested_at: row.requested_at,
                        display_name: db.users.find((user) => user.id === row.athlete_user_id)?.display_name || null,
                    })),
            };
        }
        if (sql.includes('club:list_programs')) {
            const rows = sql.includes('p.coach_user_id')
                ? db.programs.filter((row) => row.coach_user_id === params[0])
                : db.programs.filter((row) => row.club_id === params[0]);
            return { rows };
        }
        if (sql.includes('club:coach_public')) {
            const application = db.applications
                .filter((row) => row.user_id === params[0])
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
            const user = db.users.find((item) => item.id === params[0]);
            return { rows: [{ coach_name: application?.full_name || user?.display_name || 'Coach' }] };
        }
        if (sql.includes('club:athlete_program') || sql.includes('programs:load_enrollment') || sql.includes('plan:load_program')) {
            return { rows: db.userPrograms.filter((row) => row.user_id === params[0]) };
        }
        if (sql.includes('club:own_pending')) {
            const row = db.memberships.find((item) => item.athlete_user_id === params[0] && item.status === 'pending');
            if (!row) return { rows: [] };
            const club = db.clubs.find((item) => item.id === row.club_id);
            return { rows: [{ id: row.id, club_id: row.club_id, name: club.name }] };
        }
        if (sql.includes('club:member_in_club')) {
            const row = db.memberships.find(
                (item) => item.club_id === params[0] && item.athlete_user_id === params[1] && item.status === 'accepted'
            );
            if (!row) return { rows: [] };
            const user = db.users.find((item) => item.id === row.athlete_user_id);
            return { rows: [{ id: row.id, status: row.status, display_name: user?.display_name || null }] };
        }
        if (sql.includes('club:session_counts')) {
            const rows = db.scheduled.filter((row) => row.user_id === params[0]);
            return {
                rows: [{
                    total_sessions: rows.length,
                    completed_sessions: rows.filter((row) => row.completed_at).length,
                }],
            };
        }
        if (sql.includes('club:load_program_for_broadcast')) {
            return { rows: db.programs.filter((row) => row.id === params[0] && row.club_id === params[1]) };
        }
        if (sql.includes('club:load_program')) {
            return {
                rows: db.programs
                    .filter((row) => row.id === params[0])
                    .map((row) => {
                        const club = db.clubs.find((item) => item.id === row.club_id);
                        return { ...row, club_coach_user_id: club?.coach_user_id || null };
                    }),
            };
        }
        if (sql.includes('club:load_latest_version')) {
            const rows = db.versions
                .filter((row) => row.program_id === params[0])
                .sort((a, b) => b.version_no - a.version_no);
            return { rows: rows[0] ? [rows[0]] : [] };
        }
        if (sql.includes('club:load_version_sessions')) {
            return {
                rows: db.programSessions
                    .filter((row) => row.version_id === params[0])
                    .sort((a, b) => a.week_number - b.week_number || a.day_of_week - b.day_of_week),
            };
        }
        if (sql.includes('club:load_version')) {
            return { rows: db.versions.filter((row) => row.id === params[0]) };
        }
        if (sql.includes('club:insert_program')) {
            const row = {
                id: nextId('prog'),
                club_id: params[0],
                coach_user_id: params[1],
                title: params[2],
                description: params[3],
                training_goal: params[4],
                status: 'draft',
                created_at: new Date().toISOString(),
            };
            db.programs.push(row);
            return { rows: [row] };
        }
        if (sql.includes('club:insert_version')) {
            const row = {
                id: nextId('ver'),
                program_id: params[0],
                version_no: params.length === 3 ? params[1] : 1,
                duration_weeks: params.length === 3 ? params[2] : params[1],
                frozen_at: null,
            };
            db.versions.push(row);
            return { rows: [row] };
        }
        if (sql.includes('club:insert_sessions')) {
            const sessions = JSON.parse(params[0]);
            for (const session of sessions) db.programSessions.push(session);
            return { rows: [] };
        }
        if (sql.includes('club:update_program')) {
            const row = db.programs.find((item) => item.id === params[0] && item.coach_user_id === params[4]);
            Object.assign(row, { title: params[1], description: params[2], training_goal: params[3] });
            return { rows: [row] };
        }
        if (sql.includes('club:update_version')) {
            const row = db.versions.find((item) => item.id === params[0] && !item.frozen_at);
            if (row) row.duration_weeks = params[1];
            return { rows: [] };
        }
        if (sql.includes('club:replace_sessions')) {
            db.programSessions = db.programSessions.filter((row) => row.version_id !== params[0]);
            return { rows: [] };
        }
        if (sql.includes('club:list_assignments')) {
            return { rows: db.assignments.filter((row) => row.program_id === params[0]) };
        }
        if (sql.includes('club:lock_user')) {
            return { rows: db.users.filter((row) => row.id === params[0]) };
        }
        if (sql.includes('club:load_assignment')) {
            return {
                rows: db.assignments.filter((row) => row.version_id === params[0] && row.athlete_user_id === params[1]),
            };
        }
        if (sql.includes('club:load_user_program')) {
            return { rows: db.userPrograms.filter((row) => row.user_id === params[0]) };
        }
        if (sql.includes('club:existing_dates')) {
            const dates = new Set(params[1]);
            return {
                rows: db.scheduled
                    .filter((row) => row.user_id === params[0] && dates.has(row.scheduled_on))
                    .map((row) => ({ scheduled_on: row.scheduled_on })),
            };
        }
        if (sql.includes('club:insert_user_program')) {
            db.userPrograms.push({
                user_id: params[0],
                program_id: params[1],
                start_date: params[2],
                coach_program_version_id: params[3],
            });
            return { rows: [] };
        }
        if (sql.includes('club:insert_scheduled')) {
            const sessions = JSON.parse(params[1]);
            for (const session of sessions) {
                if (db.scheduled.some((row) => row.user_id === params[0] && row.scheduled_on === session.scheduled_on)) {
                    const error = new Error('duplicate date');
                    error.code = '23505';
                    throw error;
                }
                db.scheduled.push({
                    id: nextId('sched'),
                    user_id: params[0],
                    ...session,
                    status: 'pending',
                    completed_at: null,
                });
            }
            return { rows: [] };
        }
        if (sql.includes('club:insert_assignment')) {
            const row = {
                id: nextId('asg'),
                program_id: params[0],
                version_id: params[1],
                club_id: params[2],
                athlete_user_id: params[3],
                source: params[4],
                broadcast_id: params[5],
                assigned_by: params[6],
                created_at: new Date().toISOString(),
            };
            db.assignments.push(row);
            return { rows: [row] };
        }
        if (sql.includes('club:mark_club_program')) {
            const row = db.programs.find((item) => item.id === params[0] && item.status === 'draft');
            if (row) row.status = 'club';
            return { rows: [] };
        }
        if (sql.includes('club:freeze_version')) {
            const row = db.versions.find((item) => item.id === params[0]);
            if (row && !row.frozen_at) row.frozen_at = '2026-10-30T00:00:00.000Z';
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('club:accepted_ids')) {
            return {
                rows: db.memberships
                    .filter((row) => row.club_id === params[0] && row.status === 'accepted')
                    .map((row) => ({ athlete_user_id: row.athlete_user_id })),
            };
        }
        if (sql.includes('club:upsert_broadcast')) {
            let row = db.broadcasts.find((item) => item.club_id === params[0] && item.version_id === params[2]);
            if (!row) {
                row = {
                    id: nextId('cast'),
                    club_id: params[0],
                    program_id: params[1],
                    version_id: params[2],
                    apply_to_future_members: params[3],
                    created_by: params[4],
                    created_at: new Date().toISOString(),
                };
                db.broadcasts.push(row);
            } else {
                row.apply_to_future_members = params[3];
            }
            return { rows: [row] };
        }
        if (sql.includes('club:future_broadcasts')) {
            return {
                rows: db.broadcasts
                    .filter((row) => row.club_id === params[0] && row.apply_to_future_members === true)
                    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
            };
        }
        if (sql.includes('club:plan_program')) {
            const version = db.versions.find((row) => row.id === params[0]);
            const program = db.programs.find((row) => row.id === version?.program_id);
            return {
                rows: version && program
                    ? [{ program_id: program.id, title: program.title, duration_weeks: version.duration_weeks, version_id: version.id }]
                    : [],
            };
        }
        if (sql.includes('plan:pending_past') || sql.includes('plan:insert_missed') || sql.includes('plan:skip_old') || sql.includes('plan:load_race') || sql.includes('plan:load_rewards') || sql.includes('plan:load_moves')) {
            return { rows: [] };
        }
        if (sql.includes('plan:load_week')) {
            return {
                rows: db.scheduled.filter(
                    (row) => row.user_id === params[0] && row.scheduled_on >= params[1] && row.scheduled_on < params[2]
                ),
            };
        }
        if (sql.includes('programs:session_stats')) {
            return {
                rows: db.scheduled
                    .filter((row) => row.user_id === params[0])
                    .map((row) => ({
                        id: row.id,
                        workout_id: row.workout_id,
                        scheduled_on: row.scheduled_on,
                        status: row.status,
                        completed_at: row.completed_at,
                        is_missed_unresolved: false,
                        is_skipped: false,
                    })),
            };
        }
        throw new Error(`Unhandled SQL: ${sql.trim().slice(0, 80)}`);
    };

    async function transaction(work) {
        const snapshot = structuredClone(db);
        try {
            return await work(query);
        } catch (error) {
            for (const key of Object.keys(db)) db[key] = snapshot[key];
            throw error;
        }
    }

    return { db, options: { query, transaction } };
}

function person(db, id, name, status = 'approved') {
    db.users.push({ id, display_name: name });
    if (status) {
        db.applications.push({
            user_id: id,
            status,
            full_name: name,
            created_at: new Date().toISOString(),
            document_key: 'secret-doc',
        });
    }
}

const clubBody = {
    name: 'Dubai HYROX',
    description: 'Club for hybrid athletes.',
    specialty: 'HYROX',
    location: 'Dubai',
};

const oneWeek = {
    title: 'Club Base',
    description: 'One week of existing workouts.',
    trainingGoal: 'HYROX',
    durationWeeks: 1,
    sessions: [{ weekNumber: 1, dayOfWeek: 1, workoutId: 'wk_foundation_a' }],
};

test('approved coach creates one club and a pending coach cannot', async () => {
    const { db, options } = harness();
    person(db, 'coach-1', 'Coach Kim', 'approved');
    person(db, 'coach-pending', 'Pending Coach', 'pending');
    const club = await createClub('coach-1', { ...clubBody, coachId: 'someone-else' }, options);
    assert.equal(club.coachUserId, 'coach-1');
    assert.equal(club.name, 'Dubai HYROX');
    await assert.rejects(createClub('coach-1', clubBody, options), (error) => error.code === 'CLUB_EXISTS');
    await assert.rejects(createClub('coach-pending', clubBody, options), (error) => error.code === 'COACH_NOT_APPROVED');
});

test('coach directory exposes approved clubs only', async () => {
    const { db, options } = harness();
    person(db, 'coach-1', 'Coach Kim', 'approved');
    await createClub('coach-1', clubBody, options);
    const listed = await listCoaches(options);
    assert.equal(listed.coaches.length, 1);
    assert.equal(listed.coaches[0].name, 'Coach Kim');
    assert.equal(listed.coaches[0].specialty, 'HYROX');
    assert.equal(listed.coaches[0].location, 'Dubai');
    assert.equal(listed.coaches[0].clubDescription, 'Club for hybrid athletes.');
    assert.equal(listed.coaches[0].athleteCount, 0);
    assert.equal(listed.coaches[0].documentKey, undefined);
    assert.equal(listed.coaches[0].email, undefined);
    db.applications[0].status = 'suspended';
    const hidden = await listCoaches(options);
    assert.equal(hidden.coaches.length, 0);
});

test('athlete join request can be accepted or declined once, and a second club is refused', async () => {
    const { db, options } = harness();
    person(db, 'coach-1', 'Coach Kim', 'approved');
    person(db, 'coach-2', 'Other Coach', 'approved');
    person(db, 'athlete-1', 'Amina', null);
    const first = await createClub('coach-1', clubBody, options);
    const second = await createClub('coach-2', { ...clubBody, name: 'Other Club' }, options);
    const request = await requestJoin('athlete-1', { clubId: first.id }, options);
    assert.equal(request.status, 'pending');
    await assert.rejects(requestJoin('athlete-1', { clubId: first.id }, options), (error) => error.code === 'JOIN_REQUEST_PENDING');
    await assert.rejects(
        reviewJoin('coach-2', request.id, 'decline', null, options),
        (error) => error.code === 'CLUB_FORBIDDEN'
    );
    const declined = await reviewJoin('coach-1', request.id, 'decline', null, options);
    assert.equal(declined.status, 'declined');
    assert.equal(db.memberships.filter((row) => row.status === 'declined').length, 1);
    const again = await requestJoin('athlete-1', { clubId: first.id }, options);
    const accepted = await reviewJoin('coach-1', again.id, 'accept', '2026-10-26', options);
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.notification.delivered, false);
    const other = await requestJoin('athlete-1', { clubId: second.id }, options).catch((error) => error);
    assert.equal(other.code, 'ACTIVE_CLUB_EXISTS');
    assert.equal(db.memberships.filter((row) => row.athlete_user_id === 'athlete-1' && row.status === 'accepted').length, 1);
});

test('coach creates a program from playable workouts and rejects unknown ids', async () => {
    const { db, options } = harness();
    person(db, 'coach-1', 'Coach Kim', 'approved');
    person(db, 'coach-2', 'Other Coach', 'approved');
    await createClub('coach-1', clubBody, options);
    await assert.rejects(
        createCoachProgram('coach-1', { ...oneWeek, sessions: [{ weekNumber: 1, dayOfWeek: 1, workoutId: 'wk_missing' }] }, options),
        (error) => error.code === 'UNKNOWN_WORKOUT'
    );
    const created = await createCoachProgram('coach-1', oneWeek, options);
    assert.equal(created.visibility, 'club');
    assert.equal(created.publishedToGallery, false);
    assert.equal(created.version.sessions[0].workoutId, 'wk_foundation_a');
    await assert.rejects(getCoachProgram('coach-2', created.id, options), (error) => error.code === 'CLUB_FORBIDDEN');
    await assert.rejects(createCoachProgram('coach-pending', oneWeek, options), (error) => error.code === 'COACH_NOT_APPROVED');
});

test('assignment freezes the version, writes the calendar, and refuses an active program or a date conflict', async () => {
    const { db, options } = harness();
    person(db, 'coach-1', 'Coach Kim', 'approved');
    person(db, 'athlete-1', 'Amina', null);
    person(db, 'athlete-2', 'Noah', null);
    const club = await createClub('coach-1', clubBody, options);
    const join = await requestJoin('athlete-1', { clubId: club.id }, options);
    await reviewJoin('coach-1', join.id, 'accept', '2026-10-26', options);
    const outsider = await requestJoin('athlete-2', { clubId: club.id }, options);
    const program = await createCoachProgram('coach-1', oneWeek, options);
    await assert.rejects(
        assignCoachProgram('coach-1', program.id, { athleteIds: ['athlete-2'] }, '2026-10-26', options),
        (error) => error.code === 'ATHLETE_NOT_IN_CLUB'
    );
    const assigned = await assignCoachProgram('coach-1', program.id, { athleteIds: ['athlete-1'] }, '2026-10-26', options);
    assert.equal(assigned.results[0].status, 'assigned');
    assert.equal(assigned.notification.delivered, false);
    assert.equal(db.xp.length, 0);
    assert.equal(db.scheduled[0].workout_id, 'wk_foundation_a');
    assert.equal(db.scheduled[0].title, 'Foundation Protocol A');
    assert.equal(db.userPrograms[0].coach_program_version_id, assigned.versionId);
    const again = await assignCoachProgram('coach-1', program.id, { athleteIds: ['athlete-1'] }, '2026-10-26', options);
    assert.equal(again.results[0].status, 'already_assigned');
    assert.equal(db.scheduled.length, 1);

    db.userPrograms.push({
        user_id: 'athlete-2',
        program_id: 'hyrox_base_8w',
        start_date: '2026-10-01',
        coach_program_version_id: null,
    });
    await reviewJoin('coach-1', outsider.id, 'accept', '2026-10-26', options);
    const before = db.scheduled.map((row) => ({ ...row }));
    await assert.rejects(
        assignCoachProgram('coach-1', program.id, { athleteIds: ['athlete-2'] }, '2026-10-26', options),
        (error) => error.code === 'PROGRAM_ACTIVE'
    );
    assert.deepEqual(db.scheduled, before);

    const fresh = harness();
    person(fresh.db, 'coach-1', 'Coach Kim', 'approved');
    person(fresh.db, 'athlete-3', 'Lina', null);
    const freshClub = await createClub('coach-1', clubBody, fresh.options);
    const freshJoin = await requestJoin('athlete-3', { clubId: freshClub.id }, fresh.options);
    await reviewJoin('coach-1', freshJoin.id, 'accept', '2026-10-26', fresh.options);
    const freshProgram = await createCoachProgram('coach-1', oneWeek, fresh.options);
    fresh.db.scheduled.push({
        id: 'existing-day',
        user_id: 'athlete-3',
        program_id: 'manual',
        workout_id: 'wk_zone2_run',
        title: 'Already there',
        duration_min: 40,
        scheduled_on: '2026-10-26',
        plan_day: '1',
        week_number: 1,
        status: 'pending',
        completed_at: null,
    });
    await assert.rejects(
        assignCoachProgram('coach-1', freshProgram.id, { athleteIds: ['athlete-3'] }, '2026-10-26', fresh.options),
        (error) => error.code === 'SCHEDULE_CONFLICT'
    );
    assert.equal(fresh.db.userPrograms.length, 0);
    assert.equal(fresh.db.scheduled.length, 1);
    assert.equal(fresh.db.scheduled[0].title, 'Already there');
});

test('broadcast reaches accepted athletes and future members only when enabled', async () => {
    const { db, options } = harness();
    person(db, 'coach-1', 'Coach Kim', 'approved');
    person(db, 'athlete-1', 'Amina', null);
    person(db, 'athlete-2', 'Noah', null);
    person(db, 'athlete-3', 'Lina', null);
    const club = await createClub('coach-1', clubBody, options);
    const firstJoin = await requestJoin('athlete-1', { clubId: club.id }, options);
    await reviewJoin('coach-1', firstJoin.id, 'accept', '2026-10-26', options);
    db.userPrograms.push({
        user_id: 'athlete-1',
        program_id: 'hyrox_base_8w',
        start_date: '2026-10-01',
        coach_program_version_id: null,
    });
    const openProgram = await createCoachProgram('coach-1', oneWeek, options);
    const broadcast = await assignCoachProgram(
        'coach-1',
        openProgram.id,
        { broadcast: true, applyToFutureMembers: true },
        '2026-10-26',
        options
    );
    assert.equal(broadcast.results[0].status, 'program_active');
    assert.equal(db.scheduled.length, 0);
    const late = await requestJoin('athlete-2', { clubId: club.id }, options);
    const accepted = await reviewJoin('coach-1', late.id, 'accept', '2026-11-02', options);
    assert.equal(accepted.programAssignments[0].status, 'assigned');
    assert.equal(db.userPrograms.find((row) => row.user_id === 'athlete-2').start_date, '2026-11-02');
    assert.equal(db.userPrograms.find((row) => row.user_id === 'athlete-1').program_id, 'hyrox_base_8w');

    const closed = await createCoachProgram('coach-1', { ...oneWeek, title: 'Closed block' }, options);
    await assignCoachProgram('coach-1', closed.id, { broadcast: true, applyToFutureMembers: false }, '2026-11-02', options);
    const third = await requestJoin('athlete-3', { clubId: club.id }, options);
    const thirdAccepted = await reviewJoin('coach-1', third.id, 'accept', '2026-11-09', options);
    assert.equal(thirdAccepted.programAssignments.length, 1);
    assert.equal(thirdAccepted.programAssignments[0].status, 'assigned');
    assert.equal(db.userPrograms.find((row) => row.user_id === 'athlete-3').program_id, openProgram.id);
});

test('editing a program after assignment creates a new version and leaves the calendar', async () => {
    const { db, options } = harness();
    person(db, 'coach-1', 'Coach Kim', 'approved');
    person(db, 'athlete-1', 'Amina', null);
    const club = await createClub('coach-1', clubBody, options);
    const join = await requestJoin('athlete-1', { clubId: club.id }, options);
    await reviewJoin('coach-1', join.id, 'accept', '2026-10-26', options);
    const created = await createCoachProgram('coach-1', oneWeek, options);
    const assigned = await assignCoachProgram('coach-1', created.id, { athleteIds: ['athlete-1'] }, '2026-10-26', options);
    const edited = await updateCoachProgram(
        'coach-1',
        created.id,
        { sessions: [{ weekNumber: 1, dayOfWeek: 1, workoutId: 'wk_zone2_run' }] },
        options
    );
    assert.equal(edited.version.versionNo, 2);
    assert.equal(edited.version.sessions[0].workoutId, 'wk_zone2_run');
    assert.equal(db.scheduled[0].workout_id, 'wk_foundation_a');
    assert.equal(db.assignments[0].version_id, assigned.versionId);
    assert.notEqual(edited.version.id, assigned.versionId);
});

test('weekly plan and my program resolve the coach program without awarding XP', async () => {
    const { db, options } = harness();
    person(db, 'coach-1', 'Coach Kim', 'approved');
    person(db, 'athlete-1', 'Amina', null);
    const club = await createClub('coach-1', clubBody, options);
    const join = await requestJoin('athlete-1', { clubId: club.id }, options);
    await reviewJoin('coach-1', join.id, 'accept', '2026-10-26', options);
    const created = await createCoachProgram('coach-1', oneWeek, options);
    await assignCoachProgram('coach-1', created.id, { athleteIds: ['athlete-1'] }, '2026-10-26', options);
    const week = await getWeekPlan('athlete-1', '2026-10-28', '2026-10-26', options);
    assert.equal(week.programName, 'Club Base');
    assert.equal(week.days[0].session.workoutId, 'wk_foundation_a');
    assert.equal(week.days[0].xpEarned, undefined);
    const mine = await getMyProgram('athlete-1', '2026-10-28', options);
    assert.equal(mine.enrollment.programName, 'Club Base');
    assert.equal(mine.enrollment.programSource, 'coach');
    assert.equal(db.xp.length, 0);
    const detail = await athleteDetail('coach-1', 'athlete-1', options);
    assert.equal(detail.performanceStatus.available, false);
    assert.equal(detail.performanceStatus.reason, 'SCORING_RULE_NOT_DEFINED');
    assert.equal(detail.sessions.total, 1);
});

test('legacy catalogs and enrollment blocks stay in place', () => {
    const weeks = programsJson.programs.race_build_12w.weeks;
    const sessions = weeks.reduce((sum, week) => sum + week.days.length, 0);
    assert.equal(Object.keys(programsJson.programs).length, 9);
    assert.equal(sessions, 72);
    assert.equal(contentStatus(getPublicDefinition('race_build_12w')).enrollable, false);
    assert.equal(getPublicDefinition('rox_engine_8w').contentReadiness, 'awaiting_coach_schedule');
});
