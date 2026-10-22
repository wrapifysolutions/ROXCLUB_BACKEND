const { starvaConfig } = require('../starvaConfig/staravaConfig');

async function parseStravaJson(response, fallbackMessage) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message =
            data?.message ||
            data?.errors?.[0]?.field ||
            data?.error ||
            fallbackMessage;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }
    return data;
}

async function stravaGet(path, accessToken, searchParams = {}) {
    const url = new URL(`${starvaConfig.apiBaseUrl}${path}`);
    Object.entries(searchParams).forEach(([key, value]) => {
        if (value != null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });

    const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    return parseStravaJson(response, `Strava ${path} failed`);
}

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

async function getAthlete(accessToken) {
    return stravaGet('/athlete', accessToken);
}

async function listAthleteActivities(accessToken, { after, before, page = 1, perPage = 100 } = {}) {
    return stravaGet('/athlete/activities', accessToken, {
        after,
        before,
        page,
        per_page: perPage,
    });
}

module.exports = {
    exchangeAuthorizationCode,
    refreshAccessToken,
    deauthorize,
    getAthlete,
    listAthleteActivities,
};
