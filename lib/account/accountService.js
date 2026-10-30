const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { resolveNavigation, rejectClientAdmin } = require('../auth/accountRouting');
const { validateCertificationFile, uploadPrivateCertification } = require('../storage/privateObjectStorage');

const SPECIALTIES = new Set(['HYROX', 'Running', 'Strength', 'Hybrid']);

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

async function ready(options) {
    if (options?.query) return;
    await ensureOnboardingProfileSchema();
}

async function loadUser(userId, query) {
    const { rows } = await query(
        `
        /* account:load_user */
        SELECT id, email, auth_provider, account_type, onboarding_completed
        FROM users
        WHERE id = $1
        `,
        [userId]
    );
    if (!rows[0]) throw httpError('USER_NOT_FOUND', 404, 'User not found');
    return rows[0];
}

async function latestCoachStatus(userId, query) {
    const { rows } = await query(
        `
        /* account:latest_coach */
        SELECT status
        FROM coach_applications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [userId]
    );
    return rows[0]?.status || null;
}

async function navigationForUser(userId, query) {
    const user = await loadUser(userId, query);
    const coachStatus = await latestCoachStatus(userId, query);
    return {
        user,
        coachStatus,
        navigation: resolveNavigation({
            accountType: user.account_type,
            onboardingCompleted: Boolean(user.onboarding_completed),
            coachStatus,
        }),
    };
}

async function selectAccountType(userId, body, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    try {
        rejectClientAdmin(body || {});
    } catch (error) {
        throw error;
    }
    const requested = String(body?.accountType || '').trim().toLowerCase();
    if (requested !== 'athlete' && requested !== 'coach') {
        throw httpError('INVALID_ACCOUNT_TYPE', 400, 'accountType must be athlete or coach');
    }

    const user = await loadUser(userId, query);
    if (user.account_type === 'admin') {
        throw httpError('ROLE_NOT_ALLOWED', 403, 'Admin access cannot be changed here');
    }

    const keepAthlete =
        Boolean(user.onboarding_completed) || user.account_type === 'athlete';
    if (requested === 'coach' && keepAthlete) {
        const coachStatus = await latestCoachStatus(userId, query);
        return {
            preservedAthlete: true,
            accountType: user.account_type || 'athlete',
            navigation: resolveNavigation({
                accountType: user.account_type || 'athlete',
                onboardingCompleted: Boolean(user.onboarding_completed),
                coachStatus,
            }),
            nextAction: 'POST /api/coach/applications',
        };
    }

    if (user.account_type && user.account_type !== requested) {
        throw httpError('ACCOUNT_TYPE_LOCKED', 409, 'Account type is already set');
    }

    if (user.account_type !== requested) {
        await query(
            `
            /* account:set_type */
            UPDATE users
            SET account_type = $2, updated_at = NOW()
            WHERE id = $1
              AND (account_type IS NULL OR account_type = $2)
              AND account_type IS DISTINCT FROM 'admin'
            `,
            [userId, requested]
        );
    }

    const state = await navigationForUser(userId, query);
    return {
        preservedAthlete: false,
        accountType: state.user.account_type,
        navigation: state.navigation,
    };
}

function applicationDto(row, { includeDocumentKey = false } = {}) {
    if (!row) return null;
    return {
        id: row.id,
        userId: row.user_id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        country: row.country,
        city: row.city,
        specialty: row.specialty,
        yearsExperience: row.years_experience,
        qualifications: row.qualifications,
        biography: row.biography,
        status: row.status,
        rejectionReason: row.rejection_reason || null,
        reviewedAt: row.reviewed_at || null,
        createdAt: row.created_at,
        documentAvailable: Boolean(row.document_key),
        ...(includeDocumentKey ? { documentKey: row.document_key || null } : {}),
    };
}

function validateApplication(body, authEmail) {
    rejectClientAdmin(body || {});
    if (body?.status || body?.role || body?.accountType) {
        throw httpError('ROLE_NOT_ALLOWED', 403, 'Application status and role cannot be set by the client');
    }
    const fullName = String(body?.fullName || '').trim();
    const phone = String(body?.phone || '').trim();
    const country = String(body?.country || '').trim();
    const city = String(body?.city || '').trim();
    const specialty = String(body?.specialty || '').trim();
    const years = Number(body?.yearsExperience);
    const qualifications = String(body?.qualifications || '').trim();
    const biography = String(body?.biography || '').trim();
    if (!fullName || !phone || !country || !city || !qualifications || !biography) {
        throw httpError('INVALID_APPLICATION', 400, 'Required coach application fields are missing');
    }
    if (!SPECIALTIES.has(specialty)) {
        throw httpError('INVALID_SPECIALTY', 400, 'specialty must be HYROX, Running, Strength, or Hybrid');
    }
    if (!Number.isInteger(years) || years < 0 || years > 80) {
        throw httpError('INVALID_EXPERIENCE', 400, 'yearsExperience must be a whole number from 0 to 80');
    }
    return {
        fullName,
        email: authEmail,
        phone,
        country,
        city,
        specialty,
        yearsExperience: years,
        qualifications,
        biography,
    };
}

async function submitCoachApplication(userId, authEmail, body, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    const user = await loadUser(userId, query);
    if (user.account_type === 'admin') {
        throw httpError('ROLE_NOT_ALLOWED', 403, 'Admin accounts cannot apply as coaches here');
    }
    const fields = validateApplication(body, authEmail);
    let documentKey = null;
    if (body?.file) {
        validateCertificationFile(body.file);
        if (!body.file.buffer) {
            throw httpError(
                'FILE_REQUIRED',
                400,
                'Send the certification as multipart form-data in the file field'
            );
        }
        const uploaded = await uploadPrivateCertification(
            {
                buffer: body.file.buffer,
                filename: body.file.filename,
                mimeType: body.file.mimeType,
                size: body.file.size,
            },
            { userId }
        );
        documentKey = uploaded.documentKey;
    }
    const { rows: existing } = await query(
        `
        /* coach:list_own */
        SELECT id, status
        FROM coach_applications
        WHERE user_id = $1
        ORDER BY created_at DESC
        `,
        [userId]
    );
    const latest = existing[0];
    if (latest?.status === 'pending') {
        throw httpError('APPLICATION_PENDING', 409, 'A coach application is already pending');
    }
    if (latest?.status === 'approved') {
        throw httpError('ALREADY_APPROVED', 409, 'Coach access is already approved');
    }
    if (latest?.status === 'suspended') {
        throw httpError('COACH_SUSPENDED', 409, 'Suspended coaches cannot submit a new application');
    }

    try {
        const inserted = await query(
            `
            /* coach:insert_application */
            INSERT INTO coach_applications (
                user_id, full_name, email, phone, country, city, specialty,
                years_experience, qualifications, biography, document_key, status
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
            RETURNING *
            `,
            [
                userId,
                fields.fullName,
                fields.email,
                fields.phone,
                fields.country,
                fields.city,
                fields.specialty,
                fields.yearsExperience,
                fields.qualifications,
                fields.biography,
                documentKey,
            ]
        );
        return applicationDto(inserted.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            throw httpError('APPLICATION_PENDING', 409, 'A coach application is already pending');
        }
        throw error;
    }
}

async function listOwnApplications(userId, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    const { rows } = await query(
        `
        /* coach:list_own */
        SELECT *
        FROM coach_applications
        WHERE user_id = $1
        ORDER BY created_at DESC
        `,
        [userId]
    );
    return {
        current: applicationDto(rows[0]),
        history: rows.map((row) => applicationDto(row)),
    };
}

module.exports = {
    selectAccountType,
    submitCoachApplication,
    listOwnApplications,
    navigationForUser,
    applicationDto,
    validateApplication,
    SPECIALTIES,
};
