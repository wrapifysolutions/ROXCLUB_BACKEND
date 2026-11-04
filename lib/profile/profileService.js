const { queryWithHardTimeout, withTransaction } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { normalizeGender } = require('../onboarding/programMatch');
const { levelFromXp } = require('../onboarding/programCatalog');
const { presentAthleteDna } = require('../athlete/dnaPresenter');
const { loadAthleteDnaRow } = require('../athlete/dnaService');
const { listActivityHistory } = require('../workout/activityHistory');

const LAUNCH_SECTIONS = {
    editProfile: { status: 'available' },
    yourNumbers: { status: 'available' },
    settings: { status: 'available' },
    dna: { status: 'available', api: 'GET /api/athlete/dna' },
    activity: { status: 'available', api: 'GET /api/activities' },
    connections: { status: 'available', api: 'GET /api/integrations' },
    sharing: { status: 'available', mode: 'activity_share_card', api: 'GET /api/profile/share' },
    help: { status: 'available' },
    export: { status: 'available', api: 'GET /api/profile/export' },
    deleteAccount: { status: 'available', api: 'DELETE /api/profile' },
    programs: { status: 'coming_soon' },
    arena: { status: 'hidden' },
    premium: { status: 'coming_soon' },
    verification: { status: 'hidden' },
};

const NULL_USER_REFS = [
    'UPDATE club_memberships SET reviewed_by = NULL WHERE reviewed_by = $1',
    'UPDATE coach_applications SET reviewed_by = NULL WHERE reviewed_by = $1',
    'UPDATE admin_audit_log SET actor_user_id = NULL WHERE actor_user_id = $1',
    'UPDATE arena_result_audits SET actor_user_id = NULL WHERE actor_user_id = $1',
];

function httpError(status, message, code) {
    const error = new Error(message);
    error.status = status;
    error.code = code || 'PROFILE_ERROR';
    return error;
}

function asAvatar(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (_) {
            return null;
        }
    }
    return value;
}

function numberOrNull(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function q(options) {
    return options?.query || ((sql, params) => queryWithHardTimeout(sql, params, 8000));
}

async function optionalQuery(query, sql, params) {
    try {
        return await query(sql, params);
    } catch (error) {
        if (error.code === '42P01') return { rows: [] };
        throw error;
    }
}

function validTimezone(value) {
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(new Date());
        return true;
    } catch (_) {
        return false;
    }
}

function validIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseMetric(value, { min, max, label }) {
    if (value == null || value === '') return { value: null };
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        return { error: `${label} must be a number between ${min} and ${max}` };
    }
    return { value: number };
}

const IDENTITY_SQL = `
        /* profile:identity */
        SELECT
            u.id,
            u.email,
            COALESCE(u.display_name, oq.display_name) AS display_name,
            COALESCE(u.gender, oq.gender) AS gender,
            u.timezone,
            COALESCE(u.dob, oq.date_of_birth)::text AS date_of_birth,
            oq.avatar_config,
            oq.notifications_enabled,
            (u.onboarding_completed IS TRUE OR oq.is_completed IS TRUE) AS onboarding_done,
            COALESCE(bm.height_cm, oq.height) AS height_cm,
            COALESCE(bm.weight_kg, oq.weight) AS weight_kg,
            (
                SELECT COALESCE(SUM(xl.xp), 0)::int
                FROM xp_ledger xl
                WHERE xl.user_id = u.id
            ) AS xp_total
        FROM users u
        LEFT JOIN onboarding_questions oq ON oq.user_id = u.id
        LEFT JOIN body_metrics bm ON bm.user_id = u.id
        WHERE u.id = $1
`;

