require('dotenv').config();

const zeppConfig = {
    // From console.zepp.com — Mini Program / watch app id (not enough for OAuth alone)
    consoleAppId: process.env.ZEPP_CONSOLE_APP_ID,

    // Xiaomi OAuth (step 1) — required for Zepp/Huami To-C partner flow
    xiaomiClientId: process.env.ZEPP_XIAOMI_CLIENT_ID,
    xiaomiClientSecret: process.env.ZEPP_XIAOMI_CLIENT_SECRET,
    redirectUri: process.env.ZEPP_REDIRECT_URI,

    // Huami/Zepp partner credentials (given when you register as third party)
    huamiThirdName: process.env.ZEPP_HUAMI_THIRD_NAME,
    huamiAppName: process.env.ZEPP_HUAMI_APP_NAME,
    huamiAppId: process.env.ZEPP_HUAMI_APP_ID,
    huamiAppSecret: process.env.ZEPP_HUAMI_APP_SECRET,

    xiaomiAuthorizeUrl: 'https://account.xiaomi.com/oauth2/authorize',
    xiaomiTokenUrl: 'https://account.xiaomi.com/oauth2/token',
    huamiLoginByRequestTokenUrl:
        process.env.ZEPP_HUAMI_LOGIN_URL ||
        'https://account.amazfit.com/v1/service/login_by_request_token',
    huamiExchangeUrl:
        process.env.ZEPP_HUAMI_EXCHANGE_URL ||
        'https://auth.huami.com/oauth2/exchange_access_token_by_xiaomi_token',
    huamiRefreshUrl:
        process.env.ZEPP_HUAMI_REFRESH_URL ||
        'https://account.amazfit.com/v1/service/login_by_login_token',

    // Optional Xiaomi scopes (space-separated). Leave empty if partner app uses defaults.
    scope: process.env.ZEPP_XIAOMI_SCOPE || '',

    stateTtlMinutes: 10,

    frontendSuccessUrl:
        process.env.ZEPP_FRONTEND_SUCCESS_URL ||
        'https://roxclub-backend.vercel.app/integrations/zepp?status=connected',
    frontendErrorUrl:
        process.env.ZEPP_FRONTEND_ERROR_URL ||
        'https://roxclub-backend.vercel.app/integrations/zepp?status=error',

    webhookActivityUrl:
        process.env.ZEPP_WEBHOOK_ACTIVITY_URL ||
        'https://roxclub-backend.vercel.app/api/integrations/zepp/activity/webhook',
    webhookHrvUrl:
        process.env.ZEPP_WEBHOOK_HRV_URL ||
        'https://roxclub-backend.vercel.app/api/integrations/zepp/hrv/webhook',
    webhookSleepUrl:
        process.env.ZEPP_WEBHOOK_SLEEP_URL ||
        'https://roxclub-backend.vercel.app/api/integrations/zepp/sleep/webhook',
};

function getZeppAvailability() {
    const missing = [];

    if (!zeppConfig.xiaomiClientId) missing.push('ZEPP_XIAOMI_CLIENT_ID');
    if (!zeppConfig.xiaomiClientSecret) missing.push('ZEPP_XIAOMI_CLIENT_SECRET');
    if (!zeppConfig.redirectUri) missing.push('ZEPP_REDIRECT_URI');
    if (!process.env.TOKEN_ENCRYPTION_KEY) missing.push('TOKEN_ENCRYPTION_KEY');

    const hasLegacyPartner =
        Boolean(zeppConfig.huamiThirdName) && Boolean(zeppConfig.huamiAppName);
    const hasModernPartner =
        Boolean(zeppConfig.huamiAppId) && Boolean(zeppConfig.huamiAppSecret);

    if (!hasLegacyPartner && !hasModernPartner) {
        missing.push(
            'ZEPP_HUAMI_THIRD_NAME+ZEPP_HUAMI_APP_NAME (or ZEPP_HUAMI_APP_ID+ZEPP_HUAMI_APP_SECRET)'
        );
    }

    const ready = missing.length === 0;
    return {
        ready,
        missing,
        hasConsoleApp: Boolean(zeppConfig.consoleAppId),
        hint: ready
            ? null
            : 'Direct Amazfit/Zepp login needs Huami partner keys. If the watch already syncs to Strava, connect Strava instead.',
    };
}

function assertZeppConfig() {
    const availability = getZeppAvailability();
    if (!availability.ready) {
        throw new Error(`Missing Zepp env: ${availability.missing.join(', ')}`);
    }
}

module.exports = { zeppConfig, assertZeppConfig, getZeppAvailability };
