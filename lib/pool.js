require('dotenv').config();

const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_SQL_URL || process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error('POSTGRES_SQL_URL or DATABASE_URL is not set');
}

const { resolvePoolMax } = require('./poolSize');

const pool = new Pool({
    connectionString,
    application_name: process.env.VERCEL ? 'roxclub-vercel' : 'roxclub',
    max: resolvePoolMax(),
    idleTimeoutMillis: process.env.VERCEL ? 5000 : 10000,
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 5000,
    // Abort stuck queries so pooled clients are released under load.
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 8000,
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS) || 10000,
    allowExitOnIdle: Boolean(process.env.VERCEL),
    keepAlive: !process.env.VERCEL,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle Postgres client', err);
});

module.exports = pool;