const IDENTITY_SQL_LEGACY = `
        /* profile:identity */
        SELECT
            u.id,
            u.email,
            COALESCE(u.display_name, oq.display_name) AS display_name,
            COALESCE(u.gender, oq.gender) AS gender,
            u.timezone,
            COALESCE(u.dob, oq.date_of_birth)::text AS date_of_birth,
            oq.avatar_config,
            oq.notifications_enabled,
            (u.onboarding_completed IS TRUE OR oq.is_completed IS TRUE) AS onboarding_done,
            oq.height AS height_cm,
            oq.weight AS weight_kg,
            0::int AS xp_total
        FROM users u
        LEFT JOIN onboarding_questions oq ON oq.user_id = u.id
        WHERE u.id = $1
`;

async function loadProfileRow(userId, query) {
    try {
        const { rows } = await query(IDENTITY_SQL, [userId]);
        return rows[0] || null;
    } catch (error) {
        if (error.code !== '42P01' && error.code !== '42703') throw error;
        const { rows } = await query(IDENTITY_SQL_LEGACY, [userId]);
        return rows[0] || null;
    }
}

async function loadConnections(userId, query) {
    const result = await optionalQuery(
        query,
        `
        /* profile:connections */
        SELECT provider, status, last_synced_at
        FROM user_integrations
        WHERE user_id = $1
          AND provider IN ('strava', 'zepp', 'apple_health', 'samsung_health', 'garmin')
        `,
        [userId]
    );
    return (result.rows || []).map((row) => ({
        provider: row.provider,
        label:
            row.provider === 'zepp'
                ? 'Amazfit/Zepp'
                : row.provider === 'apple_health'
                  ? 'Apple Health'
                  : row.provider === 'samsung_health'
                    ? 'Samsung Health'
                    : row.provider === 'garmin'
                      ? 'Garmin'
                      : row.provider === 'strava'
                        ? 'Strava'
                        : row.provider,
        connected: row.status === 'connected',
        lastSyncedAt: row.last_synced_at || null,
    }));
}

async function unreadCount(userId, query) {
    const result = await optionalQuery(
        query,
        `
        /* profile:unread */
        SELECT COUNT(*)::int AS count
        FROM notifications
        WHERE user_id = $1 AND read_at IS NULL
        `,
        [userId]
    );
    return Number(result.rows[0]?.count) || 0;
}

async function loadReadiness(userId, query) {
    const result = await optionalQuery(
        query,
        `
        /* profile:readiness */
        SELECT score, status, confidence, local_date::text AS local_date
        FROM daily_readiness
        WHERE user_id = $1
        ORDER BY local_date DESC
        LIMIT 1
        `,
        [userId]
    );
    const row = result.rows[0];
    if (!row) {
        return { status: 'CALIBRATING', score: null, confidence: null, localDate: null };
    }
    return {
        status: row.status || 'CALIBRATING',
        score: row.score == null ? null : Number(row.score),
        confidence: row.confidence || null,
        localDate: row.local_date || null,
    };
}

async function loadActivities(userId, query, limit) {
    try {
        return await listActivityHistory(userId, { query, limit });
    } catch (error) {
        if (error.code === '42P01') return { activities: [] };
        throw error;
    }
}

function supportHelp() {
    const email = String(process.env.SUPPORT_EMAIL || '').trim();
    return {
        email: email || null,
        subject: 'RoxClub support',
        mode: 'mailto',
    };
}

function buildShareCard(userName, activity) {
    if (!activity) return null;
    const durationMin =
        activity.durationSec == null ? null : Math.max(1, Math.round(Number(activity.durationSec) / 60));
    const name = String(userName || '').trim();
    const parts = [
        name && activity.title ? `${name} completed ${activity.title}` : activity.title || 'Workout complete',
        durationMin != null ? `${durationMin} min` : null,
        activity.totalXp != null ? `+${activity.totalXp} XP` : null,
    ].filter(Boolean);
    return {
        activityId: activity.activityId,
        title: activity.title,
        text: parts.join(' · '),
        durationSec: activity.durationSec,
        durationMin,
        xp: activity.totalXp,
        startAt: activity.startAt || null,
    };
}

