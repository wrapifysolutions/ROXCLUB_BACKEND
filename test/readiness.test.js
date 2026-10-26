const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeAnswer,
    computeReadiness,
    gatherSignals,
    summarizeSessions,
    readinessIsStale,
    ensureTodayReadiness,
} = require('../lib/readiness/readinessService');
const readinessConfig = require('../config/readiness.json');
const { selectWellness } = require('../lib/readiness/dailyWellness');
const { getTodayCheckin, dismissCheckin, submitCheckin } = require('../lib/readiness/checkinService');
const { buildHomeResponse } = require('../lib/home/homeState');

const GOOD = { energy: 5, soreness: 1, sleepQuality: 5, stress: 1 };
const BAD = { energy: 1, soreness: 5, sleepQuality: 1, stress: 5 };
const TODAY = '2026-10-23';

function memoryReadiness() {
    const state = { checkins: [], prompts: [], readiness: [] };

    const query = async (sql, params) => {
        const userId = params[0];
        const localDate = params[1];

        if (sql.includes('readiness:load_today')) {
            const checkin = state.checkins.find(
                (row) => row.user_id === userId && row.local_date === localDate
            );
            const prompt = state.prompts.find(
                (row) => row.user_id === userId && row.local_date === localDate
            );
            return {
                rows: [
                    {
                        id: checkin?.id ?? null,
                        local_date: localDate,
                        energy: checkin?.energy ?? null,
                        soreness: checkin?.soreness ?? null,
                        sleep_quality: checkin?.sleep_quality ?? null,
                        stress: checkin?.stress ?? null,
                        updated_at: checkin?.updated_at ?? null,
                        prompt_status: prompt?.status ?? null,
                    },
                ],
            };
        }

        if (sql.includes('readiness:upsert_checkin')) {
            let row = state.checkins.find(
                (item) => item.user_id === userId && item.local_date === localDate
            );
            if (!row) {
                row = { id: state.checkins.length + 1, user_id: userId, local_date: localDate };
                state.checkins.push(row);
            }
            row.energy = params[2];
            row.soreness = params[3];
            row.sleep_quality = params[4];
            row.stress = params[5];
            row.updated_at = '2026-10-23T12:00:00.000Z';
            return { rows: [{ ...row }] };
        }

        if (sql.includes('readiness:upsert_prompt')) {
            let row = state.prompts.find(
                (item) => item.user_id === userId && item.local_date === localDate
            );
            const status = params[2];
            if (!row) {
                state.prompts.push({ user_id: userId, local_date: localDate, status });
            } else if (!(row.status === 'completed' && status === 'dismissed')) {
                row.status = status;
            }
            return { rows: [] };
        }

        if (sql.includes('readiness:upsert_readiness')) {
            let row = state.readiness.find(
                (item) => item.user_id === userId && item.local_date === localDate
            );
            const next = {
                id: row?.id || state.readiness.length + 1,
                user_id: userId,
                local_date: localDate,
                score: params[2],
                status: params[3],
                confidence: params[4],
                signals_used: JSON.parse(params[5]),
                model_version: params[6],
                computed_at: '2026-10-23T12:00:00.000Z',
            };
            if (!row) state.readiness.push(next);
            else Object.assign(row, next, { id: row.id });
            return { rows: [row || next] };
        }

        throw new Error(`unexpected sql: ${sql}`);
    };

    return { state, query };
}

test('first open prompts, dismiss hides the sheet', async () => {
    const db = memoryReadiness();
    const first = await getTodayCheckin('user-1', TODAY, db.query);
    assert.equal(first.shouldPrompt, true);
    assert.equal(first.checkin, null);

    const dismissed = await dismissCheckin('user-1', TODAY, db.query);
    const second = await getTodayCheckin('user-1', TODAY, db.query);
    assert.equal(dismissed.shouldPrompt, false);
    assert.equal(dismissed.status, 'dismissed');
    assert.equal(second.shouldPrompt, false);
    assert.equal(second.checkin, null);
});

