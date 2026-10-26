const pool = require('./pool');

/**
 * Borrow a client with connect timeout, set statement_timeout, always release.
 * Safe for Vercel (small pool) under concurrent mobile traffic.
 */
async function queryWithHardTimeout(text, params = [], timeoutMs = 8000) {
    const connectMs = Math.min(timeoutMs, 5000);
    const client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => {
            setTimeout(
                () => reject(new Error(`DB connect timed out after ${connectMs}ms`)),
                connectMs
            );
        }),
    ]);

    try {
        await client.query(`SET statement_timeout = ${Math.max(1000, timeoutMs)}`);
        return await client.query(text, params);
    } finally {
        client.release();
    }
}

async function withTransaction(work, timeoutMs = 15000) {
    const connectMs = Math.min(timeoutMs, 5000);
    const client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => {
            setTimeout(
                () => reject(new Error(`DB connect timed out after ${connectMs}ms`)),
                connectMs
            );
        }),
    ]);

    try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, timeoutMs)}`);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (_) {
            // The connection may already be closed.
        }
        throw error;
    } finally {
        client.release();
    }
}

function query(text, params) {
    return pool.query(text, params);
}

module.exports = { query, queryWithHardTimeout, withTransaction };