function presentProfile(row, extras) {
    return {
        user: {
            id: row.id,
            name: String(row.display_name || '').trim(),
            email: row.email,
            gender: normalizeGender(row.gender),
            timezone: row.timezone || null,
            dateOfBirth: row.date_of_birth || null,
            avatar: asAvatar(row.avatar_config),
            heightCm: numberOrNull(row.height_cm),
            weightKg: numberOrNull(row.weight_kg),
        },
        level: levelFromXp(row.xp_total),
        athleteDna: extras.athleteDna,
        yourNumbers: {
            readiness: extras.readiness,
            athleteDna: extras.athleteDna,
            level: levelFromXp(row.xp_total),
        },
        connections: {
            providers: extras.providers,
            connectedWatches: extras.providers.filter((item) => item.connected),
            currentWatch: extras.providers.find((item) => item.connected) || null,
        },
        recentActivities: extras.recentActivities,
        notifications: {
            enabled: Boolean(row.notifications_enabled),
            unreadCount: extras.unreadCount,
        },
        sharing: {
            mode: 'activity_share_card',
            latestActivity: extras.recentActivities[0] || null,
            card: extras.shareCard,
        },
        help: supportHelp(),
        sections: LAUNCH_SECTIONS,
    };
}

async function getProfile(userId, options = {}) {
    if (!options.query) await ensureOnboardingProfileSchema();
    const query = q(options);
    const row = await loadProfileRow(userId, query);
    if (!row || !row.onboarding_done) {
        throw httpError(404, 'Onboarding not completed', 'ONBOARDING_INCOMPLETE');
    }

    const [dnaRow, history, providers, unread, readiness] = await Promise.all([
        loadAthleteDnaRow(userId, query),
        loadActivities(userId, query, 5),
        loadConnections(userId, query),
        unreadCount(userId, query),
        loadReadiness(userId, query),
    ]);
    const athleteDna = presentAthleteDna(dnaRow);

    return presentProfile(row, {
        athleteDna,
        recentActivities: history.activities,
        providers,
        unreadCount: unread,
        readiness,
        shareCard: buildShareCard(row.display_name, history.activities[0] || null),
    });
}

async function getShareCard(userId, activityId, options = {}) {
    if (!options.query) await ensureOnboardingProfileSchema();
    const query = q(options);
    const row = await loadProfileRow(userId, query);
    if (!row || !row.onboarding_done) {
        throw httpError(404, 'Onboarding not completed', 'ONBOARDING_INCOMPLETE');
    }
    const history = await loadActivities(userId, query, 20);
    const activity = activityId
        ? history.activities.find((item) => String(item.activityId) === String(activityId))
        : history.activities[0] || null;
    if (activityId && !activity) {
        throw httpError(404, 'Activity not found', 'ACTIVITY_NOT_FOUND');
    }
    const card = buildShareCard(row.display_name, activity);
    if (!card) {
        throw httpError(404, 'No completed activity to share', 'NOTHING_TO_SHARE');
    }
    return { mode: 'activity_share_card', card };
}

async function exportProfile(userId, options = {}) {
    const profile = await getProfile(userId, options);
    const query = q(options);
    const history = await loadActivities(userId, query, 50);
    return {
        exportedAt: new Date().toISOString(),
        user: profile.user,
        level: profile.level,
        athleteDna: profile.athleteDna,
        yourNumbers: profile.yourNumbers,
        connections: profile.connections,
        notifications: { enabled: profile.notifications.enabled },
        activities: history.activities,
    };
}

async function clearBlockingUserRefs(query, userId) {
    for (const sql of NULL_USER_REFS) {
        await optionalQuery(query, `/* profile:null_refs */ ${sql}`, [userId]);
    }
    await optionalQuery(
        query,
        '/* profile:null_refs */ DELETE FROM club_broadcasts WHERE created_by = $1',
        [userId]
    );
}

