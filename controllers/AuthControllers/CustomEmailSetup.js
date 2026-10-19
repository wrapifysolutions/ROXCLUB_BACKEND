require('dotenv').config();
const transporter = require('../../lib/nodemailer');
const { hashPassword } = require('../../data/encryption');
const pool = require('../../lib/pool');

const CustomEmailSetup = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        const existing = await pool.query(
            'SELECT id, is_email_verified FROM users WHERE email = $1',
            [normalizedEmail]
        );

        if (existing.rows[0]?.is_email_verified) {
            return res.status(409).json({ message: 'Email is already registered' });
        }

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const hashedPassword = await hashPassword(password);
        const hashedOTP = await hashPassword(otp);

        const result = await transporter.sendMail({
            from: '"ROXCLUB" <wrapifysolutions@gmail.com>',
            to: normalizedEmail,
            subject: 'Verify Your Email | ROXCLUB',
            text: `
Welcome to ROXCLUB!

Thank you for joining ROXCLUB.

Your email verification code is: ${otp}

This code will expire in 1 minute.

If you did not create a ROXCLUB account, please ignore this email.

Best regards,
The ROXCLUB Team
Powered by Wrapify Solutions
            `,
        });

        if (!result.accepted || result.accepted.length === 0) {
            return res.status(400).json({ message: 'Failed to send email' });
        }

        req.session.email = normalizedEmail;
        req.session.emailExpireAt = Date.now() + 5* 60 * 1000;

        // OTP lives for 1 minute only. After otp_expires_at it is cleared and invalid.
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
                auth_provider = 'email',
                is_email_verified = FALSE,
                updated_at = NOW()
            WHERE users.is_email_verified = FALSE
            `,
            [normalizedEmail, hashedPassword, hashedOTP]
        );

        return res.status(200).json({ message: 'Email sent successfully' });
    } catch (error) {
        console.error('CustomEmailSetup error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = CustomEmailSetup;
