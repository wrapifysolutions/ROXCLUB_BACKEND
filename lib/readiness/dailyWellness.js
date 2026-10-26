const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const readinessConfig = require('../../config/readiness.json');

const SOURCES = new Set(['zepp', 'apple_health', 'manual']);

function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function localDate(instant, timeZone) {
    const date = instant instanceof Date ? instant : new Date(instant);
    if (Number.isNaN(date.getTime())) return null;
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: timeZone || 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(date);
    } catch (_) {
        return date.toISOString().slice(0, 10);
    }
}

function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function hasMetric(row) {
    return row != null && (row.sleep_minutes != null || row.hrv_ms != null || row.resting_hr != null);
}

function pickDay(rows, date, priority) {
    const dayRows = rows.filter((row) => String(row.local_date).slice(0, 10) === date);
    for (const source of priority) {
        const row = dayRows.find((item) => item.source === source && hasMetric(item));
        if (row) return row;
    }
    return null;
}

function average(values) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function selectWellness(rows, localDateValue, priority = readinessConfig.wellnessSourcePriority, days = readinessConfig.baselineDays) {
    const minDays = readinessConfig.minBaselineDays ?? 4;
    const today = pickDay(rows, localDateValue, priority);
    const history = [];
    for (let offset = 1; offset <= days; offset += 1) {
        const row = pickDay(rows, addDays(localDateValue, -offset), priority);
        if (row) history.push(row);
    }

    const field = (name) => {
        const values = history.map((row) => finite(row[name])).filter((value) => value != null);
        if (values.length < minDays) {
            return { baseline: null, days: values.length, provisional: false };
        }
        return {
            baseline: average(values),
            days: values.length,
            provisional: values.length < days,
        };
    };

    const sleep = field('sleep_minutes');
    const hrv = field('hrv_ms');
    const resting = field('resting_hr');

    return {
        source: today?.source || null,
        sleepMinutes: finite(today?.sleep_minutes),
        sleepBaselineMinutes: sleep.baseline,
        sleepBaselineDays: sleep.days,
        sleepProvisional: sleep.provisional,
        hrvMs: finite(today?.hrv_ms),
        hrvBaselineMs: hrv.baseline,
        hrvBaselineDays: hrv.days,
        hrvProvisional: hrv.provisional,
        restingHr: finite(today?.resting_hr),
        restingHrBaseline: resting.baseline,
        restingHrBaselineDays: resting.days,
        restingHrProvisional: resting.provisional,
    };
}

function durationMinutes(startAt, endAt) {
    if (!startAt || !endAt) return null;
    const minutes = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000;
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) return null;
    return minutes;
}

function sleepFromValue(value, unit) {
    const number = finite(value);
    if (number == null) return {};
    const label = String(unit || '').toLowerCase();
    if (label.includes('score')) return { sleepScore: Math.round(number) };
    if (label.includes('hour')) return { sleepMinutes: Math.round(number * 60) };
    if (number <= 24) return { sleepMinutes: Math.round(number * 60) };
    if (number <= 24 * 60) return { sleepMinutes: Math.round(number) };
    return {};
}

function blankDay() {
    return { sleepMinutes: null, sleepScore: null, hrvMs: null, restingHr: null, raw: [] };
}

function remember(bucket, patch) {
    if (patch.sleepMinutes != null) bucket.sleepMinutes = (bucket.sleepMinutes || 0) + patch.sleepMinutes;
    if (patch.sleepScore != null) bucket.sleepScore = patch.sleepScore;
    if (patch.hrvMs != null) bucket.hrvMs = patch.hrvMs;
    if (patch.restingHr != null) bucket.restingHr = patch.restingHr;
}

function appleDayPatch(sample) {
    const type = String(sample.sample_type || sample.type || '').trim().toLowerCase();
    const metadata = sample.metadata || {};
    if (type === 'hrv') return { hrvMs: finite(sample.value) };
    if (type === 'resting_hr') return { restingHr: finite(sample.value) };
    if (type !== 'sleep') return {};
    const fromClock = durationMinutes(sample.start_at || sample.startDate, sample.end_at || sample.endDate);
    const fromValue = sleepFromValue(sample.value, sample.unit);
    return {
        sleepMinutes: fromClock != null ? Math.round(fromClock) : fromValue.sleepMinutes || null,
        sleepScore: finite(metadata.sleepScore ?? metadata.sleep_score) ?? fromValue.sleepScore ?? null,
    };
}

