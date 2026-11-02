function parseConnectionUrl(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

function connectionFingerprint(value) {
    const parsed = parseConnectionUrl(value);
    if (!parsed) return null;
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${parsed.hostname}${port}${parsed.pathname}`;
}

function describeConnection(value) {
    const parsed = parseConnectionUrl(value);
    if (!parsed) return { host: null, database: null };
    return {
        host: parsed.hostname || null,
        database: decodeURIComponent((parsed.pathname || '').replace(/^\//, '')) || null,
    };
}

function redactConnection(value) {
    const parsed = parseConnectionUrl(value);
    if (!parsed) return '[unparseable-database-url]';
    if (parsed.password) parsed.password = '***';
    if (parsed.username) parsed.username = parsed.username ? '[user]' : '';
    return parsed.toString();
}

function identifiedEnvironment(env, argv = []) {
    if (argv.includes('--staging')) return 'staging';
    const named = String(env.ROXCLUB_ENV || '').trim().toLowerCase();
    if (named) return named;
    return null;
}

function migrateSafetyError(code, message) {
    const error = new Error(message);
    error.code = code;
    error.status = 500;
    return error;
}

function resolveMigrateTarget(env = process.env, argv = process.argv.slice(2)) {
    const environment = identifiedEnvironment(env, argv);
    if (!environment) {
        throw migrateSafetyError(
            'ENV_UNIDENTIFIED',
            'Refusing to migrate: set ROXCLUB_ENV=development|staging|production or pass --staging.'
        );
    }

    if (environment === 'staging') {
        const stagingUrl = env.POSTGRES_SQL_URL_STAGING;
        const productionUrl = env.POSTGRES_SQL_URL;
        if (!stagingUrl) {
            throw migrateSafetyError(
                'STAGING_URL_MISSING',
                'Refusing to migrate: POSTGRES_SQL_URL_STAGING is required for staging.'
            );
        }
        const stagingFp = connectionFingerprint(stagingUrl);
        const productionFp = connectionFingerprint(productionUrl);
        if (!stagingFp) {
            throw migrateSafetyError('STAGING_URL_INVALID', 'Refusing to migrate: staging database URL is invalid.');
        }
        if (productionFp && stagingFp === productionFp) {
            throw migrateSafetyError(
                'STAGING_EQUALS_PRODUCTION',
                'Refusing to migrate: staging database URL matches production.'
            );
        }
        return {
            environment: 'staging',
            connectionString: stagingUrl,
            ...describeConnection(stagingUrl),
        };
    }

    if (environment === 'production') {
        if (String(env.ALLOW_PRODUCTION_MIGRATIONS || '').toLowerCase() !== 'true') {
            throw migrateSafetyError(
                'PRODUCTION_MIGRATIONS_FORBIDDEN',
                'Refusing to migrate production without ALLOW_PRODUCTION_MIGRATIONS=true.'
            );
        }
        if (!env.POSTGRES_SQL_URL) {
            throw migrateSafetyError('DATABASE_URL_MISSING', 'Refusing to migrate: POSTGRES_SQL_URL is not set.');
        }
        return {
            environment: 'production',
            connectionString: env.POSTGRES_SQL_URL,
            ...describeConnection(env.POSTGRES_SQL_URL),
        };
    }

    if (environment === 'development' || environment === 'test') {
        if (!env.POSTGRES_SQL_URL) {
            throw migrateSafetyError('DATABASE_URL_MISSING', 'Refusing to migrate: POSTGRES_SQL_URL is not set.');
        }
        return {
            environment,
            connectionString: env.POSTGRES_SQL_URL,
            ...describeConnection(env.POSTGRES_SQL_URL),
        };
    }

    throw migrateSafetyError(
        'ENV_UNIDENTIFIED',
        `Refusing to migrate: unsupported ROXCLUB_ENV=${environment}.`
    );
}

function stagingIntegrationAllowed(env = process.env) {
    if (String(env.STAGING_INTEGRATION || '').toLowerCase() !== 'true') return false;
    if (String(env.ROXCLUB_ENV || '').toLowerCase() !== 'staging') return false;
    try {
        const target = resolveMigrateTarget(env, ['--staging']);
        return target.environment === 'staging';
    } catch {
        return false;
    }
}

module.exports = {
    connectionFingerprint,
    describeConnection,
    redactConnection,
    identifiedEnvironment,
    resolveMigrateTarget,
    stagingIntegrationAllowed,
};
