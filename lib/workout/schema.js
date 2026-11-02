const { runStatements } = require('../dbQuery');
const { workoutSessionStatements } = require('../../models/Workouts/WorkoutSessionSchema');

let pending = null;

function ensureWorkoutSessionSchema() {
    if (!pending) {
        const { schemaMutationsAllowed } = require('../migrations/policy');
        if (!schemaMutationsAllowed()) {
            pending = Promise.resolve();
            return pending;
        }
        pending = runStatements(workoutSessionStatements).catch((error) => {
            pending = null;
            throw error;
        });
    }
    return pending;
}

function markWorkoutSessionSchemaReady() {
    if (!pending) pending = Promise.resolve();
}

module.exports = {
    ensureWorkoutSessionSchema,
    markWorkoutSessionSchemaReady,
    workoutSessionStatements,
};
