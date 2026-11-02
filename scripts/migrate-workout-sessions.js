require('dotenv').config();

const { spawnSync } = require('node:child_process');

async function main() {
    const result = spawnSync(process.execPath, [require.resolve('./migrate.js')], {
        stdio: 'inherit',
        env: process.env,
    });
    process.exit(result.status || 0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
