require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');


const SupabaseConfig = createClient(
     process.env.Project_Url,
    process.env.SupaBase_Publishable_Key,

    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
        }
    }
)



module.exports = SupabaseConfig;