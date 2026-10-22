const pool = require('../../lib/pool');
const { verifyPassword } = require('../../data/encryption');
const { createAccessToken, setAuthCookie } = require('../../lib/token');

const CustomEmailLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        const { rows } = await pool.query(
            `
            SELECT id, email, password_hash, auth_provider, is_email_verified
            FROM users
            WHERE email = $1
            `,
            [normalizedEmail]
        );

        const user = rows[0];

        if (!user || !user.password_hash) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        if (!user.is_email_verified) {
            return res.status(403).json({ message: 'Please verify your email first' });
        }

        const isMatch = await verifyPassword(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const token = createAccessToken(user);
        setAuthCookie(res, token);

        return res.status(200).json({
            message: 'Login successful',
            redirect: '/home',
            user: {
                id: user.id,
                email: user.email,
                auth_provider: user.auth_provider,
            },
        });
    } catch (error) {
        console.error('CustomEmailLogin error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = CustomEmailLogin;
