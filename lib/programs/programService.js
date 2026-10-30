const { queryWithHardTimeout, withTransaction } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { expandProgramSessions, addDays } = require('../onboarding/programCatalog');
const scheduleCatalog = require('../../data/programs.json');
const { getWorkout } = require('../workouts/workoutCatalog');
const { mondayOf, daysBetween, phaseFor } = require('../plan/adaptationService');
const {
    listPublicDefinitions,
    getPublicDefinition,
    getScheduleProgram,
    phasesFor,
    contentStatus,
    displayNameFor,
} = require('./publicCatalog');
const { loadAssignedCoachProgram } = require('../club/programContext');

const DONE = new Set(['done', 'partial', 'replaced']);

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

async function ready(options) {
    if (options?.query) return;
    await ensureOnboardingProfileSchema();
}

function intendedFrequencyDto(definition) {
    if (definition.intendedWorkoutsPerWeek == null) return null;
    return {
        workoutsPerWeek: Number(definition.intendedWorkoutsPerWeek),
        targetTrainingSessions:
            definition.intendedTrainingSessions != null
                ? Number(definition.intendedTrainingSessions)
                : null,
        source: 'product_target',
    };
}

function workoutFrequencyDto(definition, content) {
    const intended = intendedFrequencyDto(definition);
    if (intended) {
        return {
            workoutsPerWeek: intended.workoutsPerWeek,
            targetTrainingSessions: intended.targetTrainingSessions,
            restDaysPerWeek: null,
            sessionDurationMin: null,
            source: 'product_target',
        };
    }
    if (content.enrollable && content.scheduleSummary) {
        return {
            workoutsPerWeek: content.scheduleSummary.workoutsPerWeek,
            targetTrainingSessions: content.scheduleSummary.totalScheduledSessions,
            restDaysPerWeek: content.scheduleSummary.restDaysPerWeek,
            sessionDurationMin: content.scheduleSummary.sessionDurationMin,
            source: 'approved_schedule',
        };
    }
    return null;
}

function legacyScheduleDto(definition) {
    if (definition.contentReadiness === 'ready' && definition.scheduleProgramId) return null;
    // Race Build (and similar) may still have an internal legacy calendar that must not be shown as approved.
    if (definition.id !== 'race_build_12w') return null;
    const legacy = getScheduleProgram('race_build_12w');
    if (!legacy?.weeks?.length) return null;
    const summary = require('./publicCatalog').scheduleSummary(legacy);
    return {
        exists: true,
        approved: false,
        workoutsPerWeek: summary.workoutsPerWeek,
        totalScheduledSessions: summary.totalScheduledSessions,
        note: 'Legacy internal schedule retained for existing enrolled users only; not an approved public Race Build plan',
    };
}

function cardDto(definition, { hasActiveProgram }) {
    const content = contentStatus(definition);
    const canEnroll = content.enrollable && !hasActiveProgram;
    return {
        id: definition.id,
        name: definition.name,
        durationWeeks: definition.durationWeeks,
        description: definition.description,
        difficulty: definition.difficulty,
        goals: definition.goals,
        imageUrl: definition.imageUrl,
        tags: definition.tags || [],
        phases: definition.phases,
        intendedFrequency: intendedFrequencyDto(definition),
        workoutFrequency: workoutFrequencyDto(definition, content),
        contentReadiness: content.status,
        enrollable: content.enrollable,
        canEnroll,
        enrollmentBlockedReason: !content.enrollable
            ? content.reason
            : hasActiveProgram
              ? 'active_program_exists'
              : null,
        missingContent: content.missing,
    };
}

function detailDto(definition, { hasActiveProgram, activeProgramId }) {
    const card = cardDto(definition, { hasActiveProgram });
    const approvedSchedule =
        contentStatus(definition).enrollable && definition.scheduleProgramId
            ? getScheduleProgram(definition.scheduleProgramId)
            : null;
    const weekPreview =
        approvedSchedule?.weeks?.map((week) => ({
            weekNumber: Number(week.week),
            sessionCount: (week.days || []).length,
            restDays: Math.max(0, 7 - (week.days || []).length),
            workoutIds: (week.days || []).map((day) => day.workoutId),
        })) || null;

    return {
        ...card,
        isActive: activeProgramId === definition.id,
        scheduleAvailable: Boolean(approvedSchedule?.weeks?.length),
        weekPreview,
        legacySchedule: legacyScheduleDto(definition),
        phases: phasesFor(definition.id),
    };
}

async function loadEnrollment(userId, query) {
    const { rows } = await query(
        `
        /* programs:load_enrollment */
        SELECT program_id, start_date::text AS start_date, coach_program_version_id
        FROM user_programs
        WHERE user_id = $1
        `,
        [userId]
    );
    return rows[0] || null;
}

function weekNumberFor(startDate, today) {
    const weekStart = mondayOf(today);
    const programWeekStart = mondayOf(startDate);
    const days = daysBetween(programWeekStart, weekStart);
    if (days == null || days < 0) return 1;
    return Math.floor(days / 7) + 1;
}

