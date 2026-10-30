const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { applicationDto } = require('../account/accountService');
const { signPrivateCertification } = require('../storage/privateObjectStorage');

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

async function assertAdmin(userId, query) {
    const { rows } = await query(
        `
        /* admin:load_actor */
        SELECT id, account_type
        FROM users
        WHERE id = $1
        `,
        [userId]
    );
    if (rows[0]?.account_type !== 'admin') {
        throw httpError('ADMIN_REQUIRED', 403, 'Admin authorization is required');
    }
    return rows[0];
}

async function writeAudit(query, { actorId, action, targetUserId, applicationId, detail }) {
    await query(
        `
        /* admin:audit */
        INSERT INTO admin_audit_log (actor_user_id, action, target_user_id, target_application_id, detail)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        `,
        [actorId, action, targetUserId || null, applicationId || null, JSON.stringify(detail || {})]
    );
}

async function loadApplication(id, query) {
    const { rows } = await query(
        `
        /* admin:load_application */
        SELECT *
        FROM coach_applications
        WHERE id = $1
        `,
        [id]
    );
    if (!rows[0]) throw httpError('APPLICATION_NOT_FOUND', 404, 'Coach application not found');
    return rows[0];
}

async function listApplications(actorId, status, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await assertAdmin(actorId, query);
    const filter = status || 'pending';
    const { rows } = await query(
        `
        /* admin:list_applications */
        SELECT *
        FROM coach_applications
        WHERE ($1::text = 'all' OR status = $1)
        ORDER BY created_at DESC
        `,
        [filter]
    );
    return { applications: rows.map((row) => applicationDto(row)) };
}

async function getApplication(actorId, applicationId, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await assertAdmin(actorId, query);
    const row = await loadApplication(applicationId, query);
    return {
        application: applicationDto(row, { includeDocumentKey: false }),
        document: row.document_key
            ? {
                  available: true,
                  access: 'admin_only_private',
                  publicUrl: null,
                  signedUrl: await signPrivateCertification(row.document_key),
              }
            : { available: false, publicUrl: null, signedUrl: null },
    };
}

async function reviewApplication(actorId, applicationId, action, body, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await assertAdmin(actorId, query);
    const row = await loadApplication(applicationId, query);
    if (String(row.user_id) === String(actorId)) {
        throw httpError('ROLE_NOT_ALLOWED', 403, 'You cannot review your own application');
    }

    if (action === 'approve') {
        if (row.status !== 'pending') {
            throw httpError('INVALID_STATUS', 409, 'Only pending applications can be approved');
        }
        const updated = await query(
            `
            /* admin:approve */
            UPDATE coach_applications
            SET status = 'approved', reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status = 'pending'
            RETURNING *
            `,
            [applicationId, actorId]
        );
        await writeAudit(query, {
            actorId,
            action: 'coach_approved',
            targetUserId: row.user_id,
            applicationId,
        });
        return { application: applicationDto(updated.rows[0]) };
    }

    if (action === 'reject') {
        const reason = String(body?.reason || '').trim();
        if (!reason) throw httpError('REASON_REQUIRED', 400, 'A rejection reason is required');
        if (row.status !== 'pending') {
            throw httpError('INVALID_STATUS', 409, 'Only pending applications can be rejected');
        }
        const updated = await query(
            `
            /* admin:reject */
            UPDATE coach_applications
            SET status = 'rejected', rejection_reason = $3, reviewed_by = $2,
                reviewed_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status = 'pending'
            RETURNING *
            `,
            [applicationId, actorId, reason]
        );
        await writeAudit(query, {
            actorId,
            action: 'coach_rejected',
            targetUserId: row.user_id,
            applicationId,
            detail: { reason },
        });
        return { application: applicationDto(updated.rows[0]) };
    }

    if (action === 'suspend') {
        const reason = String(body?.reason || '').trim();
        if (row.status !== 'approved') {
            throw httpError('INVALID_STATUS', 409, 'Only approved coaches can be suspended');
        }
        const updated = await query(
            `
            /* admin:suspend */
            UPDATE coach_applications
            SET status = 'suspended', rejection_reason = $3, reviewed_by = $2,
                reviewed_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status = 'approved'
            RETURNING *
            `,
            [applicationId, actorId, reason || null]
        );
        await writeAudit(query, {
            actorId,
            action: 'coach_suspended',
            targetUserId: row.user_id,
            applicationId,
            detail: { reason: reason || null },
        });
        return { application: applicationDto(updated.rows[0]) };
    }

    throw httpError('INVALID_ACTION', 400, 'Unsupported review action');
}

async function assertApprovedCoach(userId, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    const { rows } = await query(
        `
        /* coach:latest_status */
        SELECT status
        FROM coach_applications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [userId]
    );
    if (rows[0]?.status !== 'approved') {
        throw httpError('COACH_NOT_APPROVED', 403, 'Approved coach access is required');
    }
    return true;
}

module.exports = {
    listApplications,
    getApplication,
    reviewApplication,
    assertApprovedCoach,
    assertAdmin,
};
