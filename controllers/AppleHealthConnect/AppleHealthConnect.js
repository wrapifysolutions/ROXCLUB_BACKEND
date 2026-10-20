const {
    ensureAppleHealthTables,
    connectAppleHealth,
    getAppleHealthIntegration,
    disconnectAppleHealth,
    upsertAppleHealthSamples,
} = require('../../lib/appleHealth/appleHealthStore');

const ALLOWED_TYPES = new Set(['hrv', 'sleep', 'resting_hr', 'steps', 'workout']);

/**
 * Apple Health has no web OAuth.
 * iOS app requests HealthKit permission, then calls this endpoint.
 */
const connectAppleHealthAccount = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const {
            authorized = true,
            deviceId,
            permissions = ['hrv', 'sleep', 'resting_hr', 'steps'],
        } = req.body || {};

        if (!authorized) {
            return res.status(400).json({
                success: false,
                message: 'HealthKit permission was not granted on the device',
            });
        }

        await ensureAppleHealthTables();
        const integration = await connectAppleHealth(userId, { deviceId, permissions });

        return res.status(200).json({
            success: true,
            connected: true,
            status: 'connected',
            provider: 'apple_health',
            data: integration,
            message: 'Apple Health connected. Sync samples from the iOS app next.',
        });
    } catch (error) {
        console.error('Apple Health connect error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to connect Apple Health',
        });
    }
};

const getAppleHealthStatus = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const integration = await getAppleHealthIntegration(userId);

        if (!integration) {
            return res.status(200).json({
                success: true,
                connected: false,
                status: 'disconnected',
                provider: 'apple_health',
            });
        }

        return res.status(200).json({
            success: true,
            connected: integration.status === 'connected',
            status: integration.status,
            provider: 'apple_health',
            providerUserId: integration.provider_user_id,
            connectedAt: integration.connected_at,
            lastSyncedAt: integration.last_synced_at,
            lastSyncStatus: integration.last_sync_status,
            lastError: integration.last_error,
        });
    } catch (error) {
        console.error('Apple Health status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch Apple Health status',
        });
    }
};

const syncAppleHealthSamples = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const integration = await getAppleHealthIntegration(userId);
        if (!integration || integration.status !== 'connected') {
            return res.status(400).json({
                success: false,
                message: 'Connect Apple Health before syncing samples',
            });
        }

        const samples = Array.isArray(req.body?.samples) ? req.body.samples : [];
        if (samples.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'samples array is required',
            });
        }

        const invalid = samples.find((sample) => {
            const type = String(sample.sample_type || sample.type || '')
                .trim()
                .toLowerCase();
            return !ALLOWED_TYPES.has(type);
        });

        if (invalid) {
            return res.status(400).json({
                success: false,
                message:
                    'Each sample needs sample_type: hrv | sleep | resting_hr | steps | workout',
            });
        }

        const saved = await upsertAppleHealthSamples(userId, samples);

        return res.status(200).json({
            success: true,
            saved,
            message: 'Apple Health samples synced',
        });
    } catch (error) {
        console.error('Apple Health sync error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to sync Apple Health samples',
        });
    }
};

const disconnectAppleHealthAccount = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        await disconnectAppleHealth(userId);

        return res.status(200).json({
            success: true,
            message: 'Apple Health disconnected',
        });
    } catch (error) {
        console.error('Apple Health disconnect error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to disconnect Apple Health',
        });
    }
};

module.exports = {
    connectAppleHealthAccount,
    getAppleHealthStatus,
    syncAppleHealthSamples,
    disconnectAppleHealthAccount,
};
