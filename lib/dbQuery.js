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

module.exports = { queryWithHardTimeout };