test('second submit on the same day updates the row', async () => {
    const db = memoryReadiness();
    const gather = async () => ({ completedSessions: 4 });
    const options = { query: db.query, gather };

    const first = await submitCheckin('user-1', GOOD, TODAY, options);
    const second = await submitCheckin('user-1', BAD, TODAY, options);

    assert.equal(db.state.checkins.length, 1);
    assert.equal(db.state.readiness.length, 1);
    assert.equal(db.state.checkins[0].energy, 1);
    assert.equal(db.state.checkins[0].soreness, 5);
    assert.equal(db.state.prompts[0].status, 'completed');
    assert.equal(first.readiness.modelVersion, 'v0');
    assert.equal(second.readiness.status, 'RECOVERY_NEEDED');
    assert.ok(second.readiness.score < first.readiness.score);
    assert.equal(second.readiness.xp, undefined);

    const today = await getTodayCheckin('user-1', TODAY, db.query);
    assert.equal(today.shouldPrompt, false);
    assert.equal(today.checkin.energy, 1);
});

test('soreness and stress use the reversed scale', () => {
    assert.equal(normalizeAnswer('soreness', 5), normalizeAnswer('energy', 1));
    assert.equal(normalizeAnswer('stress', 5), normalizeAnswer('sleepQuality', 1));
    assert.equal(normalizeAnswer('soreness', 1), normalizeAnswer('energy', 5));
    assert.equal(normalizeAnswer('stress', 1), normalizeAnswer('sleepQuality', 5));
    assert.equal(normalizeAnswer('energy', 5), 100);
    assert.equal(normalizeAnswer('soreness', 5), 0);
});

test('no check-in and fewer than 3 sessions stays CALIBRATING', () => {
    const result = computeReadiness({ completedSessions: 2 });
    assert.equal(result.status, 'CALIBRATING');
    assert.equal(result.score, null);
    assert.equal(result.confidence, 'LOW');
    assert.equal(result.modelVersion, 'v0');
    assert.equal(result.xp, undefined);
});

test('a great check-in against a very high load is the conservative score', () => {
    const calm = computeReadiness({
        checkin: GOOD,
        completedSessions: 6,
        lastRpe: 3,
        load3: 120,
        load7: 280,
        load28: 1120,
    });
    const contradicted = computeReadiness({
        checkin: GOOD,
        completedSessions: 6,
        load3: 360,
        load7: 840,
        load28: 1120,
        lastRpe: 3,
    });

    assert.equal(contradicted.signalsUsed.contradiction, true);
    assert.equal(contradicted.confidence, 'LOW');
    assert.ok(contradicted.score < calm.score);
    assert.ok(contradicted.score > 0);
    const load = contradicted.signalsUsed.signals.find((signal) => signal.key === 'trainingLoad');
    assert.ok(contradicted.score > load.score);
});

const STEADY_LOAD = { completedSessions: 6, load3: 120, load7: 280, load28: 1120 };
const AT_BASELINE = {
    wellnessSource: 'zepp',
    sleepMinutes: 432,
    sleepBaselineMinutes: 420,
    hrvMs: 68,
    hrvBaselineMs: 64,
    restingHr: 50,
    restingHrBaseline: 52,
};

function weightOf(result, key) {
    return result.signalsUsed.signals.find((signal) => signal.key === key)?.weight;
}

function weightSum(result) {
    return result.signalsUsed.signals.reduce((sum, signal) => sum + signal.weight, 0);
}

test('zepp is chosen ahead of apple health for the same day', () => {
    const selected = selectWellness(
        [
            { source: 'apple_health', local_date: '2026-10-23', hrv_ms: 40, sleep_minutes: 300, resting_hr: 60 },
            { source: 'zepp', local_date: '2026-10-23', hrv_ms: 68, sleep_minutes: 432, resting_hr: 52 },
            { source: 'zepp', local_date: '2026-10-22', hrv_ms: 60, sleep_minutes: 420, resting_hr: 50 },
            { source: 'apple_health', local_date: '2026-10-21', hrv_ms: 80, sleep_minutes: 480, resting_hr: 48 },
        ],
        '2026-10-23'
    );

    assert.equal(selected.source, 'zepp');
    assert.equal(selected.hrvMs, 68);
    assert.equal(selected.sleepMinutes, 432);
    assert.equal(selected.restingHr, 52);
    assert.equal(selected.hrvBaselineMs, null);
    console.log(
        `Zepp over Apple  source=${selected.source} hrv=${selected.hrvMs} sleepMin=${selected.sleepMinutes} restingHr=${selected.restingHr} (apple hrv 40 ignored)`
    );
});

