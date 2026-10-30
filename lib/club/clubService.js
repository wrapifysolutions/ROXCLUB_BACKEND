const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { assertApprovedCoach } = require('../admin/coachReviewService');
const { SPECIALTIES } = require('../account/accountService');

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

function clean(value, max) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.slice(0, max);
}

function clubInput(body) {
    const name = clean(body?.name, 120);
    const description = clean(body?.description, 2000);
    const specialty = String(body?.specialty || '').trim();
    const location = clean(body?.location, 120);
    if (!name || !location || !SPECIALTIES.has(specialty)) {
        throw httpError(
            'INVALID_CLUB',
            400,
            'Club name, location, and specialty are required. Specialty must be HYROX, Running, Strength, or Hybrid'
        );
    }
    return { name, description, specialty, location };
}

function clubDto(row, extras = {}) {
    if (!row) return null;
    return {
        id: row.id,
        coachUserId: row.coach_user_id,
        name: row.name,
        description: row.description || '',
        specialty: row.specialty,
        location: row.location,
        ...extras,
    };
}

async function loadClubByCoach(coachUserId, query) {
    const { rows } = await query(
        `
        /* club:load_by_coach */
        SELECT id, coach_user_id, name, description, specialty, location
        FROM clubs
        WHERE coach_user_id = $1
        `,
        [coachUserId]
    );
    return rows[0] || null;
}

async function loadClubById(clubId, query) {
    const { rows } = await query(
        `
        /* club:load_club */
        SELECT id, coach_user_id, name, description, specialty, location
        FROM clubs
        WHERE id = $1
        `,
        [clubId]
    );
    return rows[0] || null;
}

async function createClub(userId, body, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await assertApprovedCoach(userId, options);
    const fields = clubInput(body);
    const existing = await loadClubByCoach(userId, query);
    if (existing) {
        throw httpError('CLUB_EXISTS', 409, 'This coach already has a club');
    }
    try {
        const inserted = await query(
            `
            /* club:insert_club */
            INSERT INTO clubs (coach_user_id, name, description, specialty, location)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, coach_user_id, name, description, specialty, location
            `,
            [userId, fields.name, fields.description, fields.specialty, fields.location]
        );
        return clubDto(inserted.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            throw httpError('CLUB_EXISTS', 409, 'This coach already has a club');
        }
        throw error;
    }
}

async function updateClub(userId, body, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await assertApprovedCoach(userId, options);
    const current = await loadClubByCoach(userId, query);
    if (!current) throw httpError('CLUB_NOT_FOUND', 404, 'Club not found');
    const fields = clubInput({
        name: body?.name ?? current.name,
        description: body?.description ?? current.description,
        specialty: body?.specialty ?? current.specialty,
        location: body?.location ?? current.location,
    });
    const updated = await query(
        `
        /* club:update_club */
        UPDATE clubs
        SET name = $2, description = $3, specialty = $4, location = $5, updated_at = NOW()
        WHERE id = $1 AND coach_user_id = $6
        RETURNING id, coach_user_id, name, description, specialty, location
        `,
        [current.id, fields.name, fields.description, fields.specialty, fields.location, userId]
    );
    return clubDto(updated.rows[0]);
}

async function listCoaches(options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    const { rows } = await query(
        `
        /* club:list_coaches */
        SELECT
            c.id,
            c.coach_user_id,
            c.name AS club_name,
            c.description,
            c.specialty,
            c.location,
            COALESCE(app.full_name, u.display_name, 'Coach') AS coach_name,
            (
                SELECT COUNT(*)::int
                FROM club_memberships m
                WHERE m.club_id = c.id AND m.status = 'accepted'
            ) AS athlete_count
        FROM clubs c
        JOIN users u ON u.id = c.coach_user_id
        JOIN LATERAL (
            SELECT full_name, status
            FROM coach_applications
            WHERE user_id = c.coach_user_id
            ORDER BY created_at DESC
            LIMIT 1
        ) app ON TRUE
        WHERE app.status = 'approved'
        ORDER BY c.name
        `
    );
    return {
        coaches: rows.map((row) => ({
            clubId: row.id,
            coachUserId: row.coach_user_id,
            name: row.coach_name,
            specialty: row.specialty,
            location: row.location,
            clubName: row.club_name,
            clubDescription: row.description || '',
            athleteCount: Number(row.athlete_count) || 0,
        })),
    };
}

async function acceptedMembership(athleteUserId, query) {
    const { rows } = await query(
        `
        /* club:accepted_membership */
        SELECT id, club_id, athlete_user_id, status
        FROM club_memberships
        WHERE athlete_user_id = $1 AND status = 'accepted'
        LIMIT 1
        `,
        [athleteUserId]
    );
    return rows[0] || null;
}

