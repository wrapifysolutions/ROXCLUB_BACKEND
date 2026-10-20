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

/**
 * Validate access token via Supabase Auth REST API with a hard Abort timeout.
 * Avoids supabase-js getUser() hangs observed on Vercel.
 */
async function getSupabaseUser(accessToken, timeoutMs = 6000) {
    if (!accessToken) {
        return { data: { user: null }, error: new Error('Missing access token') };
    }
    if (!supabaseUrl || !supabaseKey) {
        return { data: { user: null }, error: new Error('Supabase env missing') };
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
                error: new Error(body?.msg || body?.message || `Supabase user HTTP ${response.status}`),
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
