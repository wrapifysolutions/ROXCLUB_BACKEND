const test = require('node:test');
const assert = require('node:assert/strict');
const { paceHybridRace } = require('../lib/workouts/novaPace');
const { DEFAULT_HYBRID_STATIONS } = require('../lib/arena/defaultStations');

test('pace my race allocates athlete targets across the RoxClub hybrid course', () => {
    const result = paceHybridRace({ division: 'open', goalTime: '01:30:00' });
    assert.equal(result.intent, 'pace');
    assert.equal(result.division, 'open');
    assert.equal(result.officialHyrox, false);
    assert.equal(result.predictionAvailable, false);
    assert.equal(result.source, 'roxclub_hybrid_course');
    assert.equal(result.splits.length, DEFAULT_HYBRID_STATIONS.length);
    assert.equal(
        result.splits.reduce((sum, row) => sum + row.targetMs, 0),
        result.goalTimeMs
    );
    assert.ok(result.runPace.clock);
    assert.match(result.note, /not an official/i);
    assert.equal(result.splits[0].type, 'run');
    assert.equal(result.splits.find((row) => row.key === 'wall_balls').repetitions, 100);
});

test('pace my race rejects missing goal time', () => {
    assert.throws(() => paceHybridRace({}), (error) => error.code === 'INVALID_TIME');
});
