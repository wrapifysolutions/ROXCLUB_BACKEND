#!/usr/bin/env node
/**
 * One-time admin bootstrap. Does not grant admin until the email is verified
 * through the existing OTP/auth path. Never prints the password or OTP.
 *
 * Required env:
 *   ADMIN_BOOTSTRAP_ENABLED=true
 *   ADMIN_BOOTSTRAP_EMAIL
 *   ADMIN_BOOTSTRAP_PASSWORD
 *
 * Re-run after the operator verifies the email. Then set ADMIN_BOOTSTRAP_ENABLED=false.
 */
require('dotenv').config();
const { hashPassword } = require('../data/encryption');
const { query } = require('../lib/dbQuery');

function readEnv(env = process.env) {
    return {
        enabled: String(env.ADMIN_BOOTSTRAP_ENABLED || '').toLowerCase() === 'true',
        email: String(env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase(),
        password: String(env.ADMIN_BOOTSTRAP_PASSWORD || ''),
    };
}

async function bootstrapAdmin({ env = process.env, queryFn = query, hash = hashPassword, sendOtp } = {}) {
    const config = readEnv(env);
    if (!config.enabled) {
        return { ok: false, code: 'BOOTSTRAP_DISABLED' };
    }
    if (!config.email || !config.password || config.password.length < 8) {
        return { ok: false, code: 'BOOTSTRAP_ENV_INVALID' };
    }

    const passwordHash = await hash(config.password);
    const existing = await queryFn(
        `
        SELECT id, email, is_email_verified, account_type
        FROM users
        WHERE email = $1
        `,
        [config.email]
    );
    const row = existing.rows[0];

    if (row?.account_type === 'admin' && row.is_email_verified) {
        return { ok: true, code: 'ALREADY_ADMIN', userId: row.id };
    }

    if (!row) {
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const otpHash = await hash(otp);
        const inserted = await queryFn(
            `
            INSERT INTO users (
                email, password_hash, otp_hash, otp_expires_at,
                auth_provider, is_email_verified, account_type
            )
            VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes', 'email', FALSE, NULL)
            RETURNING id
            `,
            [config.email, passwordHash, otpHash]
        );
        if (sendOtp) await sendOtp({ email: config.email, otp });
        return { ok: true, code: 'VERIFY_EMAIL_REQUIRED', userId: inserted.rows[0].id };
    }

    if (!row.is_email_verified) {
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const otpHash = await hash(otp);
        await queryFn(
            `
            UPDATE users
            SET password_hash = $2,
                otp_hash = $3,
                otp_expires_at = NOW() + INTERVAL '10 minutes',
                updated_at = NOW()
            WHERE id = $1 AND account_type IS DISTINCT FROM 'admin'
            `,
            [row.id, passwordHash, otpHash]
        );
        if (sendOtp) await sendOtp({ email: config.email, otp });
        return { ok: true, code: 'VERIFY_EMAIL_REQUIRED', userId: row.id };
    }

    await queryFn(
        `
        UPDATE users
        SET account_type = 'admin', updated_at = NOW()
        WHERE id = $1 AND email = $2 AND is_email_verified = TRUE
        `,
        [row.id, config.email]
    );
    await queryFn(
        `
        INSERT INTO admin_audit_log (actor_user_id, action, target_user_id, detail)
        VALUES ($1, 'admin_bootstrap', $1, $2::jsonb)
        `,
        [row.id, JSON.stringify({ email: config.email })]
    );
    return { ok: true, code: 'ADMIN_GRANTED', userId: row.id };
}

async function main() {
    const result = await bootstrapAdmin();
    const safe = { ok: result.ok, code: result.code };
    console.log(JSON.stringify(safe));
    if (!result.ok || result.code === 'BOOTSTRAP_ENV_INVALID') process.exitCode = 1;
}

if (require.main === module) {
    main().catch((error) => {
        console.error(JSON.stringify({ ok: false, code: 'BOOTSTRAP_FAILED' }));
        process.exitCode = 1;
        if (process.env.ADMIN_BOOTSTRAP_DEBUG === 'true') {
            console.error(error.message);
        }
    });
}

module.exports = { bootstrapAdmin, readEnv };
