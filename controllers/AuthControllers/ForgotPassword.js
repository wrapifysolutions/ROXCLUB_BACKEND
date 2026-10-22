const transporter = require('../../lib/nodemailer');
const pool = require('../../lib/pool');
const { hashPassword, verifyPassword } = require('../../data/encryption');
const { createAccessToken, setAuthCookie } = require('../../lib/token');

const RESET_OTP_MINUTES = 5;

async function clearExpiredResetOtp(email) {
    await pool.query(
        `
        UPDATE users
        SET otp_hash = NULL,
            otp_expires_at = NULL,
            updated_at = NOW()
        WHERE email = $1
          AND otp_expires_at IS NOT NULL
          AND otp_expires_at < NOW()
        `,
        [email]
    );
}

/** POST /auth/forgot-password { email } */
const ForgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        await clearExpiredResetOtp(normalizedEmail);

        const { rows } = await pool.query(
            `
            SELECT id, email, auth_provider, is_email_verified, password_hash
            FROM users
            WHERE email = $1
            `,
            [normalizedEmail]
        );

        const user = rows[0];

        if (!user) {
            return res.status(404).json({ message: 'No account found for this email' });
        }

        if (user.auth_provider !== 'email') {
            return res.status(403).json({
                message: 'This account uses social login. Sign in with Google or Apple.',
            });
        }

        if (!user.is_email_verified) {
            return res.status(403).json({
                message: 'Please verify your email first, or sign up again.',
            });
        }

        if (!user.password_hash) {
            return res.status(400).json({
                message: 'Password reset is not available for this account.',
            });
        }

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const hashedOTP = await hashPassword(otp);

        await pool.query(
            `
            UPDATE users
            SET otp_hash = $1,
                otp_expires_at = NOW() + ($2::text || ' minutes')::interval,
                updated_at = NOW()
            WHERE id = $3
            `,
            [hashedOTP, String(RESET_OTP_MINUTES), user.id]
        );

        const result = await transporter.sendMail({
            from: '"ROXCLUB" <wrapifysolutions@gmail.com>',
            to: normalizedEmail,
            subject: 'Reset Your Password | ROXCLUB',
            text: `
You requested a password reset for your ROXCLUB account.

Your reset code is: ${otp}

This code will expire in ${RESET_OTP_MINUTES} minutes.

If you did not request this, you can ignore this email.

The ROXCLUB Team
            `,
        });

        if (!result.accepted || result.accepted.length === 0) {
            return res.status(400).json({ message: 'Failed to send email' });
        }

        return res.status(200).json({
            message: 'Password reset code sent to your email',
            expires_in_minutes: RESET_OTP_MINUTES,
        });
    } catch (error) {
        console.error('ForgotPassword error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

/** POST /auth/reset-password { email, otp, password } */
const ResetPassword = async (req, res) => {
    try {
        const { email, otp, password } = req.body;

        if (!email || !otp || !password) {
            return res.status(400).json({
                message: 'Email, OTP, and new password are required',
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const otpCode = String(otp).trim();

        if (String(password).length < 8) {
            return res.status(400).json({
                message: 'Password must be at least 8 characters',
            });
        }

        await clearExpiredResetOtp(normalizedEmail);

        const { rows } = await pool.query(
            `
            SELECT id, email, auth_provider, is_email_verified, otp_hash, otp_expires_at
            FROM users
            WHERE email = $1
            `,
            [normalizedEmail]
        );

        const user = rows[0];

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.auth_provider !== 'email' || !user.is_email_verified) {
            return res.status(403).json({ message: 'Password reset not allowed for this account' });
        }

        if (!user.otp_hash || !user.otp_expires_at) {
            return res.status(400).json({
                message: 'Reset code expired or not found. Request a new one.',
            });
        }

        if (new Date(user.otp_expires_at) < new Date()) {
            await pool.query(
                `
                UPDATE users
                SET otp_hash = NULL,
                    otp_expires_at = NULL,
                    updated_at = NOW()
                WHERE id = $1
                `,
                [user.id]
            );
            return res.status(400).json({ message: 'Reset code expired. Request a new one.' });
        }

        const isValid = await verifyPassword(otpCode, user.otp_hash);
        if (!isValid) {
            return res.status(400).json({ message: 'Invalid reset code' });
        }

        const hashedPassword = await hashPassword(password);

        await pool.query(
            `
            UPDATE users
            SET password_hash = $1,
                otp_hash = NULL,
                otp_expires_at = NULL,
                updated_at = NOW()
            WHERE id = $2
            `,
            [hashedPassword, user.id]
        );

        const sessionUser = {
            id: user.id,
            email: user.email,
            auth_provider: user.auth_provider,
        };

        const token = createAccessToken(sessionUser);
        setAuthCookie(res, token);

        return res.status(200).json({
            message: 'Password reset successfully',
            redirect: '/home',
            user: sessionUser,
            token,
        });
    } catch (error) {
        console.error('ResetPassword error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = { ForgotPassword, ResetPassword };
