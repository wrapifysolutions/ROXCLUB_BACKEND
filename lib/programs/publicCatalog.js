const publicCatalog = require('../../data/public-programs.json');
const scheduleCatalog = require('../../data/programs.json');
const { getWorkout, loadWorkoutCatalog } = require('../workouts/workoutCatalog');

let catalogLoaded = false;

function ensureWorkoutCatalog() {
    if (!catalogLoaded) {
        loadWorkoutCatalog();
        catalogLoaded = true;
    }
}

function listPublicDefinitions() {
    return [...(publicCatalog.programs || [])].sort(
        (left, right) => Number(left.sortOrder) - Number(right.sortOrder)
    );
}

function getPublicDefinition(programId) {
    return listPublicDefinitions().find((item) => item.id === programId) || null;
}

function getScheduleProgram(scheduleProgramId) {
    if (!scheduleProgramId) return null;
    return scheduleCatalog.programs?.[scheduleProgramId] || null;
}

function phasesFor(programId) {
    const pub = getPublicDefinition(programId);
    if (Array.isArray(pub?.phases) && pub.phases.length) return pub.phases;
    return null;
}

function phaseNameFor(programId, weekNumber, totalWeeks) {
    const phases = phasesFor(programId);
    if (phases) {
        const week = Math.max(1, Number(weekNumber) || 1);
        const match = phases.find(
            (phase) => week >= Number(phase.weeksFrom) && week <= Number(phase.weeksTo)
        );
        if (match) return match.name;
        return phases[phases.length - 1]?.name || null;
    }
    return null;
}

function scheduleSummary(scheduleProgram) {
    if (!scheduleProgram?.weeks?.length) return null;
    const dayCounts = scheduleProgram.weeks.map((week) => (week.days || []).length);
    const workoutsPerWeek = dayCounts.length
        ? Math.round(dayCounts.reduce((sum, n) => sum + n, 0) / dayCounts.length)
        : 0;
    const durations = [];
    for (const week of scheduleProgram.weeks) {
        for (const day of week.days || []) {
            const local = scheduleCatalog.workouts?.[day.workoutId];
            if (local?.durationMin != null) durations.push(Number(local.durationMin));
        }
    }
    return {
        weeks: scheduleProgram.weeks.length,
        workoutsPerWeek,
        restDaysPerWeek: Math.max(0, 7 - workoutsPerWeek),
        sessionDurationMin:
            durations.length > 0
                ? { min: Math.min(...durations), max: Math.max(...durations) }
                : null,
        totalScheduledSessions: dayCounts.reduce((sum, n) => sum + n, 0),
    };
}

function validateSchedule(scheduleProgram) {
    ensureWorkoutCatalog();
    const missingWorkoutIds = [];
    const weeks = scheduleProgram?.weeks || [];
    if (!weeks.length) {
        return {
            ok: false,
            reason: 'missing_approved_schedule',
            missing: ['weekly_schedule'],
            missingWorkoutIds: [],
        };
    }
    for (const week of weeks) {
        for (const day of week.days || []) {
            const id = day.workoutId;
            const embedded = scheduleCatalog.workouts?.[id];
            const catalog = getWorkout(id);
            if (!embedded && !catalog) missingWorkoutIds.push(id);
        }
    }
    const uniqueMissing = [...new Set(missingWorkoutIds)];
    if (uniqueMissing.length) {
        return {
            ok: false,
            reason: 'unresolved_workout_ids',
            missing: ['workout_ids'],
            missingWorkoutIds: uniqueMissing,
        };
    }
    return { ok: true, reason: null, missing: [], missingWorkoutIds: [] };
}

function contentStatus(definition) {
    const readiness = definition.contentReadiness || 'awaiting_coach_schedule';
    if (readiness !== 'ready' || !definition.scheduleProgramId) {
        return {
            status: readiness === 'ready' ? 'awaiting_coach_schedule' : readiness,
            enrollable: false,
            reason: 'missing_approved_schedule',
            missing: ['weekly_schedule'],
            missingWorkoutIds: [],
            scheduleSummary: null,
        };
    }
    const schedule = getScheduleProgram(definition.scheduleProgramId);
    if (!schedule) {
        return {
            status: 'awaiting_coach_schedule',
            enrollable: false,
            reason: 'missing_approved_schedule',
            missing: ['schedule_program'],
            missingWorkoutIds: [],
            scheduleSummary: null,
        };
    }
    const validation = validateSchedule(schedule);
    const summary = scheduleSummary(schedule);
    if (!validation.ok) {
        return {
            status: 'awaiting_coach_schedule',
            enrollable: false,
            reason: validation.reason,
            missing: validation.missing,
            missingWorkoutIds: validation.missingWorkoutIds,
            scheduleSummary: summary,
        };
    }
    if (Number(definition.durationWeeks) !== Number(summary.weeks)) {
        return {
            status: 'awaiting_coach_schedule',
            enrollable: false,
            reason: 'duration_mismatch',
            missing: ['durationWeeks'],
            missingWorkoutIds: [],
            scheduleSummary: summary,
        };
    }
    return {
        status: 'ready',
        enrollable: true,
        reason: null,
        missing: [],
        missingWorkoutIds: [],
        scheduleSummary: summary,
    };
}

function displayNameFor(programId, fallbackName) {
    return getPublicDefinition(programId)?.name || fallbackName || programId;
}

function internalProgramIds() {
    return Object.keys(scheduleCatalog.programs || {});
}

module.exports = {
    listPublicDefinitions,
    getPublicDefinition,
    getScheduleProgram,
    phasesFor,
    phaseNameFor,
    scheduleSummary,
    validateSchedule,
    contentStatus,
    displayNameFor,
    internalProgramIds,
};
