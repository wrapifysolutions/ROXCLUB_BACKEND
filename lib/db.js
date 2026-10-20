const pool = require('./pool');

async function connectDB() {
    // Prefer pool.query over connect()/release() to avoid leaked clients on Vercel.
    await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('DB health check timed out')), 8000);
        }),
    ]);
}

async function closeDB() {
    await pool.end();
}

module.exports = { connectDB, closeDB };
