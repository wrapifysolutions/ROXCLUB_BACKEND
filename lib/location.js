function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = typeof forwarded === 'string' && forwarded.length > 0
        ? forwarded.split(',')[0].trim()
        : req.ip || req.socket?.remoteAddress || '';

    return String(raw).replace(/^::ffff:/, '');
}

function isPublicIp(ip) {
    if (!ip || ip === '::1' || ip === '127.0.0.1') return false;
    if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) {
        return false;
    }
    const parts = ip.split('.').map(Number);
    if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
        return false;
    }
    return true;
}

function parseCoord(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

async function fetchJson(url, timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        return await response.json();
    } catch (_) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function reverseGeocode(latitude, longitude) {
    const data = await fetchJson(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
    );
    if (!data) return {};
    return {
        city: data.city || data.locality || null,
        region: data.principalSubdivision || null,
        country: data.countryName || null,
    };
}

async function geocodeIp(ip) {
    const data = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (!data?.success) return null;
    return {
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        city: data.city || null,
        region: data.region || null,
        country: data.country || null,
        source: 'ip',
    };
}

/**
 * When location is allowed:
 * - prefer device GPS (latitude/longitude from the app)
 * - otherwise approximate from the request IP
 */
async function resolveUserLocation(req, body, locationEnabled) {
    const empty = {
        latitude: null,
        longitude: null,
        city: null,
        region: null,
        country: null,
        source: null,
    };

    if (!locationEnabled) return empty;

    const latitude = parseCoord(body.latitude ?? body.lat);
    const longitude = parseCoord(body.longitude ?? body.lng ?? body.lon);

    const gpsValid =
        latitude != null &&
        longitude != null &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180;

    if (gpsValid) {
        const place = await reverseGeocode(latitude, longitude);
        return {
            latitude,
            longitude,
            city: place.city || null,
            region: place.region || null,
            country: place.country || null,
            source: 'gps',
        };
    }

    const ip = clientIp(req);
    if (!isPublicIp(ip)) return empty;

    const fromIp = await geocodeIp(ip);
    return fromIp || empty;
}

module.exports = { resolveUserLocation };
