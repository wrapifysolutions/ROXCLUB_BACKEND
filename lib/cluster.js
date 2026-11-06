function workerId() {
    const instance = process.env.NODE_APP_INSTANCE;
    if (instance != null && String(instance).trim() !== '') return String(instance);
    return '0';
}

function workerCount() {
    const fromEnv = Number(process.env.WEB_CONCURRENCY);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
    return 1;
}

function isPrimaryWorker() {
    return workerId() === '0';
}

function isClustered() {
    return process.env.NODE_APP_INSTANCE != null || workerCount() > 1;
}

module.exports = { workerId, workerCount, isPrimaryWorker, isClustered };
