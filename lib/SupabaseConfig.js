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

async function getSupabaseUser(accessToken, timeoutMs = 8000) {
    if (!accessToken) {
        return { data: { user: null }, error: new Error('Missing access token') };
    }

    const result = await Promise.race([
        SupabaseConfig.auth.getUser(accessToken),
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Supabase getUser timed out')), timeoutMs);
        }),
    ]);

    return result;
}

module.exports = SupabaseConfig;
module.exports.getSupabaseUser = getSupabaseUser;
