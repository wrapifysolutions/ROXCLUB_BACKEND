const { normalizeExperience, normalizeRace } = require('./programMatch');
const { resolveProgram, expandProgramSessions } = require('./programCatalog');

function answersFrom(row) {
    const experience = normalizeExperience(row?.experience_level || row?.training_experience);
    const goal = normalizeRace(row?.race_event || row?.training_goals);
    const raceDate = row?.race_date || null;
    return { experience, goal, raceDate };
}

async function runOnboardingComplete(client, userId, { today }) {
    const locked = await client.query(
        `
        /* onboarding_complete:lock */
        SELECT
            u.id,
            u.experience_level,
            u.onboarding_completed,
            oq.training_experience,
            oq.training_goals,
            rg.event AS race_event,
            rg.event_date AS race_date
        FROM users u
        LEFT JOIN onboarding_questions oq ON oq.user_id = u.id
        LEFT JOIN race_goals rg ON rg.user_id = u.id
        WHERE u.id = $1
        FOR UPDATE OF u
        `,
        [userId]
    );

    const user = locked.rows[0];
    if (!user) {
        const error = new Error('User not found');
        error.status = 404;
        throw error;
    }

    const existing = await client.query(
        `
        /* onboarding_complete:existing_program */
        SELECT program_id, start_date::text AS start_date
        FROM user_programs
        WHERE user_id = $1
        `,
        [userId]
    );

    if (existing.rows[0]) {
        await client.query(
            `
            /* onboarding_complete:mark_complete */
            UPDATE users
            SET onboarding_completed = TRUE, updated_at = NOW()
            WHERE id = $1
            `,
            [userId]
        );
        await client.query(
            `
            /* onboarding_complete:mark_questions */
            UPDATE onboarding_questions
            SET is_completed = TRUE, updated_at = NOW()
            WHERE user_id = $1
            `,
            [userId]
        );
        const count = await client.query(
            `
            /* onboarding_complete:count_sessions */
            SELECT COUNT(*)::int AS count
            FROM scheduled_sessions
            WHERE user_id = $1
            `,
            [userId]
        );
        return {
            created: false,
            programId: existing.rows[0].program_id,
            startDate: existing.rows[0].start_date,
            sessionCount: Number(count.rows[0].count),
        };
    }

    const answers = answersFrom(user);
    if (!answers.experience || !answers.goal) {
        const error = new Error(
            'Saved experience_level and race_goal are required before onboarding can complete'
        );
        error.status = 400;
        throw error;
    }

    const program = resolveProgram(answers.goal, answers.experience);
    const sessions = expandProgramSessions(program, today);

    await client.query(
        `
        /* onboarding_complete:insert_program */
        INSERT INTO user_programs (user_id, program_id, start_date)
        VALUES ($1, $2, $3::date)
        `,
        [userId, program.id, today]
    );

    await client.query(
        `
        /* onboarding_complete:insert_sessions */
        INSERT INTO scheduled_sessions (
            user_id, program_id, workout_id, title, duration_min,
            scheduled_on, plan_day, week_number
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
        [userId, JSON.stringify(sessions)]
    );

    await client.query(
        `
        /* onboarding_complete:insert_dna */
        INSERT INTO athlete_dna (
            user_id, status, model_version, attributes,
            strength, engine, endurance, power, mobility
        )
        VALUES ($1, 'CALIBRATING', 'v0', NULL, NULL, NULL, NULL, NULL, NULL)
        ON CONFLICT (user_id) DO NOTHING
        `,
        [userId]
    );

    await client.query(
        `
        /* onboarding_complete:mark_complete */
        UPDATE users
        SET onboarding_completed = TRUE, updated_at = NOW()
        WHERE id = $1
        `,
        [userId]
    );
    await client.query(
        `
        /* onboarding_complete:mark_questions */
        UPDATE onboarding_questions
        SET is_completed = TRUE, updated_at = NOW()
        WHERE user_id = $1
        `,
        [userId]
    );

    return {
        created: true,
        programId: program.id,
        startDate: today,
        sessionCount: sessions.length,
        raceDate: answers.raceDate,
        todayWorkout: sessions.find((session) => session.scheduled_on === today) || null,
    };
}

module.exports = { runOnboardingComplete, answersFrom };
