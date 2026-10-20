require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.Project_Url || process.env.SUPABASE_URL;
const supabaseKey =
    process.env.SupaBase_Secret_Key ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SupaBase_Publishable_Key ||
    process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase URL/key missing — auth middleware will fail');
}

const SupabaseConfig = createClient(supabaseUrl || '', supabaseKey || '', {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
    },
});

let joseModulePromise = null;
let remoteJwks = null;

function loadJose() {
    if (!joseModulePromise) {
        // jose is ESM-only — dynamic import from CJS.
        joseModulePromise = import('jose');
    }
    return joseModulePromise;
}

async function getRemoteJwks() {
    if (!remoteJwks) {
        if (!supabaseUrl) {
            throw new Error('Supabase URL missing for JWKS');
        }
        const { createRemoteJWKSet } = await loadJose();
        remoteJwks = createRemoteJWKSet(
            new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
        );
    }
    return remoteJwks;
}

function raceTimeout(promise, timeoutMs, label) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
                timeoutMs
            );
        }),
    ]);
}

function userFromClaims(payload) {
    return {
        id: payload.sub,
        email: payload.email || payload.user_metadata?.email || null,
        role: payload.role,
        app_metadata: payload.app_metadata || {},
        user_metadata: payload.user_metadata || {},
        email_confirmed_at:
            payload.email_confirmed_at ||
            (payload.email ? new Date().toISOString() : null),
        phone: payload.phone || null,
        aud: payload.aud,
        is_anonymous: Boolean(payload.is_anonymous),
        amr: payload.amr,
    };
}

/**
 * Prefer local JWKS verify (ES256) — avoids hanging Auth /auth/v1/user round-trips.
 * Fall back to Auth REST only for legacy symmetric JWTs.
 */
async function getSupabaseUser(accessToken, timeoutMs = 5000) {
    if (!accessToken) {
        return { data: { user: null }, error: new Error('Missing access token') };
    }
    if (!supabaseUrl || !supabaseKey) {
        return { data: { user: null }, error: new Error('Supabase env missing') };
    }

    let header = null;
    let decoded = null;
    try {
        const jose = await loadJose();
        header = jose.decodeProtectedHeader(accessToken);
        decoded = jose.decodeJwt(accessToken);
    } catch (_) {
        // continue to REST fallback / error
    }

    const alg = String(header?.alg || '');
    const isAsymmetric = alg.startsWith('ES') || alg.startsWith('RS') || alg.startsWith('PS');

    if (isAsymmetric || decoded?.iss) {
        const { jwtVerify } = await loadJose();
        const jwks = await getRemoteJwks();
        const issuerCandidates = [
            decoded?.iss,
            `${supabaseUrl}/auth/v1`,
            supabaseUrl,
        ].filter(Boolean);

        let lastError = null;
        for (const issuer of [...new Set(issuerCandidates)]) {
            try {
                const { payload } = await raceTimeout(
                    jwtVerify(accessToken, jwks, {
                        issuer,
                        audience: 'authenticated',
                    }),
                    timeoutMs,
                    'JWKS verify'
                );

                if (!payload?.sub) {
                    return {
                        data: { user: null },
                        error: new Error('JWT missing sub'),
                    };
                }

                console.log('auth: jwks ok', {
                    sub: payload.sub,
                    email: payload.email,
                    alg,
                    issuer,
                });
                return { data: { user: userFromClaims(payload) }, error: null };
            } catch (error) {
                lastError = error;
                if (String(error.message || '').includes('timed out')) {
                    return {
                        data: { user: null },
                        error: new Error(error.message),
                    };
                }
            }
        }

        // Asymmetric tokens must verify via JWKS — do not hang on Auth REST.
        if (isAsymmetric) {
            return {
                data: { user: null },
                error: new Error(lastError?.message || 'JWKS verification failed'),
            };
        }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                apikey: supabaseKey,
            },
            signal: controller.signal,
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
            return {
                data: { user: null },
                error: new Error(
                    body?.msg || body?.message || `Supabase user HTTP ${response.status}`
                ),
            };
        }

        return { data: { user: body }, error: null };
    } catch (error) {
        const message =
            error?.name === 'AbortError'
                ? `Supabase getUser timed out after ${timeoutMs}ms`
                : error.message;
        return { data: { user: null }, error: new Error(message) };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = SupabaseConfig;
module.exports.getSupabaseUser = getSupabaseUser;
module.exports.supabaseUrl = supabaseUrl;
