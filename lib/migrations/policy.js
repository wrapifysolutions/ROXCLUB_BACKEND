function isProductionRuntime() {
    return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

function schemaMutationsAllowed() {
    const apply = String(process.env.APPLY_SCHEMA_MIGRATIONS || '').toLowerCase() === 'true';
    const allowProd = String(process.env.ALLOW_PRODUCTION_MIGRATIONS || '').toLowerCase() === 'true';
    if (isProductionRuntime()) return apply && allowProd;
    if (process.env.NODE_ENV === 'test') return apply;
    if (String(process.env.APPLY_SCHEMA_MIGRATIONS || '').toLowerCase() === 'false') return false;
    return apply;
}

function assertMigrateSafety() {
    if (!schemaMutationsAllowed()) {
        const error = new Error(
            'Schema mutations are disabled. Set APPLY_SCHEMA_MIGRATIONS=true (and ALLOW_PRODUCTION_MIGRATIONS=true only with explicit production approval).'
        );
        error.code = 'MIGRATIONS_DISABLED';
        throw error;
    }
}

module.exports = { isProductionRuntime, schemaMutationsAllowed, assertMigrateSafety };