async function requestJoin(athleteUserId, body, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    let club = null;
    if (body?.clubId) club = await loadClubById(body.clubId, query);
    else if (body?.coachId) club = await loadClubByCoach(body.coachId, query);
    if (!club) throw httpError('CLUB_NOT_FOUND', 404, 'Club not found');
    if (club.coach_user_id === athleteUserId) {
        throw httpError('CLUB_FORBIDDEN', 403, 'A coach cannot join their own club');
    }
    const accepted = await acceptedMembership(athleteUserId, query);
    if (accepted) {
        throw httpError(
            'ACTIVE_CLUB_EXISTS',
            409,
            'This athlete already belongs to a club. Leaving or switching clubs is not available'
        );
    }
    const pending = await query(
        `
        /* club:pending_membership */
        SELECT id, status
        FROM club_memberships
        WHERE athlete_user_id = $1 AND club_id = $2 AND status = 'pending'
        LIMIT 1
        `,
        [athleteUserId, club.id]
    );
    if (pending.rows[0]) {
        throw httpError('JOIN_REQUEST_PENDING', 409, 'A join request is already pending for this club');
    }
    try {
        const inserted = await query(
            `
            /* club:insert_membership */
            INSERT INTO club_memberships (club_id, athlete_user_id, status)
            VALUES ($1, $2, 'pending')
            RETURNING id, club_id, athlete_user_id, status, requested_at
            `,
            [club.id, athleteUserId]
        );
        return {
            id: inserted.rows[0].id,
            clubId: inserted.rows[0].club_id,
            athleteUserId: inserted.rows[0].athlete_user_id,
            status: inserted.rows[0].status,
        };
    } catch (error) {
        if (error.code === '23505') {
            throw httpError('JOIN_REQUEST_PENDING', 409, 'A join request is already pending for this club');
        }
        throw error;
    }
}

async function reviewJoin(actorId, membershipId, decision, today, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await assertApprovedCoach(actorId, options);
    const loaded = await query(
        `
        /* club:load_membership */
        SELECT id, club_id, athlete_user_id, status
        FROM club_memberships
        WHERE id = $1
        `,
        [membershipId]
    );
    const membership = loaded.rows[0];
    if (!membership) throw httpError('JOIN_REQUEST_NOT_FOUND', 404, 'Join request not found');
    const club = await loadClubById(membership.club_id, query);
    if (!club || club.coach_user_id !== actorId) {
        throw httpError('CLUB_FORBIDDEN', 403, 'This join request belongs to another club');
    }
    if (membership.status !== 'pending') {
        throw httpError('INVALID_MEMBERSHIP', 409, 'Only a pending join request can be reviewed');
    }
    if (decision === 'accept') {
        const accepted = await acceptedMembership(membership.athlete_user_id, query);
        if (accepted) {
            throw httpError(
                'ACTIVE_CLUB_EXISTS',
                409,
                'This athlete already belongs to a club. Leaving or switching clubs is not available'
            );
        }
    }
    const status = decision === 'accept' ? 'accepted' : 'declined';
    let updated;
    try {
        updated = await query(
            `
            /* club:review_membership */
            UPDATE club_memberships
            SET status = $2, reviewed_at = NOW(), reviewed_by = $3, updated_at = NOW()
            WHERE id = $1 AND status = 'pending'
            RETURNING id, club_id, athlete_user_id, status
            `,
            [membership.id, status, actorId]
        );
    } catch (error) {
        if (error.code === '23505') {
            throw httpError(
                'ACTIVE_CLUB_EXISTS',
                409,
                'This athlete already belongs to a club. Leaving or switching clubs is not available'
            );
        }
        throw error;
    }
    const row = updated.rows[0];
    if (!row) throw httpError('INVALID_MEMBERSHIP', 409, 'Only a pending join request can be reviewed');
    let broadcasts = [];
    if (decision === 'accept') {
        const { applyFutureBroadcasts } = require('./coachProgramService');
        broadcasts = await applyFutureBroadcasts(row.athlete_user_id, row.club_id, today, {
            ...options,
            query,
        });
    }
    return {
        id: row.id,
        clubId: row.club_id,
        athleteUserId: row.athlete_user_id,
        status: row.status,
        programAssignments: broadcasts,
        notification: NOTIFICATION,
    };
}

async function listMembers(clubId, status, query) {
    const { rows } = await query(
        `
        /* club:list_members */
        SELECT m.id, m.athlete_user_id, m.status, m.requested_at, u.display_name
        FROM club_memberships m
        JOIN users u ON u.id = m.athlete_user_id
        WHERE m.club_id = $1 AND m.status = $2
        ORDER BY m.requested_at DESC
        `,
        [clubId, status]
    );
    return rows.map((row) => ({
        membershipId: row.id,
        athleteUserId: row.athlete_user_id,
        displayName: row.display_name || null,
        status: row.status,
        requestedAt: row.requested_at,
    }));
}

