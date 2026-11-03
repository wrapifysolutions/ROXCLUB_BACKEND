const { runStatements } = require('../dbQuery');
const { createClubsTable } = require('../../models/Club/ClubSchema');
const { arenaStatements } = require('../../models/Arena/ArenaSchema');

let tablesReady = false;
let pending = null;

async function ensureArenaTables(options = {}) {
    if (options.query) return;
    if (tablesReady) return;
    if (!pending) {
        pending = runStatements([createClubsTable, ...arenaStatements], 30000)
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

module.exports = { ensureArenaTables };
