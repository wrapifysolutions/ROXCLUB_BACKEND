const pool = require('../../lib/pool');
const { ensureStravaTables } = require('../../lib/strava/stravaTokens');
const { ensureZeppTables } = require('../../lib/zepp/zeppTokens');
const { ensureAppleHealthTables } = require('../../lib/appleHealth/appleHealthStore');

/**
 * For onboarding screen "Connect your data" (Strava / Zepp / Apple Health).
 */
const getAllIntegrationsStatus = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        await ensureStravaTables();
        await ensureZeppTables();
        await ensureAppleHealthTables();

        const { rows } = await pool.query(
            `
            SELECT provider, status, provider_user_id, connected_at, last_synced_at, last_error
            FROM user_integrations
            WHERE user_id = $1
              AND provider IN ('strava', 'zepp', 'apple_health')
            `,
            [userId]
        );

        const byProvider = Object.fromEntries(rows.map((row) => [row.provider, row]));

        const build = (provider, label, description) => {
            const row = byProvider[provider];
            const connected = row?.status === 'connected';
            return {
                provider,
                label,
                description,
                connected,
                status: row?.status || 'disconnected',
                button: connected ? 'Connected' : 'Connect',
                connectedAt: row?.connected_at || null,
                lastSyncedAt: row?.last_synced_at || null,
                lastError: row?.last_error || null,
            };
        };

        return res.status(200).json({
            success: true,
            integrations: [
                build(
                    'zepp',
                    'Amazfit/Zepp',
                    'Syncs runs, workouts, HR, sleep and recovery data.'
                ),
                build(
                    'strava',
                    'Strava',
                    'Sync workouts and get route & segment data.'
                ),
                build(
                    'apple_health',
                    'Apple Health',
                    'Core health data: HRV, sleep, resting HR and steps.'
                ),
            ],
        });
    } catch (error) {
        console.error('Integrations status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch integrations status',
        });
    }
};

module.exports = { getAllIntegrationsStatus };
