function resolvePoolMax(env = process.env) {
    const parsed = Number(env.PG_POOL_MAX);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(Math.floor(parsed), 32);
    if (env.VERCEL) return 3;
    const workers = Number(env.WEB_CONCURRENCY);
    const workerCount = Number.isFinite(workers) && workers > 0 ? workers : 1;
    const clustered = env.NODE_APP_INSTANCE != null || workerCount > 1;
    if (clustered) return Math.max(4, Math.min(8, Math.floor(16 / workerCount)));
    return 12;
}

module.exports = { resolvePoolMax };
