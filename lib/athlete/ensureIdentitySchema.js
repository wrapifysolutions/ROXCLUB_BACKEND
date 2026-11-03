const { runStatements } = require('../dbQuery');
const { athleteEngineStatements } = require('../../models/Athlete/AthleteEngineSchema');

const identityStatements = athleteEngineStatements.filter((sql) =>
    String(sql).includes('activity_identity_links')
);

let tablesReady = false;
let pending = null;

async function ensureIdentityTables(options = {}) {
    if (options.query) return;
    if (tablesReady) return;
    if (!pending) {
        pending = runStatements(identityStatements, 30000)
            .then(() => {
                tablesReady = true;
                return true;
            })
            .catch((error) => {
                pending = null;
                throw error;
            });
    }
    return pending;
}

module.exports = { ensureIdentityTables };
