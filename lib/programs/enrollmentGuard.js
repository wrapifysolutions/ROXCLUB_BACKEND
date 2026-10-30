const {
    getPublicDefinition,
    contentStatus,
    getScheduleProgram,
    scheduleSummary,
} = require('./publicCatalog');

/**
 * Programs that must not receive NEW user_programs / scheduled_sessions
 * until a coach-approved schedule is linked on the public definition.
 * Existing enrollments are preserved elsewhere and are not rewritten here.
 */
function newAssignmentBlock(programId) {
    const id = String(programId || '');
    const definition = getPublicDefinition(id);
    if (!definition) return null;

    const content = contentStatus(definition);
    if (content.enrollable) return null;

    const legacy = id === 'race_build_12w' ? getScheduleProgram('race_build_12w') : null;
    const legacySummary = legacy ? scheduleSummary(legacy) : null;

    return {
        code: 'PROGRAM_NOT_ENROLLABLE',
        productCode: 'PRODUCT_CONFIGURATION_BLOCKER',
        reason: content.reason || 'missing_approved_schedule',
        message:
            id === 'race_build_12w'
                ? 'Race Build cannot accept new enrollments until a coach-approved 3-workouts-per-week schedule is available'
                : 'This program is not enrollable until a coach-approved schedule is available',
        programId: id,
        contentReadiness: content.status,
        intendedFrequency:
            definition.intendedWorkoutsPerWeek != null
                ? {
                      workoutsPerWeek: definition.intendedWorkoutsPerWeek,
                      targetTrainingSessions: definition.intendedTrainingSessions,
                      source: 'product_target',
                  }
                : null,
        legacySchedule:
            legacySummary != null
                ? {
                      exists: true,
                      approved: false,
                      workoutsPerWeek: legacySummary.workoutsPerWeek,
                      totalScheduledSessions: legacySummary.totalScheduledSessions,
                      note: 'Legacy internal schedule retained for existing users only; not approved for new enrollments',
                  }
                : null,
        affectedOnboardingPaths:
            id === 'race_build_12w'
                ? [{ goal: 'hyrox', level: 'Intermediate', matchedProgramId: 'race_build_12w' }]
                : [],
    };
}

function assertNewAssignmentAllowed(programId) {
    const block = newAssignmentBlock(programId);
    if (!block) return;
    const error = new Error(block.message);
    error.status = 409;
    error.code = block.productCode;
    error.enrollError = block.code;
    error.details = block;
    throw error;
}

module.exports = {
    newAssignmentBlock,
    assertNewAssignmentAllowed,
};
