function createSessionMiddleware({ isProduction } = {}) {
    const session = require('express-session');
    const options = {
        name: 'roxclub.sid',
        secret: process.env.SESSION_SECRET || 'dev-session-secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 5 * 60 * 1000,
            httpOnly: true,
            secure: Boolean(isProduction),
            sameSite: 'lax',
        },
    };

    const redisUrl = String(process.env.REDIS_URL || '').trim();
    const inTests =
        process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
    if (redisUrl && !inTests) {
        try {
            const Redis = require('ioredis');
            const { RedisStore } = require('connect-redis');
            const client = new Redis(redisUrl, {
                maxRetriesPerRequest: 1,
                enableReadyCheck: true,
                lazyConnect: true,
                connectTimeout: 1500,
                commandTimeout: 800,
            });
            client.on('error', (error) => {
                console.warn('session redis:', error.message);
            });
            client.connect().catch((error) => {
                console.warn('session redis connect skipped', error.message);
            });
            options.store = new RedisStore({ client, prefix: 'sess:' });
        } catch (error) {
            console.warn('session store using memory', error.message);
        }
    }

    return session(options);
}

module.exports = { createSessionMiddleware };
