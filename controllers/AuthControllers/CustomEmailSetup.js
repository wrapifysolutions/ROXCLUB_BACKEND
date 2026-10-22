require('dotenv').config();
const transporter = require('../../lib/nodemailer');
const { hashPassword } = require('../../data/encryption');
const pool = require('../../lib/pool');
const { queryWithHardTimeout } = require('../../lib/dbQuery');
const createUsersTable = require('../../models/Onboarding/UserOnboardingData');
const { applyConsentByEmail } = require('../../lib/onboarding/completeOnboarding');

let usersTableReady = false;

async function ensureUsersTable() {
    if (usersTableReady) return;
    await queryWithHardTimeout(createUsersTable, [], 8000);
    usersTableReady = true;
}

function setSignupSession(req, email) {
    // express-session is disabled on Vercel — mobile uses email in body for verify/resend.
    if (!req.session) {
        return;
    }
    req.session.email = email;
    req.session.emailExpireAt = Date.now() + 5 * 60 * 1000;
}

const CustomEmailSetup = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        await ensureUsersTable();

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

        // Persist OTP first (Vercel has no session — DB is source of truth for verify/resend).
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

        await applyConsentByEmail(normalizedEmail, req.body || {});

        setSignupSession(req, normalizedEmail);

        return res.status(200).json({ message: 'Email sent successfully' });
    } catch (error) {
        console.error('CustomEmailSetup error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = CustomEmailSetup;