async function deleteAccount(userId, body, options = {}) {
    if (!options.query) await ensureOnboardingProfileSchema();
    const query = q(options);
    const confirmEmail = String(body?.confirmEmail || '').trim().toLowerCase();
    if (!confirmEmail) {
        throw httpError(400, 'confirmEmail is required to delete this account', 'CONFIRM_EMAIL_REQUIRED');
    }

    const row = await loadProfileRow(userId, query);
    if (!row) throw httpError(404, 'User not found', 'USER_NOT_FOUND');
    if (confirmEmail !== String(row.email || '').trim().toLowerCase()) {
        throw httpError(400, 'confirmEmail must match the account email', 'CONFIRM_EMAIL_MISMATCH');
    }

    const remove = async (clientQuery) => {
        await clearBlockingUserRefs(clientQuery, userId);
        try {
            await clientQuery(
                `
                /* profile:delete_user */
                DELETE FROM users
                WHERE id = $1
                `,
                [userId]
            );
        } catch (error) {
            if (error.code === '23503') {
                throw httpError(
                    409,
                    'This account still has linked records and cannot be deleted automatically',
                    'ACCOUNT_HAS_LINKED_RECORDS'
                );
            }
            throw error;
        }
    };

    if (options.query) {
        await remove(query);
    } else {
        await withTransaction((client) => remove((sql, params) => client.query(sql, params)));
    }

    return { deleted: true, redirect: '/login' };
}

function readPatch(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw httpError(400, 'JSON body is required', 'INVALID_PROFILE');
    }

    const patch = {};
    if (body.displayName !== undefined || body.name !== undefined) {
        const name = String(body.displayName ?? body.name ?? '').trim();
        if (!name || name.length > 100) {
            throw httpError(400, 'displayName must be 1-100 characters', 'INVALID_PROFILE');
        }
        patch.displayName = name;
    }
    if (body.gender !== undefined) {
        const gender = normalizeGender(body.gender);
        if (body.gender != null && body.gender !== '' && !gender) {
            throw httpError(400, 'gender must be male or female', 'INVALID_PROFILE');
        }
        patch.gender = gender;
    }
    if (body.timezone !== undefined) {
        const timezone = body.timezone == null || body.timezone === '' ? null : String(body.timezone).trim();
        if (timezone && !validTimezone(timezone)) {
            throw httpError(400, 'timezone is invalid', 'INVALID_PROFILE');
        }
        patch.timezone = timezone;
    }
    if (body.dateOfBirth !== undefined || body.dob !== undefined) {
        const dob = body.dateOfBirth ?? body.dob;
        if (dob == null || dob === '') {
            patch.dateOfBirth = null;
        } else {
            const text = String(dob).slice(0, 10);
            if (!validIsoDate(text)) {
                throw httpError(400, 'dateOfBirth must be YYYY-MM-DD', 'INVALID_PROFILE');
            }
            patch.dateOfBirth = text;
        }
    }
    if (body.avatar !== undefined) {
        if (body.avatar != null && (typeof body.avatar !== 'object' || Array.isArray(body.avatar))) {
            throw httpError(400, 'avatar must be a JSON object', 'INVALID_PROFILE');
        }
        patch.avatar = body.avatar || null;
    }
    if (body.notificationsEnabled !== undefined) {
        if (typeof body.notificationsEnabled !== 'boolean') {
            throw httpError(400, 'notificationsEnabled must be a boolean', 'INVALID_PROFILE');
        }
        patch.notificationsEnabled = body.notificationsEnabled;
    }
    if (body.heightCm !== undefined || body.height !== undefined) {
        const height = parseMetric(body.heightCm ?? body.height, {
            min: 50,
            max: 260,
            label: 'heightCm',
        });
        if (height.error) throw httpError(400, height.error, 'INVALID_PROFILE');
        patch.heightCm = height.value;
    }
    if (body.weightKg !== undefined || body.weight !== undefined) {
        const weight = parseMetric(body.weightKg ?? body.weight, {
            min: 20,
            max: 300,
            label: 'weightKg',
        });
        if (weight.error) throw httpError(400, weight.error, 'INVALID_PROFILE');
        patch.weightKg = weight.value;
    }

    if (!Object.keys(patch).length) {
        throw httpError(400, 'No profile fields to update', 'INVALID_PROFILE');
    }
    return patch;
}

