require('dotenv').config();

const pool = require('../lib/pool');

function argValue(flag) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : null;
}

function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function todayIso(timeZone) {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: timeZone || 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
    } catch (_) {
        return new Date().toISOString().slice(0, 10);
    }
}

async function main() {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
        throw new Error('seed:wellness is dev-only');
    }

    const userId = argValue('--user');
    if (!/^[0-9a-f-]{36}$/i.test(userId || '')) {
        throw new Error('Usage: npm run seed:wellness -- --user <uuid>');
    }

    const user = await pool.query(
        `SELECT id, timezone FROM users WHERE id = $1`,
        [userId]
    );
    if (!user.rows[0]) throw new Error(`No user ${userId}`);

    const today = todayIso(user.rows[0].timezone);
    let saved = 0;

    for (let offset = 14; offset >= 0; offset -= 1) {
        const localDate = addDays(today, -offset);
        const sleepMinutes = 410 + ((offset * 7) % 40);
        const hrvMs = 58 + ((offset * 3) % 16);
        const restingHr = 48 + (offset % 6);
        await pool.query(
            `
            INSERT INTO daily_wellness (
                user_id, local_date, source, sleep_minutes, sleep_score, hrv_ms, resting_hr, raw, synced_at
            )
            VALUES ($1, $2::date, 'zepp', $3, $4, $5, $6, $7::jsonb, NOW())
            ON CONFLICT (user_id, local_date, source)
            DO UPDATE SET
                sleep_minutes = EXCLUDED.sleep_minutes,
                sleep_score = EXCLUDED.sleep_score,
                hrv_ms = EXCLUDED.hrv_ms,
                resting_hr = EXCLUDED.resting_hr,
                raw = EXCLUDED.raw,
                synced_at = NOW()
            `,
            [
                userId,
                localDate,
                sleepMinutes,
                Math.round((sleepMinutes / 480) * 100),
                hrvMs,
                restingHr,
                JSON.stringify({ seeded: true, localDate }),
            ]
        );
        saved += 1;
    }

    console.log(`Seeded ${saved} zepp wellness days for ${userId} through ${today}`);
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end().catch(() => {});
    });
