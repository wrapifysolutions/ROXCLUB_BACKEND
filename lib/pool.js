require('dotenv').config();

const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_SQL_URL || process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error('POSTGRES_SQL_URL or DATABASE_URL is not set');
}

const { isClustered, workerCount } = require('./cluster');

// Neon + Vercel: keep pool small, but >1 so concurrent mobile logins don't queue.
// Cluster workers share the same database quota, so cap per process.
const defaultMax = process.env.VERCEL
    ? 3
    : isClustered()
      ? Math.max(3, Math.floor(10 / Math.max(workerCount(), 1)))
      : 10;

const pool = new Pool({
    connectionString,
    application_name: process.env.VERCEL ? 'roxclub-vercel' : 'roxclub',
    max: Number(process.env.PG_POOL_MAX) || defaultMax,
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
