require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const Onboardingrouter = require('./routes/OnboardingRoute');

const { connectDB, closeDB } = require('./lib/db');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/', Onboardingrouter);
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
