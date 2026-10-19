require('dotenv').config();
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'roxclub_token';
const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '7d';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET is not set');
    }
    return secret;
}

function createAccessToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            email: user.email,
            auth_provider: user.auth_provider || 'email',
        },
        getJwtSecret(),
        { expiresIn: TOKEN_TTL }
    );
}

function verifyAccessToken(token) {
    return jwt.verify(token, getJwtSecret());
}

function setAuthCookie(res, token) {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: MAX_AGE_MS,
        path: '/',
    });
}

function clearAuthCookie(res) {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    });
}

function readTokenFromRequest(req) {
    if (req.cookies?.[COOKIE_NAME]) {
        return req.cookies[COOKIE_NAME];
    }

    const authorization = req.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
        return authorization.slice(7);
    }

    return null;
}

module.exports = {
    COOKIE_NAME,
    createAccessToken,
    verifyAccessToken,
    setAuthCookie,
    clearAuthCookie,
    readTokenFromRequest,
};
