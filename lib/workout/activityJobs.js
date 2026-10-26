const { queryWithHardTimeout } = require('../dbQuery');
const { runDnaEvidence, runStationEvidence } = require('./evidenceWorkers');

function queueActivityRecorded(activityId, query) {
    if (!activityId) return Promise.resolve(null);
    const runQuery = query || queryWithHardTimeout;
    return Promise.resolve()
        .then(() => Promise.all([runDnaEvidence(activityId, runQuery), runStationEvidence(activityId, runQuery)]))
        .catch((error) => {
            console.error('ActivityRecorded job failed', error.message);
            return null;
        });
}

module.exports = { queueActivityRecorded };
