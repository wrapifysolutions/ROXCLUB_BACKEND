const { zeppConfig } = require('../zeppConfig/zeppConfig');

async function exchangeXiaomiCode(code) {
    const body = new URLSearchParams({
        client_id: String(zeppConfig.xiaomiClientId),
        client_secret: String(zeppConfig.xiaomiClientSecret),
        redirect_uri: String(zeppConfig.redirectUri),
        grant_type: 'authorization_code',
        code: String(code),
    });

    const response = await fetch(zeppConfig.xiaomiTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    const data = await response.json();
    if (!response.ok || data.error) {
        const message = data.error_description || data.error || 'Xiaomi token exchange failed';
        throw new Error(message);
    }

    return data;
}

async function exchangeHuamiByXiaomiCode(code, userIp) {
    const url = new URL(zeppConfig.huamiLoginByRequestTokenUrl);
    url.searchParams.set('third_name', zeppConfig.huamiThirdName);
    url.searchParams.set('request_token', String(code));
    url.searchParams.set('app_name', zeppConfig.huamiAppName);
    url.searchParams.set('user_ip', userIp || '127.0.0.1');

    const response = await fetch(url.toString(), { method: 'POST' });
    const data = await response.json();

    if (data.error_code || data.result !== 'ok') {
        throw new Error(
            `Huami login failed: ${data.error_code || data.message || 'unknown_error'}`
        );
    }

    const tokenInfo = data.token_info || {};
    const appTtlSeconds = Number(tokenInfo.app_ttl || tokenInfo.ttl || 3600);

    return {
        access_token: tokenInfo.app_token,
        refresh_token: tokenInfo.login_token,
        provider_user_id: tokenInfo.user_id ? String(tokenInfo.user_id) : null,
        expires_at: Math.floor(Date.now() / 1000) + appTtlSeconds,
        raw: data,
    };
}

async function exchangeHuamiByXiaomiAccessToken(xiaomiAccessToken) {
    const body = new URLSearchParams({
        xiaomiAccessToken: String(xiaomiAccessToken),
        xiaomiClientId: String(zeppConfig.xiaomiClientId),
        appId: String(zeppConfig.huamiAppId),
        appSecret: String(zeppConfig.huamiAppSecret),
    });

    const response = await fetch(zeppConfig.huamiExchangeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    const data = await response.json();
    if (!response.ok || data.error || data.error_code) {
        throw new Error(
            data.message || data.error || data.error_code || 'Huami token exchange failed'
        );
    }

    const accessToken =
        data.access_token || data.app_token || data.token_info?.app_token;
    const refreshToken =
        data.refresh_token || data.login_token || data.token_info?.login_token;
    const providerUserId =
        data.user_id || data.openId || data.token_info?.user_id || null;

    const expiresIn = Number(
        data.expires_in || data.app_ttl || data.token_info?.app_ttl || 3600
    );

    if (!accessToken) {
        throw new Error('Huami exchange response missing access token');
    }

    return {
        access_token: accessToken,
        refresh_token: refreshToken || accessToken,
        provider_user_id: providerUserId ? String(providerUserId) : null,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        raw: data,
    };
}

async function completeZeppTokenExchange(xiaomiCode, userIp) {
    // Official To-C partner flow: Xiaomi code → Huami login_by_request_token
    if (zeppConfig.huamiThirdName && zeppConfig.huamiAppName) {
        return exchangeHuamiByXiaomiCode(xiaomiCode, userIp);
    }

    // Modern REST partner flow: Xiaomi code → Xiaomi access_token → Huami exchange
    const xiaomiToken = await exchangeXiaomiCode(xiaomiCode);
    return exchangeHuamiByXiaomiAccessToken(xiaomiToken.access_token);
}

module.exports = {
    exchangeXiaomiCode,
    exchangeHuamiByXiaomiCode,
    exchangeHuamiByXiaomiAccessToken,
    completeZeppTokenExchange,
};
