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

// Session only for local email OTP resend helpers. Skip on Vercel to avoid MemoryStore hangs/noise.
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

let bootPromise = null;

async function ensureBootstrapped() {
    if (!bootPromise) {
        // Keep cold-start light: only prove DB connectivity.
        // Feature tables are created lazily inside their controllers.
        bootPromise = connectDB().catch((error) => {
            bootPromise = null;
            throw error;
        });
    }
    return bootPromise;
}

app.get('/', (req, res) => {
    res.status(200).json({
        ok: true,
        service: 'roxclub-api',
        env: isVercel ? 'vercel' : 'local',
    });
});

app.use(async (req, res, next) => {
    if (req.path === '/') {
        return next();
    }
    try {
        await ensureBootstrapped();
        return next();
    } catch (error) {
        console.error('Bootstrap failed', error);
        return res.status(503).json({
            message: 'Service unavailable',
            detail: error.message,
        });
    }
});

app.use('/', Onboardingrouter);
app.use('/', StravaRouter);
app.use('/', ZeppRouter);
app.use('/', AppleHealthRouter);

const port = Number(process.env.PORT) || 5000;

async function startServer() {
    try {
        await ensureBootstrapped();
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
            if (shuttingDown) {
                return;
            }
            shuttingDown = true;
            console.log(`${signal} received, closing server`);
            server.close(() => {
                closeDB()
                    .catch((error) => {
                        console.error('Error closing the database pool', error);
                    })
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
