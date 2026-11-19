const test = require('node:test');
const assert = require('node:assert/strict');
const { importWorkoutFromPhoto } = require('../lib/workouts/novaPhoto');

function memoryQuery() {
    const stored = [];
    const query = async (sql, params = []) => {
        if (/CREATE TABLE|CREATE INDEX/i.test(sql)) return { rows: [] };
        if (sql.includes('nova:insert_user_workout')) {
            stored.push({
                id: params[0],
                user_id: params[1],
                title: params[2],
                category_id: params[3],
                type: params[4],
                duration_min: params[5],
                difficulty: params[6],
                source: params[7],
                purpose: params[8],
                activities: JSON.parse(params[9]),
            });
            return { rows: [] };
        }
        if (sql.includes('nova:load_user_workout')) {
            const row = stored.find((item) => item.id === params[0] && item.user_id === params[1]);
            return { rows: row ? [row] : [] };
        }
        return { rows: [] };
    };
    return { stored, query };
}

test('photo import maps OCR text onto known RoxClub exercises', async () => {
    const { query } = memoryQuery();
    const result = await importWorkoutFromPhoto('user-1', null, {
        ocrText: '1km run, 20 wall balls, 50m sled push, rest 60s',
        query,
        skipVoice: true,
    });
    assert.equal(result.intent, 'create');
    assert.equal(result.source, 'photo_import');
    assert.equal(result.workout.source, 'nova_photo');
    assert.equal(result.governance.aiMayInvent, false);
    assert.deepEqual(
        result.workout.activities.map((item) => item.name),
        ['Running', 'Wall Balls', 'Sled Push']
    );
});

test('photo import rejects unknown or empty OCR', async () => {
    await assert.rejects(
        () => importWorkoutFromPhoto('user-1', null, { ocrText: 'secret invented HYROX move', skipVoice: true }),
        (error) => error.code === 'NOVA_NO_EXERCISES'
    );
    await assert.rejects(
        () => importWorkoutFromPhoto('user-1', null, { ocrText: 'UNREADABLE', skipVoice: true }),
        (error) => error.code === 'NOVA_PHOTO_UNREADABLE'
    );
});
