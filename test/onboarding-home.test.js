const test = require('node:test');
const assert = require('node:assert/strict');
const { runOnboardingComplete } = require('../lib/onboarding/completeFlow');
const { buildHomeResponse } = require('../lib/home/homeState');

function memoryClient(overrides = {}) {
    const db = {
        user: {
            id: 'user-1',
            experience_level: 'beginner',
            training_experience: 'beginner',
            training_goals: 'HYROX race',
            race_event: 'hyrox',
            race_date: '2027-03-15',
            onboarding_completed: false,
            ...overrides.user,
        },
        program: overrides.program || null,
        sessions: overrides.sessions || [],
        dnaInserts: 0,
        dna: null,
    };

    return {
        db,
        async query(sql, params) {
            if (sql.includes('onboarding_complete:lock')) {
                return { rows: [db.user] };
            }
            if (sql.includes('onboarding_complete:existing_program')) {
                return { rows: db.program ? [db.program] : [] };
            }
            if (sql.includes('onboarding_complete:insert_program')) {
                if (db.program) {
                    const error = new Error('duplicate user_programs');
                    error.code = '23505';
                    throw error;
                }
                db.program = { program_id: params[1], start_date: params[2] };
                return { rows: [db.program] };
            }
            if (sql.includes('onboarding_complete:insert_sessions')) {
                const sessions = JSON.parse(params[1]);
                for (const session of sessions) {
                    if (db.sessions.some((row) => row.scheduled_on === session.scheduled_on)) continue;
                    db.sessions.push(session);
                }
                return { rowCount: sessions.length };
            }
            if (sql.includes('onboarding_complete:insert_dna')) {
                db.dnaInserts += 1;
                if (!db.dna) {
                    db.dna = {
                        status: 'CALIBRATING',
                        model_version: 'v0',
                        attributes: null,
                        strength: null,
                        engine: null,
                        endurance: null,
                        power: null,
                        mobility: null,
                    };
                }
                return { rows: [] };
            }
            if (sql.includes('onboarding_complete:mark_complete')) {
                db.user.onboarding_completed = true;
                return { rows: [] };
            }
            if (sql.includes('onboarding_complete:mark_questions')) {
                return { rows: [] };
            }
            if (sql.includes('onboarding_complete:count_sessions')) {
                return { rows: [{ count: db.sessions.length }] };
            }
            throw new Error(`unexpected sql: ${sql}`);
        },
    };
}

function homeFor(client, today) {
    return buildHomeResponse({
        name: 'Alex',
        avatar: { smile: 'grin', hair: 'short', kit: 'black' },
        dnaStatus: client.db.dna.status,
        dna: client.db.dna,
        todaySession: client.db.sessions.find((session) => session.scheduled_on === today),
        xpTotal: 0,
        completedSessions: 0,
        checkInScore: null,
    });
}

test('new user right after onboarding gets NEW_ATHLETE with today workout', async () => {
    const client = memoryClient();
    const today = '2026-10-22';
    const result = await runOnboardingComplete(client, 'user-1', { today });
    const home = homeFor(client, today);

    assert.equal(result.created, true);
    assert.equal(result.programId, 'hyrox_base_8w');
    assert.equal(client.db.user.onboarding_completed, true);
    assert.equal(client.db.dna.model_version, 'v0');
    assert.equal(client.db.dna.strength, null);
    assert.equal(home.state, 'NEW_ATHLETE');
    assert.equal(home.user.name, 'Alex');
    assert.equal(home.readiness.status, 'CALIBRATING');
    assert.equal(home.readiness.score, null);
    assert.equal(home.todayWorkout.id, 'wk_foundation_a');
    assert.equal(home.todayWorkout.title, 'Foundation Protocol A');
    assert.equal(home.todayWorkout.durationMin, 45);
    assert.equal(home.todayWorkout.workout.id, 'wk_foundation_a');
    assert.equal(home.dna.status, 'CALIBRATING');
    assert.equal(home.dna.attributes, null);
    assert.deepEqual(home.level, { level: 1, xp: 0, nextLevelXp: 500 });
    assert.equal(home.thisWeek, undefined);
});