test('wearable plus check-in is HIGH and a missing wearable stays scorable at MODERATE', () => {
    const withWearable = computeReadiness({ checkin: GOOD, ...STEADY_LOAD, ...AT_BASELINE });
    const withoutWearable = computeReadiness({ checkin: GOOD, ...STEADY_LOAD });
    const hrv = withWearable.signalsUsed.signals.find((signal) => signal.key === 'hrv');
    const sleep = withWearable.signalsUsed.signals.find((signal) => signal.key === 'sleep');
    const load = withWearable.signalsUsed.signals.find((signal) => signal.key === 'trainingLoad');

    assert.equal(withWearable.confidence, 'HIGH');
    assert.equal(withoutWearable.confidence, 'MODERATE');
    assert.ok(Math.abs(withWearable.score - withoutWearable.score) <= 20);
    assert.ok(withoutWearable.score >= 55);
    assert.equal(hrv.value, 68);
    assert.equal(hrv.unit, 'ms');
    assert.equal(hrv.baseline, 64);
    assert.ok(hrv.weight > 0);
    assert.equal(sleep.value, 7.2);
    assert.equal(sleep.unit, 'hrs');
    assert.equal(load.label, 'Moderate');
    assert.equal(withoutWearable.signalsUsed.signals.some((signal) => signal.key === 'sleep'), false);
    assert.ok(withoutWearable.score >= withWearable.score - 15);
    console.log(
        `HIGH wearable+check-in  score=${withWearable.score} confidence=${withWearable.confidence} hrv=${hrv.value}ms baseline=${hrv.baseline} sleep=${sleep.value}hrs load=${load.label}`
    );
    console.log(
        `MODERATE no wearable    score=${withoutWearable.score} confidence=${withoutWearable.confidence} delta=${withoutWearable.score - withWearable.score} (missing wearable is not a penalty)`
    );
});

test('HRV well below the personal baseline lowers the score', () => {
    const usual = computeReadiness({
        checkin: GOOD,
        ...STEADY_LOAD,
        hrvMs: 70,
        hrvBaselineMs: 70,
        sleepMinutes: 420,
        sleepBaselineMinutes: 420,
    });
    const suppressed = computeReadiness({
        checkin: GOOD,
        ...STEADY_LOAD,
        hrvMs: 42,
        hrvBaselineMs: 70,
        sleepMinutes: 420,
        sleepBaselineMinutes: 420,
    });

    assert.ok(suppressed.score < usual.score);
    const hrv = suppressed.signalsUsed.signals.find((signal) => signal.key === 'hrv');
    const drop = usual.score - suppressed.score;
    assert.equal(hrv.value, 42);
    assert.equal(hrv.baseline, 70);
    assert.ok(hrv.score < 40);
    assert.ok(suppressed.score > hrv.score);
    assert.ok(drop <= hrv.weight * 100);
    console.log(
        `HRV below baseline      overall ${usual.score} -> ${suppressed.score} (drop ${drop}, max ${Math.round(hrv.weight * 100)})  hrvScore=${hrv.score} (${hrv.value}ms vs baseline ${hrv.baseline}ms)`
    );
});

test('a great check-in with very poor sleep uses the conservative score', () => {
    const result = computeReadiness({
        checkin: GOOD,
        completedSessions: 5,
        sleepMinutes: 240,
        sleepBaselineMinutes: 480,
        wellnessSource: 'apple_health',
    });
    const sleep = result.signalsUsed.signals.find((signal) => signal.key === 'sleep');

    assert.equal(result.signalsUsed.contradiction, true);
    assert.equal(result.confidence, 'LOW');
    assert.ok(result.score >= 40 && result.score <= 60);
    assert.ok(result.score > sleep.score);
    assert.equal(sleep.baseline, 8);
    assert.equal(sleep.value, 4);
    console.log(
        `Poor sleep + check-in   score=${result.score} confidence=${result.confidence} sleepScore=${sleep.score} contradiction=${result.signalsUsed.contradiction}`
    );
});

