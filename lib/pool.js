require('dotenv').config();

const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_SQL_URL;

if (!connectionString) {
    throw new Error('POSTGRES_SQL_URL is not set');
}

const defaultMax = process.env.VERCEL ? 1 : 10;

const pool = new Pool({
    connectionString,
    application_name: process.env.VERCEL ? 'roxclub-vercel' : 'roxclub',
    max: Number(process.env.PG_POOL_MAX) || defaultMax,
    idleTimeoutMillis: process.env.VERCEL ? 1000 : 10000,
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 8000,
    allowExitOnIdle: Boolean(process.env.VERCEL),
    keepAlive: !process.env.VERCEL,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle Postgres client', err);
});

module.exports = pool;
