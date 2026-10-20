require('dotenv').config();

const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_SQL_URL;

if (!connectionString) {
    throw new Error('POSTGRES_SQL_URL is not set');
}

// Vercel serverless: keep pool tiny to avoid Neon connection storms.
const defaultMax = process.env.VERCEL ? 1 : 10;

const pool = new Pool({
    connectionString,
    application_name: process.env.VERCEL ? 'roxclub-vercel' : 'roxclub',
    max: Number(process.env.PG_POOL_MAX) || defaultMax,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 20000,
    keepAlive: !process.env.VERCEL,
    keepAliveInitialDelayMillis: 10000,
});


pool.on('error', (err) => {
    console.error('Unexpected error on idle Postgres client', err);
});

module.exports = pool;