test('calling onboarding complete twice creates no duplicates', async () => {
    const client = memoryClient();
    const today = '2026-10-22';
    const first = await runOnboardingComplete(client, 'user-1', { today });
    const sessionCount = client.db.sessions.length;
    const second = await runOnboardingComplete(client, 'user-1', { today });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.programId, 'hyrox_base_8w');
    assert.equal(second.sessionCount, sessionCount);
    assert.equal(client.db.sessions.length, sessionCount);
    assert.equal(client.db.dnaInserts, 1);
    assert.ok(sessionCount > 1);
});

test('onboarding blocks new Race Build assignment for hyrox Intermediate', async () => {
    const client = memoryClient({
        user: {
            experience_level: 'intermediate',
            training_experience: 'intermediate',
        },
    });
    await assert.rejects(
        () => runOnboardingComplete(client, 'user-1', { today: '2026-10-22' }),
        (error) =>
            error.code === 'PRODUCT_CONFIGURATION_BLOCKER' &&
            error.enrollError === 'PROGRAM_NOT_ENROLLABLE' &&
            client.db.program == null &&
            client.db.sessions.length === 0
    );
});

test('existing Race Build enrollment is preserved on onboarding complete', async () => {
    const client = memoryClient({
        user: {
            experience_level: 'intermediate',
            training_experience: 'intermediate',
        },
        program: { program_id: 'race_build_12w', start_date: '2026-09-01' },
        sessions: Array.from({ length: 72 }, (_, index) => ({
            scheduled_on: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
            workout_id: 'wk_foundation_a',
        })),
    });
    const result = await runOnboardingComplete(client, 'user-1', { today: '2026-10-22' });
    assert.equal(result.created, false);
    assert.equal(result.programId, 'race_build_12w');
    assert.equal(result.sessionCount, 72);
    assert.equal(client.db.sessions.length, 72);
});

test('connected watch fills readiness and dna while workout and level stay ours', () => {
    const home = buildHomeResponse({
        name: 'Alex',
        avatar: { smile: 'grin' },
        dnaStatus: 'CALIBRATING',
        dna: { strength: null, engine: null, endurance: null, power: null, mobility: null },
        todaySession: {
            workout_id: 'wk_foundation_a',
            title: 'Foundation Protocol A',
            duration_min: 45,
            scheduled_on: '2026-10-22',
            plan_day: '1',
            week_number: 1,
            workout: { id: 'wk_foundation_a', title: 'Foundation Protocol A', durationMin: 45 },
        },
        xpTotal: 0,
        completedSessions: 0,
        checkInScore: null,
        watch: {
            ready: { score: 82, status: 'peak', available: true },
            hrv: { value: 64, available: true, source: 'apple_health' },
            sleep: { value: 7.5, available: true, source: 'apple_health' },
            resting_hr: { value: 52, available: true, source: 'apple_health' },
        },
    });

    assert.equal(home.state, 'NEW_ATHLETE');
    assert.equal(home.recoveryNeeded, false);
    assert.equal(home.thisWeek, undefined);
    assert.equal(home.readiness.score, 82);
    assert.equal(home.readiness.source, 'apple_health');
    assert.equal(home.dna.status, 'READY');
    assert.equal(home.dna.attributes.hrv, 64);
    assert.equal(home.dna.attributes.sleep, 7.5);
    assert.equal(home.todayWorkout.id, 'wk_foundation_a');
    assert.deepEqual(home.level, { level: 1, xp: 0, nextLevelXp: 500 });
});

test('one session and a check-in stays NEW_ATHLETE with a readiness score', () => {
    const home = buildHomeResponse({
        name: 'Alex',
        completedSessions: 1,
        checkInScore: 78,
        xpTotal: 0,
        todaySession: null,
    });

    assert.equal(home.state, 'NEW_ATHLETE');
    assert.equal(home.readiness.score, 78);
    assert.equal(home.recoveryNeeded, false);
    assert.equal(home.thisWeek, undefined);
});

test('three sessions makes home NORMAL with thisWeek', () => {
    const thisWeek = { completed: 1, total: 3, days: [{ date: '2026-10-26', status: 'done' }] };
    const home = buildHomeResponse({
        name: 'Alex',
        completedSessions: 3,
        checkInScore: 78,
        xpTotal: 40,
        thisWeek,
        todaySession: null,
    });

    assert.equal(home.state, 'NORMAL');
    assert.equal(home.recoveryNeeded, false);
    assert.equal(home.readiness.score, 78);
    assert.equal(home.thisWeek, thisWeek);
});
