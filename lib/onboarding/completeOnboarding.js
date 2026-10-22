const { queryWithHardTimeout } = require('../dbQuery');
const { readConsent } = require('./consent');
const { ensureOnboardingProfileSchema } = require('./schema');
const {
    normalizeGender,
    normalizeExperience,
    normalizeRace,
    raceLabel,
    matchProgram,
    readDate,
    readMetric,
} = require('./programMatch');

const SMILES = ['smile', 'grin', 'focused'];
const HAIRS = ['short', 'medium', 'long', 'buzz'];
const KITS = ['black', 'red', 'white', 'navy'];
const SKINS = ['light', 'medium', 'deep'];

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function cleanToken(value, max) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.slice(0, max);
}

function buildAvatar(body) {
    const skipped = Boolean(body.avatar_skipped);
    const source = body.avatar && typeof body.avatar === 'object' ? body.avatar : body;
    const randomized = Boolean(
        body.avatar_randomized || body.avatar_randomize || source.randomize || source.randomized
    );

    if (skipped) {
        return {
            smile: null,
            hair: null,
            kit: null,
            skin_tone: null,
            skipped: true,
            randomized: false,
        };
    }

    const smile = cleanToken(source.avatar_smile || source.smile, 50);
    const hair = cleanToken(source.avatar_hair || source.hair, 50);
    const kit = cleanToken(source.avatar_kit || source.kit, 50);
    const skin = cleanToken(source.avatar_skin_tone || source.skin_tone, 30);

    if (randomized) {
        return {
            smile: smile || pick(SMILES),
            hair: hair || pick(HAIRS),
            kit: kit || pick(KITS),
            skin_tone: skin || pick(SKINS),
            skipped: false,
            randomized: true,
        };
    }

    if (!smile || !hair || !kit) {
        return {
            error:
                'avatar_smile, avatar_hair, and avatar_kit are required (or set avatar_skipped=true or avatar_randomized=true)',
        };
    }

    return {
        smile,
        hair,
        kit,
        skin_tone: skin,
        skipped: false,
        randomized: false,
    };
}

function parseProfile(body) {
    const displayName = cleanToken(body.display_name || body.name, 100);
    const dob = readDate(body.date_of_birth || body.dob, {
        required: true,
        label: 'date_of_birth',
        allowFuture: false,
    });
    const gender = normalizeGender(body.gender);
    const experience = normalizeExperience(body.training_experience || body.experience_level);
    const goalsText = cleanToken(body.training_goals, 100);
    const event =
        normalizeRace(body.race_goal || body.race_event || body.event) ||
        normalizeRace(goalsText);
    const eventDate = readDate(body.event_date || body.race_date || body.goal_date, {
        label: 'event_date',
        allowFuture: true,
    });
    const height = readMetric(body.height_cm ?? body.height, {
        min: 50,
        max: 260,
        label: 'height_cm',
    });
    const weight = readMetric(body.weight_kg ?? body.weight, {
        min: 20,
        max: 300,
        label: 'weight_kg',
    });
    const avatar = buildAvatar(body);
    const pushTokenRaw = body.push_token || body.device_token || body.fcm_token;
    const pushToken =
        pushTokenRaw == null || String(pushTokenRaw).trim() === ''
            ? null
            : String(pushTokenRaw).trim();

    if (dob.error) return { error: dob.error };
    if (eventDate.error) return { error: eventDate.error };
    if (height.error) return { error: height.error };
    if (weight.error) return { error: weight.error };
    if (avatar.error) return { error: avatar.error };
    if (pushToken && pushToken.length > 4096) return { error: 'push_token is invalid' };

    if (!displayName || !gender || !experience || (!event && !goalsText)) {
        return {
            error:
                'display_name, date_of_birth, gender (male/female), training_experience (beginner/intermediate/advanced), and a race goal are required. height and weight are optional',
        };
    }

    const storedEvent = event || 'general_fitness';
    return {
        value: {
            displayName,
            dob: dob.value,
            gender,
            experience,
            event: storedEvent,
            eventDate: eventDate.value,
            goalsText: goalsText || raceLabel(storedEvent),
            heightCm: height.value,
            weightKg: weight.value,
            notificationsEnabled: Boolean(body.notifications_enabled),
            locationEnabled: Boolean(body.location_enabled),
            motionEnabled: Boolean(body.motion_enabled),
            pushToken,
            avatar,
            consent: readConsent(body),
        },
    };
}

async function applyConsent(userId, body) {
    const consent = readConsent(body);
    if (!consent || !userId) return null;

    await ensureOnboardingProfileSchema();
    const { rows } = await queryWithHardTimeout(
        `
        UPDATE users
        SET
            consent_accepted_at = COALESCE(consent_accepted_at, NOW()),
            consent_version = COALESCE(consent_version, $2),
            updated_at = NOW()
        WHERE id = $1
        RETURNING consent_accepted_at, consent_version
        `,
        [userId, consent.version],
        8000
    );
    return rows[0] || null;
}

async function applyConsentByEmail(email, body) {
    const consent = readConsent(body);
    if (!consent || !email) return null;

    await ensureOnboardingProfileSchema();
    const { rows } = await queryWithHardTimeout(
        `
        UPDATE users
        SET
            consent_accepted_at = COALESCE(consent_accepted_at, NOW()),
            consent_version = COALESCE(consent_version, $2),
            updated_at = NOW()
        WHERE email = $1
        RETURNING id, consent_accepted_at, consent_version
        `,
        [email, consent.version],
        8000
    );
    return rows[0] || null;
}

