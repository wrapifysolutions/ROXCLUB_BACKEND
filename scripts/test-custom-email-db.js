const pool = require('../lib/pool');
const { hashPassword, verifyPassword } = require('../data/encryption');

async function main() {
    const email = 'otp-test@roxclub.local';
    const password = 'Secret123!';
    const otp = '123456';

    const passwordHash = await hashPassword(password);
    const otpHash = await hashPassword(otp);

    await pool.query(
        `
        INSERT INTO users (
            email,
            password_hash,
            otp_hash,
            otp_expires_at,
            auth_provider,
            is_email_verified,
            updated_at
        )
        VALUES ($1, $2, $3, NOW() + INTERVAL '1 minute', 'email', FALSE, NOW())
        ON CONFLICT (email)
        DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            otp_hash = EXCLUDED.otp_hash,
            otp_expires_at = EXCLUDED.otp_expires_at,
            updated_at = NOW()
        `,
        [email, passwordHash, otpHash]
    );

    const { rows } = await pool.query(
        `
        SELECT email, password_hash, otp_hash, otp_expires_at > NOW() AS otp_valid
        FROM users
        WHERE email = $1
        `,
        [email]
    );

    const user = rows[0];
    const passwordOk = await verifyPassword(password, user.password_hash);
    const otpOk = await verifyPassword(otp, user.otp_hash);

    console.log({
        email: user.email,
        passwordOk,
        otpOk,
        otpValid: user.otp_valid,
    });

    // Simulate expiry: set expires_at in the past, then clear like VerifyEmailOTP does
    await pool.query(
        `
        UPDATE users
        SET otp_expires_at = NOW() - INTERVAL '1 second'
        WHERE email = $1
        `,
        [email]
    );

    await pool.query(
        `
        UPDATE users
        SET otp_hash = NULL,
            otp_expires_at = NULL
        WHERE email = $1
          AND otp_expires_at < NOW()
        `,
        [email]
    );

    const after = await pool.query(
        'SELECT otp_hash, otp_expires_at FROM users WHERE email = $1',
        [email]
    );

    console.log({
        otpGone: after.rows[0].otp_hash === null && after.rows[0].otp_expires_at === null,
    });

    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    await pool.end();
}

main().catch(async (error) => {
    console.error(error);
    try {
        await pool.end();
    } catch (_) {}
    process.exit(1);
});
