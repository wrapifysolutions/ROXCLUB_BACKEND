require('dotenv').config();

const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_SQL_URL;

if (!connectionString) {
    throw new Error('POSTGRES_SQL_URL is not set');
}

const pool = new Pool({
    connectionString,
    application_name: 'roxclub',
    max: Number(process.env.PG_POOL_MAX) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
});


pool.on('error', (err) => {
    console.error('Unexpected error on idle Postgres client', err);
});

module.exports = pool;
