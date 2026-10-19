const pool = require('./pool');

async function connectDB() {
    const client = await pool.connect();
    try {
        await client.query('SELECT 1');
    } finally {
        client.release();
    }
}

async function closeDB() {
    await pool.end();
}

module.exports = { connectDB, closeDB };
