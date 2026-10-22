const matchConfig = require('../../config/program-match.json');
const catalog = require('../../data/programs.json');
const homeConfig = require('../../config/home.json');

function resolveProgram(goal, level) {
    const goalKey = String(goal || '').trim().toLowerCase();
    const levelKey = String(level || '').trim().toLowerCase();
    const rule = matchConfig.rules.find(
        (item) =>
            String(item.goal).trim().toLowerCase() === goalKey &&
            String(item.level).trim().toLowerCase() === levelKey
    );
    const programId = rule?.programId || matchConfig.defaultProgramId;
    const program = catalog.programs[programId];
    if (!program) {
        const error = new Error(`Program ${programId} is missing from programs.json`);
        error.status = 500;
        throw error;
    }
    return program;
}

function workoutById(workoutId) {
    return catalog.workouts[workoutId] || null;
}

function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function expandProgramSessions(program, startDate) {
    const sessions = [];
    for (const week of program.weeks) {
        for (const day of week.days) {
            const workout = workoutById(day.workoutId);
            if (!workout) {
                throw new Error(`Unknown workout ${day.workoutId}`);
            }
            const offset = (Number(week.week) - 1) * 7 + (Number(day.day) - 1);
            sessions.push({
                program_id: program.id,
                workout_id: workout.id,
                title: workout.title,
                duration_min: workout.durationMin,
                scheduled_on: addDays(startDate, offset),
                plan_day: String(day.day),
                week_number: Number(week.week),
                workout,
            });
        }
    }
    return sessions;
}

function nextLevelXp() {
    return homeConfig.nextLevelXp;
}

function recoveryScoreThreshold() {
    return homeConfig.recoveryScoreThreshold;
}

function levelFromXp(totalXp) {
    const step = nextLevelXp();
    const total = Math.max(0, Number(totalXp) || 0);
    return {
        level: Math.floor(total / step) + 1,
        xp: total % step,
        nextLevelXp: step,
    };
}

module.exports = {
    resolveProgram,
    workoutById,
    expandProgramSessions,
    addDays,
    nextLevelXp,
    recoveryScoreThreshold,
    levelFromXp,
};
