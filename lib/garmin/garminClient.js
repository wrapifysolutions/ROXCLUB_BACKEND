const crypto = require('node:crypto');
const { garminConfig } = require('./garminConfig');

function generatePkce() {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return { codeVerifier, codeChallenge };
}

function expiresAtFrom(payload) {
    const seconds = Number(payload.expires_in);
    const ttl = Number.isFinite(seconds) && seconds > 0 ? seconds : 24 * 60 * 60;
    return Math.floor(Date.now() / 1000) + ttl;
}

async function postToken(body) {
    const response = await fetch(garminConfig.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
        const error = new Error(payload.error_description || payload.error || 'Garmin token exchange failed');
        error.status = 502;
        error.code = 'GARMIN_TOKEN_FAILED';
        throw error;
    }
    return {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_at: expiresAtFrom(payload),
        token_type: payload.token_type || 'Bearer',
    };
}

async function exchangeAuthorizationCode({ code, codeVerifier, redirectUri }) {
    return postToken({
        grant_type: 'authorization_code',
        client_id: garminConfig.clientId,
        client_secret: garminConfig.clientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri || garminConfig.redirectUri,
    });
}

async function refreshAccessToken(refreshToken) {
    return postToken({
        grant_type: 'refresh_token',
        client_id: garminConfig.clientId,
        client_secret: garminConfig.clientSecret,
        refresh_token: refreshToken,
    });
}

async function garminGet(path, accessToken) {
    const response = await fetch(`${garminConfig.apiBaseUrl}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.errorMessage || payload.message || 'Garmin API request failed');
        error.status = response.status;
        throw error;
    }
    return payload;
}

async function fetchGarminUserId(accessToken) {
    const payload = await garminGet('/wellness-api/rest/user/id', accessToken);
    return payload.userId || payload.userID || payload.id || null;
}

async function deregisterGarminUser(accessToken) {
    const response = await fetch(`${garminConfig.apiBaseUrl}/wellness-api/rest/user/registration`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(payload.errorMessage || payload.message || 'Garmin deregister failed');
        error.status = response.status;
        throw error;
    }
}

module.exports = {
    generatePkce,
    exchangeAuthorizationCode,
    refreshAccessToken,
    fetchGarminUserId,
    deregisterGarminUser,
};
