const { runStatements } = require('../dbQuery');
const { createMissedSessionsTable, createMissedSessionsIndex } = require('../../models/Plan/PlanSchema');

const planStatements = [createMissedSessionsTable, createMissedSessionsIndex];

let pending = null;

function ensurePlanSchema() {
    if (!pending) {
        pending = runStatements(planStatements).catch((error) => {
            pending = null;
            throw error;
        });
    }
    return pending;
}

function markPlanSchemaReady() {
    if (!pending) pending = Promise.resolve();
}

module.exports = { ensurePlanSchema, markPlanSchemaReady, planStatements };