async function clubHome(userId, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    let coachAccess = false;
    try {
        await assertApprovedCoach(userId, options);
        coachAccess = true;
    } catch (error) {
        if (error.code !== 'COACH_NOT_APPROVED') throw error;
    }
    if (coachAccess) {
        const club = await loadClubByCoach(userId, query);
        if (club) {
            const { rows: programs } = await query(
                `
                /* club:list_programs */
                SELECT id, title, training_goal, status, description
                FROM coach_programs
                WHERE club_id = $1
                ORDER BY created_at DESC
                `,
                [club.id]
            );
            return {
                role: 'coach',
                club: clubDto(club),
                acceptedAthletes: await listMembers(club.id, 'accepted', query),
                pendingJoinRequests: await listMembers(club.id, 'pending', query),
                programs: programs.map((row) => ({
                    id: row.id,
                    title: row.title,
                    description: row.description,
                    trainingGoal: row.training_goal,
                    status: row.status,
                    visibility: 'club',
                })),
            };
        }
    }
    const accepted = await acceptedMembership(userId, query);
    if (accepted) {
        const club = await loadClubById(accepted.club_id, query);
        const coach = await query(
            `
            /* club:coach_public */
            SELECT COALESCE(app.full_name, u.display_name, 'Coach') AS coach_name
            FROM users u
            LEFT JOIN LATERAL (
                SELECT full_name
                FROM coach_applications
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT 1
            ) app ON TRUE
            WHERE u.id = $1
            `,
            [club.coach_user_id]
        );
        const enrollment = await query(
            `
            /* club:athlete_program */
            SELECT program_id, start_date::text AS start_date, coach_program_version_id
            FROM user_programs
            WHERE user_id = $1
            `,
            [userId]
        );
        return {
            role: 'athlete',
            membershipStatus: 'accepted',
            club: clubDto(club),
            coach: {
                coachUserId: club.coach_user_id,
                name: coach.rows[0]?.coach_name || 'Coach',
                specialty: club.specialty,
                location: club.location,
                clubDescription: club.description || '',
            },
            activeProgram: enrollment.rows[0]
                ? {
                      programId: enrollment.rows[0].program_id,
                      startDate: enrollment.rows[0].start_date,
                      coachProgramVersionId: enrollment.rows[0].coach_program_version_id || null,
                  }
                : null,
        };
    }
    const pending = await query(
        `
        /* club:own_pending */
        SELECT m.id, m.club_id, c.name
        FROM club_memberships m
        JOIN clubs c ON c.id = m.club_id
        WHERE m.athlete_user_id = $1 AND m.status = 'pending'
        ORDER BY m.requested_at DESC
        LIMIT 1
        `,
        [userId]
    );
    if (pending.rows[0]) {
        return {
            role: 'athlete',
            membershipStatus: 'pending',
            joinRequestId: pending.rows[0].id,
            club: { id: pending.rows[0].club_id, name: pending.rows[0].name },
        };
    }
    return { role: coachAccess ? 'coach' : 'none', club: null };
}

async function athleteDetail(actorId, athleteId, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await assertApprovedCoach(actorId, options);
    const club = await loadClubByCoach(actorId, query);
    if (!club) throw httpError('CLUB_NOT_FOUND', 404, 'Club not found');
    const member = await query(
        `
        /* club:member_in_club */
        SELECT m.id, m.status, u.display_name
        FROM club_memberships m
        JOIN users u ON u.id = m.athlete_user_id
        WHERE m.club_id = $1 AND m.athlete_user_id = $2 AND m.status = 'accepted'
        `,
        [club.id, athleteId]
    );
    if (!member.rows[0]) {
        throw httpError('ATHLETE_NOT_IN_CLUB', 403, 'This athlete is not an accepted member of your club');
    }
    const enrollment = await query(
        `
        /* club:athlete_program */
        SELECT program_id, start_date::text AS start_date, coach_program_version_id
        FROM user_programs
        WHERE user_id = $1
        `,
        [athleteId]
    );
    const counts = await query(
        `
        /* club:session_counts */
        SELECT
            COUNT(*)::int AS total_sessions,
            COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed_sessions
        FROM scheduled_sessions
        WHERE user_id = $1
        `,
        [athleteId]
    );
    const program = enrollment.rows[0] || null;
    return {
        athlete: {
            id: athleteId,
            displayName: member.rows[0].display_name || null,
            membershipId: member.rows[0].id,
        },
        activeProgram: program
            ? {
                  programId: program.program_id,
                  startDate: program.start_date,
                  coachProgramVersionId: program.coach_program_version_id || null,
              }
            : null,
        sessions: {
            total: Number(counts.rows[0]?.total_sessions) || 0,
            completed: Number(counts.rows[0]?.completed_sessions) || 0,
        },
        performanceStatus: {
            available: false,
            reason: 'SCORING_RULE_NOT_DEFINED',
        },
    };
}

module.exports = {
    createClub,
    updateClub,
    listCoaches,
    requestJoin,
    reviewJoin,
    clubHome,
    athleteDetail,
    loadClubByCoach,
    NOTIFICATION,
};
