const {
    ensureSamsungHealthTables,
    connectSamsungHealth,
    getSamsungHealthIntegration,
    disconnectSamsungHealth,
    upsertSamsungHealthSamples,
    listSamsungHealthSamples,
    summarizeSamsungHealth,
} = require('../../lib/samsungHealth/samsungHealthStore');

const ALLOWED_TYPES = new Set(['hrv', 'sleep', 'resting_hr', 'steps', 'workout']);

const connectSamsungHealthAccount = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const {
            authorized = true,
            deviceId,
            permissions = ['hrv', 'sleep', 'resting_hr', 'steps', 'workout'],
        } = req.body || {};

        if (!authorized) {
            return res.status(400).json({
                success: false,
                message: 'Samsung Health permission was not granted on the device',
            });
        }

        await ensureSamsungHealthTables();
        const integration = await connectSamsungHealth(userId, { deviceId, permissions });

        return res.status(200).json({
            success: true,
            connected: true,
            status: 'connected',
            provider: 'samsung_health',
            data: integration,
            message: 'Samsung Health connected. Sync samples from the Android app next.',
        });
    } catch (error) {
        console.error('Samsung Health connect error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to connect Samsung Health',
        });
    }
};

const getSamsungHealthStatus = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const integration = await getSamsungHealthIntegration(userId);
        if (!integration) {
            return res.status(200).json({
                success: true,
                connected: false,
                status: 'disconnected',
                provider: 'samsung_health',
            });
        }

        const summary =
            integration.status === 'connected' ? await summarizeSamsungHealth(userId) : {};

        return res.status(200).json({
            success: true,
            connected: integration.status === 'connected',
            status: integration.status,
            provider: 'samsung_health',
            providerUserId: integration.provider_user_id,
            connectedAt: integration.connected_at,
            lastSyncedAt: integration.last_synced_at,
            lastSyncStatus: integration.last_sync_status,
            summary,
            lastError: integration.last_error,
        });
    } catch (error) {
        console.error('Samsung Health status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch Samsung Health status',
        });
    }
};

const syncSamsungHealthSamples = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const integration = await getSamsungHealthIntegration(userId);
        if (!integration || integration.status !== 'connected') {
            return res.status(400).json({
                success: false,
                message: 'Connect Samsung Health before syncing samples',
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
                message: 'Each sample needs sample_type: hrv | sleep | resting_hr | steps | workout',
            });
        }

        const saved = await upsertSamsungHealthSamples(userId, samples);
        return res.status(200).json({
            success: true,
            saved,
            message: 'Samsung Health samples synced',
        });
    } catch (error) {
        console.error('Samsung Health sync error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to sync Samsung Health samples',
        });
    }
};

const disconnectSamsungHealthAccount = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }
        await disconnectSamsungHealth(userId);
        return res.status(200).json({
            success: true,
            message: 'Samsung Health disconnected',
        });
    } catch (error) {
        console.error('Samsung Health disconnect error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to disconnect Samsung Health',
        });
    }
};

const getSamsungHealthSamples = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const integration = await getSamsungHealthIntegration(userId);
        if (!integration || integration.status !== 'connected') {
            return res.status(400).json({
                success: false,
                message: 'Connect Samsung Health first',
            });
        }

        const type = req.query.type ? String(req.query.type).toLowerCase() : undefined;
        if (type && !ALLOWED_TYPES.has(type)) {
            return res.status(400).json({
                success: false,
                message: 'type must be hrv | sleep | resting_hr | steps | workout',
            });
        }

        const samples = await listSamsungHealthSamples(userId, {
            type,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.status(200).json({
            success: true,
            count: samples.length,
            samples,
        });
    } catch (error) {
        console.error('Samsung Health list error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch Samsung Health samples',
        });
    }
};

module.exports = {
    connectSamsungHealthAccount,
    getSamsungHealthStatus,
    syncSamsungHealthSamples,
    getSamsungHealthSamples,
    disconnectSamsungHealthAccount,
};