test('a missing signal weight is redistributed across the signals that exist', () => {
    const full = computeReadiness({
        checkin: GOOD,
        ...STEADY_LOAD,
        sleepMinutes: 420,
        sleepBaselineMinutes: 420,
        hrvMs: 60,
        hrvBaselineMs: 60,
    });
    const withoutSleep = computeReadiness({
        checkin: GOOD,
        ...STEADY_LOAD,
        hrvMs: 60,
        hrvBaselineMs: 60,
    });

    assert.ok(Math.abs(weightSum(full) - 1) < 0.001);
    assert.ok(Math.abs(weightSum(withoutSleep) - 1) < 0.001);
    assert.equal(withoutSleep.signalsUsed.signals.some((signal) => signal.key === 'sleep'), false);
    assert.ok(weightOf(withoutSleep, 'hrv') > weightOf(full, 'hrv'));
    assert.ok(weightOf(withoutSleep, 'checkin') > weightOf(full, 'checkin'));
    console.log(
        `Redistributed weights   hrv ${weightOf(full, 'hrv').toFixed(3)} -> ${weightOf(withoutSleep, 'hrv').toFixed(3)}  checkin ${weightOf(full, 'checkin').toFixed(3)} -> ${weightOf(withoutSleep, 'checkin').toFixed(3)}  sums ${weightSum(full).toFixed(3)} / ${weightSum(withoutSleep).toFixed(3)}`
    );
});

function historyRows(count, date) {
    const rows = [
        { source: 'apple_health', local_date: date, hrv_ms: 40, sleep_minutes: 300, resting_hr: 70 },
        { source: 'zepp', local_date: date, hrv_ms: 68, sleep_minutes: 432, resting_hr: 52 },
    ];
    for (let offset = 1; offset <= count; offset += 1) {
        const day = new Date(`${date}T00:00:00Z`);
        day.setUTCDate(day.getUTCDate() - offset);
        rows.push({
            source: 'zepp',
            local_date: day.toISOString().slice(0, 10),
            hrv_ms: 64,
            sleep_minutes: 420,
            resting_hr: 51,
        });
    }
    return rows;
}

test('baseline needs minBaselineDays and stays provisional before 14 days', () => {
    const tooFew = selectWellness(historyRows(3, '2026-10-23'), '2026-10-23');
    const warming = selectWellness(historyRows(6, '2026-10-23'), '2026-10-23');
    const ready = selectWellness(historyRows(14, '2026-10-23'), '2026-10-23');
    const capped = computeReadiness({
        checkin: GOOD,
        ...STEADY_LOAD,
        ...AT_BASELINE,
        sleepProvisional: true,
        hrvProvisional: true,
        restingHrProvisional: true,
    });

    assert.equal(tooFew.hrvBaselineMs, null);
    assert.equal(tooFew.hrvProvisional, false);
    assert.equal(warming.hrvProvisional, true);
    assert.equal(warming.hrvBaselineMs, 64);
    assert.equal(ready.hrvProvisional, false);
    assert.equal(capped.confidence, 'MODERATE');
    assert.equal(capped.signalsUsed.signals.find((signal) => signal.key === 'hrv').provisional, true);
    console.log(
        `Baseline warm-up        3 days excluded=${tooFew.hrvBaselineMs == null}  6 days provisional=${warming.hrvProvisional} baseline=${warming.hrvBaselineMs}  14 days provisional=${ready.hrvProvisional}  capped confidence=${capped.confidence}`
    );
});

function readinessFromWellness(rows, date) {
    const wearable = selectWellness(rows, date);
    return computeReadiness({
        completedSessions: 0,
        wellnessSource: wearable.source,
        sleepMinutes: wearable.sleepMinutes,
        sleepBaselineMinutes: wearable.sleepBaselineMinutes,
        sleepBaselineDays: wearable.sleepBaselineDays,
        sleepProvisional: wearable.sleepProvisional,
        hrvMs: wearable.hrvMs,
        hrvBaselineMs: wearable.hrvBaselineMs,
        hrvBaselineDays: wearable.hrvBaselineDays,
        hrvProvisional: wearable.hrvProvisional,
        restingHr: wearable.restingHr,
        restingHrBaseline: wearable.restingHrBaseline,
        restingHrBaselineDays: wearable.restingHrBaselineDays,
        restingHrProvisional: wearable.restingHrProvisional,
    });
}

function emptySignals(sql) {
    if (sql.includes('readiness:sessions_')) return { rows: [] };
    if (sql.includes('readiness:debrief')) return { rows: [] };
    if (sql.includes('readiness:wellness')) return { rows: [] };
    if (sql.includes('readiness:checkin_row')) return { rows: [] };
    throw new Error(`unexpected sql: ${sql}`);
}

