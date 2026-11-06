const instances = Number(process.env.WEB_CONCURRENCY) > 0
    ? Number(process.env.WEB_CONCURRENCY)
    : 2;

module.exports = {
    apps: [
        {
            name: 'roxclub-api',
            script: 'server.js',
            instances,
            exec_mode: 'cluster',
            listen_timeout: 10000,
            kill_timeout: 10000,
            max_memory_restart: '450M',
            env: {
                NODE_ENV: 'production',
            },
        },
    ],
};
