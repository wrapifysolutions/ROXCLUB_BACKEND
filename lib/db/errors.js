function isMissingRelation(error) {
    return error?.code === '42P01' || error?.code === '42703';
}

function databaseNotReady(feature, cause) {
    const error = new Error(
        feature
            ? `Database schema is not ready (${feature}). Apply versioned migrations before serving traffic.`
            : 'Database schema is not ready. Apply versioned migrations before serving traffic.'
    );
    error.code = 'DATABASE_NOT_READY';
    error.status = 503;
    error.feature = feature || null;
    if (cause) error.cause = cause;
    return error;
}

function throwIfMissingRelation(error, feature) {
    if (isMissingRelation(error)) throw databaseNotReady(feature, error);
    throw error;
}

module.exports = { isMissingRelation, databaseNotReady, throwIfMissingRelation };