test('a new user with no watch stays CALIBRATING', async () => {
    const direct = computeReadiness({});
    assert.equal(direct.status, 'CALIBRATING');
    assert.equal(direct.score, null);

    const signals = await gatherSignals('user-new', TODAY, async (sql) => emptySignals(sql));
    const gathered = computeReadiness(signals);
    assert.equal(signals.checkin, null);
    assert.equal(signals.completedSessions, 0);
    assert.equal(gathered.status, 'CALIBRATING');
    assert.equal(gathered.score, null);
});

test('a new user check-in returns a fresh daily readiness score', async () => {
    const direct = computeReadiness({ checkin: GOOD, completedSessions: 0 });
    assert.equal(typeof direct.score, 'number');
    assert.notEqual(direct.status, 'CALIBRATING');

    const db = memoryReadiness();
    const saved = await submitCheckin('user-new', GOOD, TODAY, {
        query: db.query,
        gather: async () => ({ completedSessions: 0 }),
    });

    assert.equal(saved.readiness.localDate, TODAY);
    assert.equal(saved.readiness.score, db.state.readiness[0].score);
    assert.equal(typeof saved.readiness.score, 'number');
    assert.notEqual(saved.readiness.status, 'CALIBRATING');
    assert.equal(saved.readiness.modelVersion, 'v0');
});

test('five days of imported wellness and no check-in unlocks a score with confidence MODERATE', async () => {
    const rows = [];
    for (let offset = 0; offset < 5; offset += 1) {
        const day = new Date(`${TODAY}T00:00:00Z`);
        day.setUTCDate(day.getUTCDate() - offset);
        rows.push({
            source: 'apple_health',
            local_date: day.toISOString().slice(0, 10),
            sleep_minutes: 420,
            hrv_ms: 60,
            resting_hr: 52,
        });
    }

    const signals = await gatherSignals('user-new', TODAY, async (sql) => {
        if (sql.includes('readiness:wellness')) return { rows };
        return emptySignals(sql);
    });
    const result = computeReadiness(signals);

    assert.equal(signals.checkin, null);
    assert.equal(signals.completedSessions, 0);
    assert.equal(typeof result.score, 'number');
    assert.notEqual(result.status, 'CALIBRATING');
    assert.equal(result.confidence, 'MODERATE');
});

test("a connector's first history import creates today's daily readiness", async () => {
    const service = require('../lib/readiness/readinessService');
    const wellness = require('../lib/readiness/dailyWellness');
    const timezone = require('../lib/readiness/userTimezone');
    const pool = require('../lib/pool');
    const { isoDate } = require('../lib/onboarding/schedule');
    const { upsertAppleHealthSamples } = require('../lib/appleHealth/appleHealthStore');
    const { flushReadinessQueue } = require('../lib/readiness/recomputeQueue');
    const db = memoryReadiness();
    const originalQuery = pool.query.bind(pool);
    const originalRecompute = service.recomputeAndStore;
    const originalRecord = wellness.recordAppleSamples;
    const originalZone = timezone.resolveUserTimezone;
    const today = isoDate('UTC');

    pool.query = async () => ({ rows: [] });
    wellness.recordAppleSamples = async () => 1;
    timezone.resolveUserTimezone = async () => 'UTC';
    service.recomputeAndStore = (userId, localDate) =>
        originalRecompute(userId, localDate, db.query, async () => ({ completedSessions: 0 }));

    try {
        const saved = await upsertAppleHealthSamples('user-import', [
            {
                sample_type: 'hrv',
                start_at: `${today}T06:00:00.000Z`,
                value: 60,
                unit: 'ms',
            },
        ]);
        await flushReadinessQueue();

        assert.equal(saved, 1);
        assert.equal(db.state.readiness.length, 1);
        assert.equal(db.state.readiness[0].user_id, 'user-import');
        assert.equal(db.state.readiness[0].local_date, today);
    } finally {
        pool.query = originalQuery;
        service.recomputeAndStore = originalRecompute;
        wellness.recordAppleSamples = originalRecord;
        timezone.resolveUserTimezone = originalZone;
    }
});

