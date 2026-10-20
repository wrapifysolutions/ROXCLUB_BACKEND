require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const Onboardingrouter = require('./routes/OnboardingRoute');
const StravaRouter = require('./routes/StravaRoute');
const ZeppRouter = require('./routes/ZeppRoute');
const AppleHealthRouter = require('./routes/AppleHealthRoute');
const session = require('express-session');
const { connectDB, closeDB } = require('./lib/db');
const { ensureStravaTables } = require('./lib/strava/stravaTokens');
const { ensureZeppTables } = require('./lib/zepp/zeppTokens');
const { ensureAppleHealthTables } = require('./lib/appleHealth/appleHealthStore');

const app = express();
app.use(express.json());
app.use(session({
    name: 'roxclub.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 5 * 60 * 1000, // 5 minutes
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));
app.use(cookieParser());
app.use('/', Onboardingrouter);
app.use('/', StravaRouter);
app.use('/', ZeppRouter);
app.use('/', AppleHealthRouter);
const port = Number(process.env.PORT) || 5000;

async function startServer() {
    try {
        await connectDB();
        console.log('Connected to the database');
        await ensureStravaTables();
        await ensureZeppTables();
        await ensureAppleHealthTables();
        console.log('Integration tables ready (Strava + Zepp + Apple Health)');

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

startServer();