async function saveAthleteProfile(userId, event, experience) {
    const program = matchProgram(event, experience);
    const { rows } = await queryWithHardTimeout(
        `
        INSERT INTO athlete_profiles (
            user_id, program_key, program_name, dna_status, updated_at
        )
        VALUES ($1, $2, $3, 'CALIBRATING', NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
            program_key = EXCLUDED.program_key,
            program_name = EXCLUDED.program_name,
            updated_at = NOW()
        RETURNING program_key, program_name, dna_status
        `,
        [userId, program.key, program.name],
        8000
    );
    return rows[0];
}

async function completeOnboarding(userId, body, location) {
    const parsed = parseProfile(body);
    if (parsed.error) {
        const error = new Error(parsed.error);
        error.status = 400;
        throw error;
    }

    const profile = parsed.value;
    await ensureOnboardingProfileSchema();

    await queryWithHardTimeout(
        `
        UPDATE users
        SET
            display_name = $2,
            dob = $3,
            gender = $4,
            experience_level = $5,
            consent_accepted_at = COALESCE(
                consent_accepted_at,
                CASE WHEN $6::boolean THEN NOW() ELSE NULL END
            ),
            consent_version = COALESCE(consent_version, $7),
            updated_at = NOW()
        WHERE id = $1
        `,
        [
            userId,
            profile.displayName,
            profile.dob,
            profile.gender,
            profile.experience,
            Boolean(profile.consent),
            profile.consent ? profile.consent.version : null,
        ],
        8000
    );

    await queryWithHardTimeout(
        `
        INSERT INTO body_metrics (user_id, weight_kg, height_cm, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
            weight_kg = EXCLUDED.weight_kg,
            height_cm = EXCLUDED.height_cm,
            updated_at = NOW()
        `,
        [userId, profile.weightKg, profile.heightCm],
        8000
    );

    await queryWithHardTimeout(
        `
        INSERT INTO race_goals (user_id, event, event_date, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
            event = EXCLUDED.event,
            event_date = EXCLUDED.event_date,
            updated_at = NOW()
        `,
        [userId, profile.event, profile.eventDate],
        8000
    );

    const avatarConfig = {
        smile: profile.avatar.smile,
        hair: profile.avatar.hair,
        kit: profile.avatar.kit,
        skin_tone: profile.avatar.skin_tone,
        randomized: profile.avatar.randomized,
        skipped: profile.avatar.skipped,
    };

    const { rows } = await queryWithHardTimeout(
        `
        INSERT INTO onboarding_questions (
            user_id,
            display_name,
            date_of_birth,
            gender,
            height,
            weight,
            training_experience,
            training_goals,
            notifications_enabled,
            location_enabled,
            latitude,
            longitude,
            location_city,
            location_region,
            location_country,
            location_source,
            avatar_smile,
            avatar_hair,
            avatar_kit,
            avatar_skin_tone,
            avatar_skipped,
            avatar_config,
            motion_enabled,
            push_token,
            is_completed,
            updated_at
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10,
            $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22::jsonb,
            $23, $24,
            FALSE, NOW()
        )
        ON CONFLICT (user_id)
        DO UPDATE SET
            display_name = EXCLUDED.display_name,
            date_of_birth = EXCLUDED.date_of_birth,
            gender = EXCLUDED.gender,
            height = EXCLUDED.height,
            weight = EXCLUDED.weight,
            training_experience = EXCLUDED.training_experience,
            training_goals = EXCLUDED.training_goals,
            notifications_enabled = EXCLUDED.notifications_enabled,
            location_enabled = EXCLUDED.location_enabled,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            location_city = EXCLUDED.location_city,
            location_region = EXCLUDED.location_region,
            location_country = EXCLUDED.location_country,
            location_source = EXCLUDED.location_source,
            avatar_smile = EXCLUDED.avatar_smile,
            avatar_hair = EXCLUDED.avatar_hair,
            avatar_kit = EXCLUDED.avatar_kit,
            avatar_skin_tone = EXCLUDED.avatar_skin_tone,
            avatar_skipped = EXCLUDED.avatar_skipped,
            avatar_config = EXCLUDED.avatar_config,
            motion_enabled = EXCLUDED.motion_enabled,
            push_token = EXCLUDED.push_token,
            is_completed = onboarding_questions.is_completed,
            updated_at = NOW()
        RETURNING *
        `,
        [
            userId,
            profile.displayName,
            profile.dob,
            profile.gender,
            profile.heightCm,
            profile.weightKg,
            profile.experience,
            profile.goalsText,
            profile.notificationsEnabled,
            profile.locationEnabled,
            location.latitude,
            location.longitude,
            location.city,
            location.region,
            location.country,
            location.source,
            profile.avatar.smile,
            profile.avatar.hair,
            profile.avatar.kit,
            profile.avatar.skin_tone,
            profile.avatar.skipped,
            JSON.stringify(avatarConfig),
            profile.motionEnabled,
            profile.pushToken,
        ],
        8000
    );

    return {
        data: rows[0],
    };
}

module.exports = {
    completeOnboarding,
    applyConsent,
    applyConsentByEmail,
    saveAthleteProfile,
    normalizeRace,
    normalizeExperience,
};
