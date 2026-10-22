const { queryWithHardTimeout } = require('../dbQuery');
const { matchProgram } = require('./programMatch');
const { expandProgramSessions } = require('./programCatalog');
const { ensureOnboardingProfileSchema } = require('./schema');

function isoDate(timeZone, now = new Date()) {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: timeZone || 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(now);
    } catch (_) {
        return now.toISOString().slice(0, 10);
    }
}

function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function sessionsFromProgram(program, startDate) {
    return expandProgramSessions(program, startDate);
}

async function writeWeekSchedule(userId, event, experience, startDate) {
    const program = matchProgram(event, experience);
    const sessions = sessionsFromProgram(program, startDate);
    await ensureOnboardingProfileSchema();

    await queryWithHardTimeout(
        `
        INSERT INTO scheduled_sessions (
            user_id, program_id, workout_id, title, duration_min, scheduled_on, plan_day, week_number
        )
        SELECT
            $1,
            x.program_id,
            x.workout_id,
            x.title,
            x.duration_min,
            x.scheduled_on::date,
            x.plan_day,
            x.week_number
        FROM jsonb_to_recordset($2::jsonb) AS x(
            program_id text,
            workout_id text,
            title text,
            duration_min int,
            scheduled_on text,
            plan_day text,
            week_number int
        )
        ON CONFLICT (user_id, scheduled_on) DO NOTHING
        `,
        [userId, JSON.stringify(sessions)],
        8000
    );

    return { program, sessions };
}

async function ensureDnaRow(userId) {
    await ensureOnboardingProfileSchema();
    await queryWithHardTimeout(
        `
        INSERT INTO athlete_dna (user_id, status, attributes)
        VALUES ($1, 'CALIBRATING', NULL)
        ON CONFLICT (user_id) DO NOTHING
        `,
        [userId],
        8000
    );
}

module.exports = {
    isoDate,
    addDays,
    sessionsFromProgram,
    writeWeekSchedule,
    ensureDnaRow,
};
