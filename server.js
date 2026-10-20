require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const Onboardingrouter = require('./routes/OnboardingRoute');
const StravaRouter = require('./routes/StravaRoute');
const ZeppRouter = require('./routes/ZeppRoute');
const AppleHealthRouter = require('./routes/AppleHealthRoute');
const { connectDB, closeDB } = require('./lib/db');

const app = express();
const isVercel = Boolean(process.env.VERCEL);
const isProduction = process.env.NODE_ENV === 'production' || isVercel;

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Mobile / Expo web clients need CORS; OPTIONS must never hang.
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, X-Requested-With, x-vercel-protection-bypass'
    );
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    return next();
});

if (!isVercel) {
    const session = require('express-session');
    app.use(
        session({
            name: 'roxclub.sid',
            secret: process.env.SESSION_SECRET || 'dev-session-secret',
            resave: false,
            saveUninitialized: false,
            cookie: {
                maxAge: 5 * 60 * 1000,
                httpOnly: true,
                secure: isProduction,
                sameSite: 'lax',
            },
        })
    );
}

app.get('/', (req, res) => {
    res.status(200).json({
        ok: true,
        service: 'roxclub-api',
        env: isVercel ? 'vercel' : 'local',
    });
});

app.get('/health', async (req, res) => {
    const startedAt = Date.now();
    const result = {
        ok: true,
        service: 'roxclub-api',
        env: isVercel ? 'vercel' : 'local',
        db: null,
        supabase: null,
        ms: 0,
    };

    try {
        const pool = require('./lib/pool');
        const dbStarted = Date.now();
        await Promise.race([
            pool.query('SELECT 1 AS ok'),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('db timeout')), 5000)
            ),
        ]);
        result.db = { ok: true, ms: Date.now() - dbStarted };
    } catch (error) {
        result.ok = false;
        result.db = { ok: false, error: error.message };
    }

    try {
        const { supabaseUrl } = require('./lib/SupabaseConfig');
        const sbStarted = Date.now();
        const response = await Promise.race([
            fetch(`${supabaseUrl}/auth/v1/health`),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('supabase timeout')), 5000)
            ),
        ]);
        result.supabase = {
            ok: response.ok || response.status < 500,
            status: response.status,
            ms: Date.now() - sbStarted,
        };
        if (!result.supabase.ok) result.ok = false;
    } catch (error) {
        result.ok = false;
        result.supabase = { ok: false, error: error.message };
    }

    result.ms = Date.now() - startedAt;
    return res.status(result.ok ? 200 : 503).json(result);
});

// Request tracer — proves the function accepted the call.
app.use((req, res, next) => {
    const startedAt = Date.now();
    console.log('req:in', req.method, req.path);
    res.on('finish', () => {
        console.log('req:out', req.method, req.path, res.statusCode, `${Date.now() - startedAt}ms`);
    });
    next();
});

app.use('/', Onboardingrouter);
app.use('/', StravaRouter);
app.use('/', ZeppRouter);
app.use('/', AppleHealthRouter);

const port = Number(process.env.PORT) || 5000;

async function startServer() {
    try {
        await connectDB();
        console.log('Connected to the database');

        const server = app.listen(port, () => {
            console.log(`Server is running on port ${port}`);
        });

        server.on('error', (error) => {
            console.error('Server failed to start', error);
            process.exit(1);
        });

        let shuttingDown = false;
        const shutdown = (signal) => {
            if (shuttingDown) return;
            shuttingDown = true;
            server.close(() => {
                closeDB()
                    .catch(() => {})
                    .finally(() => process.exit(0));
            });
            setTimeout(() => process.exit(1), 10000).unref();
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    } catch (error) {
        console.error('Error connecting to the database', error);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

module.exports = app;
