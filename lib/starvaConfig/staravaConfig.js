require('dotenv').config();

const starvaConfig = {
    clientId: process.env.STRAVA_CLIENT_ID,
    clientSecret: process.env.STRAVA_CLIENT_SECRET,
    redirectUri: process.env.STRAVA_REDIRECT_URI,

    authorizationUrl: 'https://www.strava.com/oauth/authorize',
    tokenUrl: 'https://www.strava.com/oauth/token',
    apiBaseUrl: 'https://www.strava.com/api/v3',
    deauthorizeUrl: 'https://www.strava.com/oauth/deauthorize',

    scope: 'read,activity:read_all',
    stateTtlMinutes: 10,

    frontendSuccessUrl:
        process.env.STRAVA_FRONTEND_SUCCESS_URL ||
        'http://localhost:3000/integrations/strava?status=connected',
    frontendErrorUrl:
        process.env.STRAVA_FRONTEND_ERROR_URL ||
        'http://localhost:3000/integrations/strava?status=error',
};

function assertStravaConfig() {
    const missing = [];
    if (!starvaConfig.clientId) missing.push('STRAVA_CLIENT_ID');
    if (!starvaConfig.clientSecret) missing.push('STRAVA_CLIENT_SECRET');
    if (!starvaConfig.redirectUri) missing.push('STRAVA_REDIRECT_URI');
    if (!process.env.TOKEN_ENCRYPTION_KEY) missing.push('TOKEN_ENCRYPTION_KEY');

    if (missing.length > 0) {
        throw new Error(`Missing Strava env: ${missing.join(', ')}`);
    }
}

module.exports = { starvaConfig, assertStravaConfig };
