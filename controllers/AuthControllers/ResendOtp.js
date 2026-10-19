require('dotenv').config();
const transporter = require('../../lib/nodemailer');
const pool = require('../../lib/pool');
const { hashPassword } = require('../../data/encryption');

const ResendOtp = async (req, res) => {
    try {
        const emailFromBody = req.body?.email;
        const email = String(emailFromBody || req.session?.email || '')
            .trim()
            .toLowerCase();

        if (!email) {
            return res.status(400).json({ message: 'Email not found. Signup again.' });
        }

        // Session window is only for "can still resend" (set at signup). OTP itself is always 1 minute in DB.
        if (req.session?.emailExpireAt && Date.now() >= req.session.emailExpireAt) {
            return res.status(400).json({ message: 'Signup session expired. Signup again.' });
        }

        const { rows } = await pool.query(
            `
            SELECT id, is_email_verified
            FROM users
            WHERE email = $1
            `,
            [email]
        );

        const user = rows[0];

        if (!user) {
            return res.status(404).json({ message: 'User not found. Signup again.' });
        }

        if (user.is_email_verified) {
            return res.status(400).json({ message: 'Email is already verified' });
        }

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const hashedOTP = await hashPassword(otp);

        const result = await transporter.sendMail({
            from: '"ROXCLUB" <wrapifysolutions@gmail.com>',
            to: email,
            subject: 'Verify Your Email | ROXCLUB',
            text: `
Your email verification code is: ${otp}

This code will expire in 1 minute.
            `,
        });

        if (!result.accepted || result.accepted.length === 0) {
            return res.status(400).json({ message: 'Failed to send email' });
        }

        // Fresh OTP + fresh 1-minute expiry in DB (this is what VerifyEmailOTP checks).
        await pool.query(
            `
            UPDATE users
            SET otp_hash = $1,
                otp_expires_at = NOW() + INTERVAL '1 minute',
                updated_at = NOW()
            WHERE email = $2
              AND is_email_verified = FALSE
            `,
            [hashedOTP, email]
        );

        if (req.session) {
            req.session.email = email;
            req.session.emailExpireAt = Date.now() + 5 * 60 * 1000;
        }

        return res.status(200).json({ message: 'OTP resent successfully' });
    } catch (error) {
        console.error('ResendOtp error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = ResendOtp;
