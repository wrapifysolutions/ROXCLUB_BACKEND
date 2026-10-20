const { starvaConfig } = require('../starvaConfig/staravaConfig');

async function exchangeAuthorizationCode(code) {
    const body = new URLSearchParams({
        client_id: String(starvaConfig.clientId),
        client_secret: String(starvaConfig.clientSecret),
        code: String(code),
        grant_type: 'authorization_code',
    });

    const response = await fetch(starvaConfig.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    const data = await response.json();
    if (!response.ok) {
        const message = data?.message || data?.error || 'Strava token exchange failed';
        throw new Error(message);
    }

    return data;
}

async function refreshAccessToken(refreshToken) {
    const body = new URLSearchParams({
        client_id: String(starvaConfig.clientId),
        client_secret: String(starvaConfig.clientSecret),
        grant_type: 'refresh_token',
        refresh_token: String(refreshToken),
    });

    const response = await fetch(starvaConfig.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    const data = await response.json();
    if (!response.ok) {
        const message = data?.message || data?.error || 'Strava token refresh failed';
        throw new Error(message);
    }

    return data;
}

async function deauthorize(accessToken) {
    const body = new URLSearchParams({
        access_token: String(accessToken),
    });

    const response = await fetch(starvaConfig.deauthorizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = data?.message || data?.error || 'Strava deauthorize failed';
        throw new Error(message);
    }
}

module.exports = {
    exchangeAuthorizationCode,
    refreshAccessToken,
    deauthorize,
};