function resolveTotalWeeks(programId) {
    const pub = getPublicDefinition(programId);
    if (pub?.durationWeeks) return Number(pub.durationWeeks);
    const schedule = scheduleCatalog.programs?.[programId];
    return schedule?.weeks?.length || 1;
}

function resolveProgramName(programId) {
    const schedule = scheduleCatalog.programs?.[programId];
    return displayNameFor(programId, schedule?.name || programId);
}

async function loadSessionStats(userId, query) {
    const { rows } = await query(
        `
        /* programs:session_stats */
        SELECT
            s.id,
            s.workout_id,
            s.scheduled_on::text AS scheduled_on,
            s.status,
            s.completed_at,
            CASE WHEN m.id IS NOT NULL AND m.status = 'unresolved' THEN TRUE ELSE FALSE END AS is_missed_unresolved,
            CASE WHEN m.id IS NOT NULL AND m.action = 'skipped' THEN TRUE ELSE FALSE END AS is_skipped
        FROM scheduled_sessions s
        LEFT JOIN missed_sessions m ON m.scheduled_session_id = s.id
        WHERE s.user_id = $1
        `,
        [userId]
    );
    return rows;
}

function progressFromSessions(rows, { startDate, today, programId, totalWeeks }) {
    const countable = [];
    let completed = 0;
    let missed = 0;
    let skipped = 0;
    let pending = 0;

    for (const row of rows) {
        const type = getWorkout(row.workout_id)?.type || scheduleCatalog.workouts?.[row.workout_id]?.category;
        const isRecovery = type === 'recovery';
        const status = row.status || (row.completed_at ? 'done' : 'pending');
        if (isRecovery) continue;
        countable.push(row);
        if (DONE.has(status)) {
            completed += 1;
            continue;
        }
        if (row.is_skipped || status === 'skipped') {
            skipped += 1;
            continue;
        }
        if (row.is_missed_unresolved || status === 'missed' || (status === 'pending' && row.scheduled_on < today)) {
            missed += 1;
            continue;
        }
        pending += 1;
    }

    const total = countable.length;
    const remaining = Math.max(0, total - completed - skipped);
    const currentWeek = Math.min(weekNumberFor(startDate, today), totalWeeks);
    const phase = phaseFor(currentWeek, totalWeeks, programId);

    return {
        totalScheduledSessions: total,
        completedSessions: completed,
        remainingSessions: remaining,
        missedSessions: missed,
        skippedSessions: skipped,
        pendingSessions: pending,
        currentWeek,
        totalWeeks,
        progressPct: total === 0 ? 0 : Math.round((completed / total) * 100),
        phase,
    };
}

async function listPrograms(userId, today, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    const enrollment = await loadEnrollment(userId, query);
    const hasActiveProgram = Boolean(enrollment);
    return {
        programs: listPublicDefinitions().map((definition) =>
            cardDto(definition, { hasActiveProgram })
        ),
        activeProgramId: enrollment?.program_id || null,
    };
}

async function getProgram(userId, programId, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    const definition = getPublicDefinition(programId);
    if (!definition) throw httpError('PROGRAM_NOT_FOUND', 404, 'Program not found');
    const enrollment = await loadEnrollment(userId, query);
    return detailDto(definition, {
        hasActiveProgram: Boolean(enrollment),
        activeProgramId: enrollment?.program_id || null,
    });
}

async function getMyProgram(userId, today, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    const enrollment = await loadEnrollment(userId, query);
    if (!enrollment) {
        return {
            enrollment: null,
            emptyState: {
                title: 'No active program',
                message: 'Explore programs to follow a routine and track performance.',
            },
        };
    }

    const programId = enrollment.program_id;
    const coachProgram = enrollment.coach_program_version_id
        ? await loadAssignedCoachProgram(enrollment.coach_program_version_id, query)
        : null;
    const totalWeeks = coachProgram?.durationWeeks || resolveTotalWeeks(programId);
    const rows = await loadSessionStats(userId, query);
    const progress = progressFromSessions(rows, {
        startDate: enrollment.start_date,
        today,
        programId,
        totalWeeks,
    });
    const pub = getPublicDefinition(programId);
    const continueWeekStart = mondayOf(
        addDays(mondayOf(enrollment.start_date), (progress.currentWeek - 1) * 7)
    );
    const raceBuildLegacy =
        programId === 'race_build_12w' && pub && pub.contentReadiness !== 'ready'
            ? {
                  scheduleProvenance: 'legacy_unapproved',
                  approvedProductFrequency: intendedFrequencyDto(pub),
                  note: 'Active calendar reflects the legacy schedule already assigned to this user; it is not the approved 3-workouts-per-week Race Build product',
              }
            : null;

    return {
        enrollment: {
            programId,
            programName: coachProgram?.title || resolveProgramName(programId),
            ...(coachProgram
                ? { programSource: 'coach', coachProgramVersionId: coachProgram.versionId }
                : {}),
            isPublicLibrary: Boolean(pub),
            imageUrl: pub?.imageUrl || null,
            tags: pub?.tags || [],
            startDate: enrollment.start_date,
            status: 'active',
            currentWeek: progress.currentWeek,
            totalWeeks: progress.totalWeeks,
            phase: progress.phase,
            phases: phasesFor(programId),
            progress: {
                completedSessions: progress.completedSessions,
                totalScheduledSessions: progress.totalScheduledSessions,
                remainingSessions: progress.remainingSessions,
                missedSessions: progress.missedSessions,
                skippedSessions: progress.skippedSessions,
                progressPct: progress.progressPct,
            },
            continue: {
                action: 'continue_program',
                label: `Continue Week ${progress.currentWeek}`,
                weekNumber: progress.currentWeek,
                weekStart: continueWeekStart,
                planPath: `/api/plan/week?weekStart=${continueWeekStart}`,
            },
            ...(raceBuildLegacy || {}),
        },
    };
}