function zeppDayPatch(sample) {
    const type = String(sample.sample_type || '').toLowerCase();
    const raw = sample.raw || {};
    if (type === 'hrv') {
        return {
            hrvMs: finite(sample.value ?? raw.hrv ?? raw.rmssd),
            restingHr: finite(raw.restingHeartRate ?? raw.resting_hr ?? raw.rhr),
        };
    }
    if (type !== 'sleep') return {};
    const minutes = finite(sample.duration_seconds) != null
        ? sample.duration_seconds / 60
        : sleepFromValue(sample.value, sample.unit || raw.unit).sleepMinutes;
    return {
        sleepMinutes: minutes != null ? Math.round(minutes) : null,
        sleepScore: finite(raw.sleepScore ?? raw.sleep_score ?? sample.sleep_score),
        restingHr: finite(raw.restingHeartRate ?? raw.resting_hr ?? raw.rhr),
    };
}

function groupSamples(samples, timeZone, patchFor) {
    const days = new Map();
    for (const sample of samples) {
        const start = sample.start_at || sample.startDate || sample.startTime || sample.date;
        const date = localDate(start, timeZone);
        if (!date) continue;
        const patch = patchFor(sample);
        if (!patch || Object.values(patch).every((value) => value == null)) continue;
        if (!days.has(date)) days.set(date, blankDay());
        const bucket = days.get(date);
        remember(bucket, patch);
        bucket.raw.push(sample.raw || sample);
    }
    return days;
}

async function userTimeZone(userId, query) {
    try {
        const { rows } = await query(
            `SELECT timezone FROM users WHERE id = $1`,
            [userId],
            8000
        );
        return rows[0]?.timezone || 'UTC';
    } catch (_) {
        return 'UTC';
    }
}

async function upsertDailyWellness(userId, source, date, metrics, query = queryWithHardTimeout) {
    if (!SOURCES.has(source) || !date) return null;
    await query(
        `
        /* readiness:upsert_wellness */
        INSERT INTO daily_wellness (
            user_id, local_date, source, sleep_minutes, sleep_score, hrv_ms, resting_hr, raw, synced_at
        )
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8::jsonb, NOW())
        ON CONFLICT (user_id, local_date, source)
        DO UPDATE SET
            sleep_minutes = COALESCE(EXCLUDED.sleep_minutes, daily_wellness.sleep_minutes),
            sleep_score = COALESCE(EXCLUDED.sleep_score, daily_wellness.sleep_score),
            hrv_ms = COALESCE(EXCLUDED.hrv_ms, daily_wellness.hrv_ms),
            resting_hr = COALESCE(EXCLUDED.resting_hr, daily_wellness.resting_hr),
            raw = EXCLUDED.raw,
            synced_at = NOW()
        `,
        [
            userId,
            date,
            source,
            metrics.sleepMinutes,
            metrics.sleepScore,
            metrics.hrvMs,
            metrics.restingHr,
            JSON.stringify(metrics.raw || []),
        ],
        8000
    );
    return true;
}

async function writeGrouped(userId, source, samples, patchFor, query = queryWithHardTimeout) {
    if (!userId || !samples?.length) return 0;
    if (query === queryWithHardTimeout) await ensureOnboardingProfileSchema();
    const zone = await userTimeZone(userId, query);
    const days = groupSamples(samples, zone, patchFor);
    let saved = 0;
    for (const [date, metrics] of days) {
        if (metrics.sleepMinutes == null && metrics.hrvMs == null && metrics.restingHr == null && metrics.sleepScore == null) {
            continue;
        }
        await upsertDailyWellness(userId, source, date, metrics, query);
        saved += 1;
    }
    return saved;
}

function recordAppleSamples(userId, samples, query) {
    return writeGrouped(userId, 'apple_health', samples, appleDayPatch, query);
}

function recordZeppSamples(userId, samples, query) {
    return writeGrouped(userId, 'zepp', samples, zeppDayPatch, query);
}

module.exports = {
    selectWellness,
    recordAppleSamples,
    recordZeppSamples,
    upsertDailyWellness,
};
