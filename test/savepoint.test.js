const test = require('node:test');
const assert = require('node:assert/strict');
const { withSavepoint } = require('../lib/db/savepoint');

test('savepoint outside a transaction still runs the read', async () => {
    let ran = false;
    const query = async (sql) => {
        if (String(sql).startsWith('SAVEPOINT')) {
            const error = new Error('SAVEPOINT can only be used in transaction blocks');
            error.code = '25P01';
            throw error;
        }
        ran = true;
        return { rows: [{ points: 12 }] };
    };
    const result = await withSavepoint(query, 'seasonal_sum', () => query('/* workout:seasonal_sum */'));
    assert.equal(ran, true);
    assert.equal(result.rows[0].points, 12);
});
