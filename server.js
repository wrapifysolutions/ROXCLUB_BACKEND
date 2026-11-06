require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const Onboardingrouter = require('./routes/OnboardingRoute');
const StravaRouter = require('./routes/StravaRoute');
const ZeppRouter = require('./routes/ZeppRoute');
const AppleHealthRouter = require('./routes/AppleHealthRoute');
const SamsungHealthRouter = require('./routes/SamsungHealthRoute');
const GarminRouter = require('./routes/GarminRoute');
const WorkoutRouter = require('./routes/WorkoutRoute');
const ReadinessRouter = require('./routes/ReadinessRoute');
const WorkoutSessionRouter = require('./routes/WorkoutSessionRoute');
const PlanRouter = require('./routes/PlanRoute');
const ProgramsRouter = require('./routes/ProgramsRoute');
const AccountRouter = require('./routes/AccountRoute');
const ClubRouter = require('./routes/ClubRoute');
const ArenaRouter = require('./routes/ArenaRoute');
const AthleteRouter = require('./routes/AthleteRoute');
const ProfileRouter = require('./routes/ProfileRoute');
const NotificationRouter = require('./routes/NotificationRoute');
const { loadWorkoutCatalog } = require('./lib/workouts/workoutCatalog');
const { connectDB, closeDB } = require('./lib/db');
const cache = require('./lib/cache/redis');
const { invalidateOnWrite } = require('./lib/cache/httpCache');
const { globalRateLimit } = require('./lib/http/rateLimit');
const { createSessionMiddleware } = require('./lib/http/session');
const { isPrimaryWorker, workerId } = require('./lib/cluster');

loadWorkoutCatalog();

const app = express();
const isVercel = Boolean(process.env.VERCEL);
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN);
const runtimeEnv = isVercel ? 'vercel' : isRailway ? 'railway' : 'local';
const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.ROXCLUB_ENV === 'production' ||
    isVercel ||
    isRailway;

if (isRailway) {
    app.set('trust proxy', 1);
}

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
    app.use(createSessionMiddleware({ isProduction }));
}

app.get('/', (req, res) => {
    res.status(200).json({
        ok: true,
        service: 'roxclub-api',
        env: runtimeEnv,
        environment: process.env.ROXCLUB_ENV || 'unidentified',
        worker: workerId(),
        pid: process.pid,
    });
});

app.get('/health', async (req, res) => {
    const startedAt = Date.now();
    const result = {
        ok: true,
        service: 'roxclub-api',
        env: runtimeEnv,
        environment: process.env.ROXCLUB_ENV || 'unidentified',
        worker: workerId(),
        pid: process.pid,
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

    result.cache = await cache.ping();
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

app.use(globalRateLimit);
app.use(invalidateOnWrite);

app.use('/', Onboardingrouter);
app.use('/', StravaRouter);
app.use('/', ZeppRouter);
app.use('/', AppleHealthRouter);
app.use('/', SamsungHealthRouter);
app.use('/', GarminRouter);
app.use('/', WorkoutRouter);
app.use('/', ReadinessRouter);
app.use('/', WorkoutSessionRouter);
app.use('/', PlanRouter);
app.use('/', ProgramsRouter);
app.use('/', AccountRouter);
app.use('/', ClubRouter);
app.use('/', ArenaRouter);
app.use('/', AthleteRouter);
app.use('/', ProfileRouter);
app.use('/', NotificationRouter);

const port = Number(process.env.PORT) || 5000;

async function startServer() {
    try {
        await connectDB();
        console.log('Connected to the database');
        await cache.connect();
        console.log('Cache driver', cache.driver());
        const { schemaMutationsAllowed } = require('./lib/migrations/policy');
        await require('./lib/onboarding/schema').ensureOnboardingProfileSchema();
        if (schemaMutationsAllowed()) {
            console.log('Schema migrations ran because APPLY_SCHEMA_MIGRATIONS is enabled');
        } else {
            console.log('Schema mutations skipped on API startup; use scripts/migrate.js with explicit approval');
        }
        if (isPrimaryWorker()) {
            require('./lib/plan/missedJob').scheduleMissedJob();
        }

        const server = app.listen(port, '0.0.0.0', () => {
            console.log(`Server is running on port ${port} worker=${workerId()} pid=${process.pid}`);
        });
        server.keepAliveTimeout = 65000;
        server.headersTimeout = 66000;

        server.on('error', (error) => {
            console.error('Server failed to start', error);
            process.exit(1);
        });

        let shuttingDown = false;
        const shutdown = (signal) => {
            if (shuttingDown) return;
            shuttingDown = true;
            server.close(() => {
                Promise.all([closeDB(), cache.quit()])
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
