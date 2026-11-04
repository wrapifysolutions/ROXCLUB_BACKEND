require('dotenv').config();

const garminConfig = {
    clientId: process.env.GARMIN_CLIENT_ID,
    clientSecret: process.env.GARMIN_CLIENT_SECRET,
    redirectUri:
        process.env.GARMIN_REDIRECT_URI ||
        'https://roxclub-backend.vercel.app/api/integrations/garmin/callback',
    authorizationUrl: 'https://connect.garmin.com/oauth2Confirm',
    tokenUrl:
        process.env.GARMIN_TOKEN_URL ||
        'https://connectapi.garmin.com/di-oauth2-service/oauth/token',
    apiBaseUrl: process.env.GARMIN_API_BASE_URL || 'https://apis.garmin.com',
    stateTtlMinutes: 10,
    frontendSuccessUrl:
        process.env.GARMIN_FRONTEND_SUCCESS_URL ||
        'roxclub://integrations/garmin?status=connected&provider=garmin',
    frontendErrorUrl:
        process.env.GARMIN_FRONTEND_ERROR_URL ||
        'roxclub://integrations/garmin?status=error',
    webhookSecret: process.env.GARMIN_WEBHOOK_SECRET || '',
};

function getGarminAvailability(env = process.env) {
    const missing = [];
    if (!String(env.GARMIN_CLIENT_ID || '').trim()) missing.push('GARMIN_CLIENT_ID');
    if (!String(env.GARMIN_CLIENT_SECRET || '').trim()) missing.push('GARMIN_CLIENT_SECRET');
    if (!String(env.GARMIN_REDIRECT_URI || garminConfig.redirectUri || '').trim()) {
        missing.push('GARMIN_REDIRECT_URI');
    }
    if (!env.TOKEN_ENCRYPTION_KEY) missing.push('TOKEN_ENCRYPTION_KEY');
    const ready = missing.length === 0;
    return {
        ready,
        missing,
        hint: ready
            ? null
            : 'Garmin Connect needs approved developer keys. Apply at developerportal.garmin.com, then set GARMIN_CLIENT_ID and GARMIN_CLIENT_SECRET.',
    };
}

function assertGarminConfig() {
    const availability = getGarminAvailability();
    if (!availability.ready) {
        const error = new Error(`Missing Garmin env: ${availability.missing.join(', ')}`);
        error.code = 'GARMIN_NOT_CONFIGURED';
        error.status = 503;
        throw error;
    }
}

module.exports = { garminConfig, getGarminAvailability, assertGarminConfig };
