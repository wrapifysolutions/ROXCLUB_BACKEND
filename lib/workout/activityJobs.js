const { queryWithHardTimeout } = require('../dbQuery');
const { runDnaEvidence, runStationEvidence } = require('./evidenceWorkers');

async function queueActivityRecorded(activityId, query) {
    if (!activityId) return null;
    const runQuery = query || queryWithHardTimeout;
    await runDnaEvidence(activityId, runQuery);
    await runStationEvidence(activityId, runQuery);
    return true;
}

module.exports = { queueActivityRecorded };
