require('dotenv').config();

const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_SQL_URL;

if (!connectionString) {
    throw new Error('POSTGRES_SQL_URL is not set');
}

// Vercel serverless: tiny pool + allow process to exit when idle.
const defaultMax = process.env.VERCEL ? 1 : 10;

const pool = new Pool({
    connectionString,
    application_name: process.env.VERCEL ? 'roxclub-vercel' : 'roxclub',
    max: Number(process.env.PG_POOL_MAX) || defaultMax,
    idleTimeoutMillis: process.env.VERCEL ? 1000 : 10000,
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 10000,
    allowExitOnIdle: Boolean(process.env.VERCEL),
    keepAlive: !process.env.VERCEL,
    keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle Postgres client', err);
});

async function queryWithTimeout(text, params = [], timeoutMs = 12000) {
    const client = await pool.connect();
    try {
        await client.query(`SET statement_timeout = ${Number(timeoutMs)}`);
        return await client.query(text, params);
    } finally {
        client.release();
    }
}

module.exports = pool;
module.exports.queryWithTimeout = queryWithTimeout;
