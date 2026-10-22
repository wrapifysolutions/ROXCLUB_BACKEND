const pool = require('../../lib/pool');
const { verifyPassword } = require('../../data/encryption');
const { createAccessToken, setAuthCookie } = require('../../lib/token');

const clearExpiredOTP = async (email) => {
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
};

const VerifyEmailOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ message: 'Email and OTP are required' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const otpCode = String(otp).trim();

        await clearExpiredOTP(normalizedEmail);

        const { rows } = await pool.query(
            `
            SELECT id, email, otp_hash, otp_expires_at, is_email_verified, auth_provider
            FROM users
            WHERE email = $1
            `,
            [normalizedEmail]
        );

        const user = rows[0];

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.is_email_verified) {
            const token = createAccessToken(user);
            setAuthCookie(res, token);
            return res.status(200).json({
                message: 'Email is already verified',
                redirect: '/home',
                user: { id: user.id, email: user.email },
            });
        }

        if (!user.otp_hash || !user.otp_expires_at) {
            return res.status(400).json({ message: 'OTP expired or not found. Request a new one.' });
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
            return res.status(400).json({ message: 'OTP expired. Request a new one.' });
        }

        const isValid = await verifyPassword(otpCode, user.otp_hash);
        if (!isValid) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        await pool.query(
            `
            UPDATE users
            SET is_email_verified = TRUE,
                otp_hash = NULL,
                otp_expires_at = NULL,
                updated_at = NOW()
            WHERE id = $1
            `,
            [user.id]
        );

        const verifiedUser = {
            id: user.id,
            email: user.email,
            auth_provider: user.auth_provider || 'email',
        };

        const token = createAccessToken(verifiedUser);
        setAuthCookie(res, token);

        return res.status(200).json({
            message: 'Email verified successfully',
            redirect: '/home',
            user: {
                id: verifiedUser.id,
                email: verifiedUser.email,
            },
        });
    } catch (error) {
        console.error('VerifyEmailOTP error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = VerifyEmailOTP;