test('a GET recomputes when check-in, sync, or a workout is newer than computedAt', async () => {
    const computedAt = '2026-10-23T12:00:00.000Z';
    assert.equal(readinessIsStale(computedAt, '2026-10-23T12:05:00.000Z'), true);
    assert.equal(readinessIsStale(computedAt, '2026-10-23T11:00:00.000Z'), false);
    assert.equal(readinessIsStale(null, null), true);

    const state = {
        readiness: [
            {
                id: 1,
                user_id: 'user-stale',
                local_date: TODAY,
                score: 40,
                status: 'FATIGUED',
                confidence: 'LOW',
                signals_used: {},
                model_version: 'v0',
                computed_at: computedAt,
            },
        ],
        inputs: {
            checkin: '2026-10-23T12:05:00.000Z',
            sync: null,
            workout: null,
        },
    };
    let recomputes = 0;
    const query = async (sql, params) => {
        if (sql.includes('readiness:history')) {
            return {
                rows: state.readiness.filter((row) => row.user_id === params[0] && row.local_date === params[1]),
            };
        }
        if (sql.includes('readiness:newer_input:')) {
            const name = sql.match(/readiness:newer_input:(\w+)/)[1];
            return { rows: [{ at: state.inputs[name] || null }] };
        }
        if (sql.includes('readiness:upsert_readiness')) {
            state.readiness[0].score = params[2];
            state.readiness[0].status = params[3];
            state.readiness[0].confidence = params[4];
            state.readiness[0].signals_used = JSON.parse(params[5]);
            state.readiness[0].model_version = params[6];
            state.readiness[0].computed_at = '2026-10-23T12:06:00.000Z';
            return { rows: [state.readiness[0]] };
        }
        throw new Error(`unexpected sql: ${sql}`);
    };

    const stale = await ensureTodayReadiness('user-stale', TODAY, query, async () => {
        recomputes += 1;
        return { checkin: GOOD, completedSessions: 0 };
    });
    assert.equal(recomputes, 1);
    assert.notEqual(stale.today.score, 40);
    assert.equal(typeof stale.today.score, 'number');

    state.inputs.checkin = '2026-10-23T11:00:00.000Z';
    const fresh = await ensureTodayReadiness('user-stale', TODAY, query, async () => {
        recomputes += 1;
        return { checkin: GOOD, completedSessions: 0 };
    });
    assert.equal(recomputes, 1);
    assert.equal(fresh.today.score, stale.today.score);

    state.inputs.workout = '2026-10-23T12:07:00.000Z';
    await ensureTodayReadiness('user-stale', TODAY, query, async () => {
        recomputes += 1;
        return { checkin: GOOD, completedSessions: 4 };
    });
    assert.equal(recomputes, 2);
});

test('a 6-day wearable baseline can score 80+ with confidence MODERATE', () => {
    const rows = [];
    for (let offset = 0; offset <= 6; offset += 1) {
        const day = new Date(`${TODAY}T00:00:00Z`);
        day.setUTCDate(day.getUTCDate() - offset);
        const today = offset === 0;
        rows.push({
            source: 'zepp',
            local_date: day.toISOString().slice(0, 10),
            hrv_ms: today ? 80 : 64,
            sleep_minutes: today ? 510 : 420,
            resting_hr: today ? 46 : 52,
        });
    }

    const result = readinessFromWellness(rows, TODAY);
    const hrv = result.signalsUsed.signals.find((signal) => signal.key === 'hrv');

    assert.ok(result.score >= 80);
    assert.ok(result.status === 'READY' || result.status === 'PRIMED');
    assert.equal(result.confidence, 'MODERATE');
    assert.equal(hrv.provisional, true);
    assert.equal(result.signalsUsed.signals.some((signal) => signal.key === 'checkin'), false);
});

test('normal load is neutral and load above the 28-day average scores lower', () => {
    const normal = computeReadiness({ checkin: GOOD, ...STEADY_LOAD });
    const spiked = computeReadiness({
        checkin: GOOD,
        completedSessions: 6,
        load3: 360,
        load7: 840,
        load28: 1120,
    });
    const normalLoad = normal.signalsUsed.signals.find((signal) => signal.key === 'trainingLoad');
    const spikedLoad = spiked.signalsUsed.signals.find((signal) => signal.key === 'trainingLoad');

    assert.ok(Math.abs(normalLoad.score - readinessConfig.load.neutralScore) <= 1);
    assert.equal(normalLoad.baseline, 1);
    assert.ok(spikedLoad.score < normalLoad.score);
});