async function updateProfile(userId, body, options = {}) {
    if (!options.query) await ensureOnboardingProfileSchema();
    const query = q(options);
    const patch = readPatch(body);
    const current = await loadProfileRow(userId, query);
    if (!current || !current.onboarding_done) {
        throw httpError(404, 'Onboarding not completed', 'ONBOARDING_INCOMPLETE');
    }

    const next = {
        displayName: patch.displayName !== undefined ? patch.displayName : current.display_name,
        gender: patch.gender !== undefined ? patch.gender : normalizeGender(current.gender),
        timezone: patch.timezone !== undefined ? patch.timezone : current.timezone,
        dateOfBirth: patch.dateOfBirth !== undefined ? patch.dateOfBirth : current.date_of_birth,
        avatar: patch.avatar !== undefined ? patch.avatar : asAvatar(current.avatar_config),
        notificationsEnabled:
            patch.notificationsEnabled !== undefined
                ? patch.notificationsEnabled
                : Boolean(current.notifications_enabled),
        heightCm: patch.heightCm !== undefined ? patch.heightCm : numberOrNull(current.height_cm),
        weightKg: patch.weightKg !== undefined ? patch.weightKg : numberOrNull(current.weight_kg),
    };

    await query(
        `
        /* profile:update_user */
        UPDATE users
        SET display_name = $2,
            gender = $3,
            timezone = $4,
            dob = $5::date,
            updated_at = NOW()
        WHERE id = $1
        `,
        [userId, next.displayName, next.gender, next.timezone, next.dateOfBirth]
    );

    const avatar = next.avatar || {};
    await query(
        `
        /* profile:update_questions */
        INSERT INTO onboarding_questions (
            user_id, display_name, date_of_birth, gender, height, weight,
            notifications_enabled, avatar_smile, avatar_hair, avatar_kit,
            avatar_skin_tone, avatar_config, updated_at
        )
        VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
            display_name = EXCLUDED.display_name,
            date_of_birth = EXCLUDED.date_of_birth,
            gender = EXCLUDED.gender,
            height = EXCLUDED.height,
            weight = EXCLUDED.weight,
            notifications_enabled = EXCLUDED.notifications_enabled,
            avatar_smile = EXCLUDED.avatar_smile,
            avatar_hair = EXCLUDED.avatar_hair,
            avatar_kit = EXCLUDED.avatar_kit,
            avatar_skin_tone = EXCLUDED.avatar_skin_tone,
            avatar_config = EXCLUDED.avatar_config,
            updated_at = NOW()
        `,
        [
            userId,
            next.displayName,
            next.dateOfBirth,
            next.gender,
            next.heightCm,
            next.weightKg,
            next.notificationsEnabled,
            avatar.smile || avatar.avatar_smile || null,
            avatar.hair || avatar.avatar_hair || null,
            avatar.kit || avatar.avatar_kit || null,
            avatar.skin_tone || avatar.skinTone || avatar.avatar_skin_tone || null,
            next.avatar ? JSON.stringify(next.avatar) : null,
        ]
    );

    if (patch.heightCm !== undefined || patch.weightKg !== undefined) {
        try {
            await query(
                `
                /* profile:update_metrics */
                INSERT INTO body_metrics (user_id, weight_kg, height_cm, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (user_id)
                DO UPDATE SET
                    weight_kg = EXCLUDED.weight_kg,
                    height_cm = EXCLUDED.height_cm,
                    updated_at = NOW()
                `,
                [userId, next.weightKg, next.heightCm]
            );
        } catch (error) {
            if (error.code !== '42P01') throw error;
        }
    }

    return getProfile(userId, { query });
}

module.exports = {
    getProfile,
    updateProfile,
    getShareCard,
    exportProfile,
    deleteAccount,
    buildShareCard,
    LAUNCH_SECTIONS,
};
