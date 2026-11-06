const FALLBACK_PUBLIC_BASE_URL = 'https://roxclubbackend-production.up.railway.app';

function publicBaseUrl(env = process.env) {
    const fromEnv = String(env.PUBLIC_BASE_URL || '').trim();
    if (fromEnv) return fromEnv.replace(/\/$/, '');

    const railwayDomain = String(env.RAILWAY_PUBLIC_DOMAIN || env.RAILWAY_STATIC_URL || '')
        .trim()
        .replace(/^https?:\/\//, '');
    if (railwayDomain) return `https://${railwayDomain.replace(/\/$/, '')}`;

    return FALLBACK_PUBLIC_BASE_URL;
}

module.exports = { publicBaseUrl, FALLBACK_PUBLIC_BASE_URL };