async function enrollProgram(userId, programId, today, options = {}) {
    await ready(options);
    const definition = getPublicDefinition(programId);
    if (!definition) throw httpError('PROGRAM_NOT_FOUND', 404, 'Program not found');

    const { newAssignmentBlock } = require('./enrollmentGuard');
    const blocked = newAssignmentBlock(programId);
    if (blocked) {
        throw httpError('PROGRAM_NOT_ENROLLABLE', 409, blocked.message);
    }

    const content = contentStatus(definition);
    if (!content.enrollable) {
        throw httpError(
            'PROGRAM_NOT_ENROLLABLE',
            409,
            content.reason === 'missing_approved_schedule'
                ? 'This program is not enrollable until a coach-approved schedule is available'
                : `Program cannot be enrolled (${content.reason})`
        );
    }

    const schedule = getScheduleProgram(definition.scheduleProgramId);
    if (!schedule) {
        throw httpError('PROGRAM_NOT_ENROLLABLE', 409, 'Approved schedule is missing');
    }

    const validation = require('./publicCatalog').validateSchedule(schedule);
    if (!validation.ok) {
        throw httpError('PROGRAM_SCHEDULE_INVALID', 409, 'Program schedule failed validation');
    }

    const startDate = options.startDate || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        throw httpError('INVALID_DATE', 400, 'startDate must be YYYY-MM-DD');
    }

    const sessions = expandProgramSessions(schedule, startDate);
    const run = async (clientQuery) => {
        await clientQuery(
            `
            /* programs:lock_user */
            SELECT id FROM users WHERE id = $1 FOR UPDATE
            `,
            [userId]
        );
        const existing = await clientQuery(
            `
            /* programs:existing_enrollment */
            SELECT program_id, start_date::text AS start_date
            FROM user_programs
            WHERE user_id = $1
            `,
            [userId]
        );
        if (existing.rows[0]) {
            if (existing.rows[0].program_id === programId) {
                throw httpError('ALREADY_ENROLLED', 409, 'Already enrolled in this program');
            }
            throw httpError(
                'PROGRAM_ACTIVE',
                409,
                'An active program already exists; switching programs is not supported'
            );
        }

        await clientQuery(
            `
            /* programs:insert_enrollment */
            INSERT INTO user_programs (user_id, program_id, start_date)
            VALUES ($1, $2, $3::date)
            `,
            [userId, programId, startDate]
        );

        await clientQuery(
            `
            /* programs:insert_sessions */
            INSERT INTO scheduled_sessions (
                user_id, program_id, workout_id, title, duration_min,
                scheduled_on, plan_day, week_number
            )
            SELECT
                $1,
                x.program_id,
                x.workout_id,
                x.title,
                x.duration_min,
                x.scheduled_on::date,
                x.plan_day,
                x.week_number
            FROM jsonb_to_recordset($2::jsonb) AS x(
                program_id text,
                workout_id text,
                title text,
                duration_min int,
                scheduled_on text,
                plan_day text,
                week_number int
            )
            ON CONFLICT (user_id, scheduled_on) DO NOTHING
            `,
            [userId, JSON.stringify(sessions)]
        );

        return {
            created: true,
            programId,
            startDate,
            sessionCount: sessions.length,
        };
    };

    try {
        if (options.query) {
            return await run(options.query);
        }
        return await withTransaction((client) => run((sql, params) => client.query(sql, params)));
    } catch (error) {
        if (error?.code === '23505') {
            throw httpError(
                'PROGRAM_ACTIVE',
                409,
                'An active program already exists; switching programs is not supported'
            );
        }
        throw error;
    }
}

module.exports = {
    listPrograms,
    getProgram,
    getMyProgram,
    enrollProgram,
    cardDto,
    detailDto,
    progressFromSessions,
    weekNumberFor,
};