test('session intensity uses debrief RPE, then heart rate, then workout type', async () => {
    const run = {
        start_at: '2026-10-23T07:00:00.000Z',
        duration_seconds: 60 * 60,
        activity_type: 'Run',
        average_heartrate: 160,
    };
    const signalsFor = (rows, debriefs) =>
        gatherSignals('user-load', TODAY, async (sql) => {
            if (sql.includes('readiness:sessions_strava')) return { rows };
            if (sql.includes('readiness:debrief')) return { rows: debriefs };
            return emptySignals(sql);
        });

    const typed = await signalsFor([{ ...run, average_heartrate: null }], []);
    const byHeartRate = await signalsFor([run], []);
    const byDebrief = await signalsFor([run], [
        { rpe: 8, flags: [], created_at: '2026-10-23T08:10:00.000Z' },
    ]);

    assert.equal(typed.load3, 60 * readinessConfig.load.typeIntensity.run);
    assert.notEqual(byHeartRate.load3, typed.load3);
    assert.equal(byDebrief.load3, 60 * (8 / readinessConfig.load.rpe.neutral));
    assert.equal(byDebrief.lastRpe, 8);
});

test('a 10-minute run followed by strength counts as two sessions', () => {
    const summary = summarizeSessions(
        [
            {
                activityType: 'run',
                startAt: '2026-10-23T07:00:00.000Z',
                durationMin: 10,
            },
            {
                activityType: 'strength',
                startAt: '2026-10-23T07:10:00.000Z',
                durationMin: 30,
            },
        ],
        TODAY
    );

    assert.equal(summary.completedSessions, 2);
});

test('three lifetime sessions unlock readiness when none are today', () => {
    const summary = summarizeSessions(
        [
            { activityType: 'run', startAt: '2026-08-01T07:00:00.000Z', durationMin: 40 },
            { activityType: 'run', startAt: '2026-10-13T07:00:00.000Z', durationMin: 40 },
            { activityType: 'strength', startAt: '2026-10-21T07:00:00.000Z', durationMin: 40 },
        ],
        TODAY
    );
    const result = computeReadiness(summary);

    assert.equal(summary.completedSessions, 3);
    assert.equal(typeof result.score, 'number');
    assert.notEqual(result.status, 'CALIBRATING');
});

test('three imported Strava runs unlock readiness after dedupe', async () => {
    const days = ['21', '22', '23'];
    const strava = days.map((day) => ({
        start_at: `2026-10-${day}T07:00:00.000Z`,
        duration_seconds: 30 * 60,
        activity_type: 'Run',
    }));
    const apple = days.map((day) => ({
        start_at: `2026-10-${day}T07:01:00.000Z`,
        end_at: `2026-10-${day}T07:31:00.000Z`,
        metadata: { sport_type: 'Run' },
    }));

    const signals = await gatherSignals('user-new', TODAY, async (sql) => {
        if (sql.includes('readiness:sessions_strava')) return { rows: strava };
        if (sql.includes('readiness:sessions_apple')) return { rows: apple };
        return emptySignals(sql);
    });
    const result = computeReadiness(signals);

    assert.equal(signals.completedSessions, 3);
    assert.equal(signals.checkin, null);
    assert.equal(typeof result.score, 'number');
    assert.notEqual(result.status, 'CALIBRATING');
});

test('a low readiness score makes home state RECOVERY_NEEDED', () => {
    const readiness = computeReadiness({ checkin: BAD, completedSessions: 1 });
    const home = buildHomeResponse({
        name: 'Alex',
        avatar: null,
        dnaStatus: 'CALIBRATING',
        dna: null,
        todaySession: {
            workout_id: 'wk_foundation_a',
            title: 'Foundation Protocol A',
            duration_min: 45,
            scheduled_on: TODAY,
            plan_day: '1',
            week_number: 1,
        },
        xpTotal: 0,
        completedSessions: 1,
        dailyReadiness: readiness,
    });

    assert.equal(readiness.status, 'RECOVERY_NEEDED');
    assert.ok(readiness.score < 40);
    assert.equal(home.state, 'NEW_ATHLETE');
    assert.equal(home.recoveryNeeded, true);
    assert.equal(home.thisWeek, undefined);
    assert.equal(home.readiness.status, 'RECOVERY_NEEDED');
    assert.equal(home.readiness.source, 'daily_readiness');
    assert.equal(home.level.xp, 0);
    assert.equal(home.todayWorkout.id, 'wk_foundation_a');
});
