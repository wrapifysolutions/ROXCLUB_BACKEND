const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
    uploadPublicProfilePhoto,
    destroyProfilePhoto,
} = require('../lib/storage/profilePhoto');
const {
    uploadProfilePhoto,
    removeProfilePhoto,
} = require('../lib/profile/profileService');

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

function hasStorage() {
    const cloudinary = Boolean(
        String(process.env.CLOUDINARY_CLOUD_NAME || '').trim() &&
            String(process.env.CLOUDINARY_API_KEY || '').trim() &&
            String(process.env.CLOUDINARY_API_SECRET || '').trim()
    );
    const supabase = Boolean(
        String(process.env.Project_Url || process.env.SUPABASE_URL || '').trim() &&
            String(process.env.SupaBase_Secret_Key || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
    );
    return cloudinary || supabase;
}

function memoryPhotoQuery(db) {
    return async (sql, params = []) => {
        if (sql.includes('profile:identity')) {
            return {
                rows: [
                    {
                        id: 'user-1',
                        email: 'alex@rox.club',
                        display_name: 'Alex',
                        gender: 'male',
                        timezone: 'UTC',
                        date_of_birth: '1998-04-12',
                        avatar_config: db.avatar,
                        notifications_enabled: true,
                        onboarding_done: true,
                        height_cm: 178,
                        weight_kg: 78,
                        xp_total: 0,
                    },
                ],
            };
        }
        if (sql.includes('engine:dna')) return { rows: [] };
        if (sql.includes('workout:activity_history')) return { rows: [] };
        if (sql.includes('profile:connections')) return { rows: [] };
        if (sql.includes('profile:unread')) return { rows: [{ count: 0 }] };
        if (sql.includes('profile:readiness')) return { rows: [] };
        if (sql.includes('profile:save_photo')) {
            db.avatar = params[1] ? JSON.parse(params[1]) : {};
            return { rows: [] };
        }
        throw new Error(sql);
    };
}

test('POST and DELETE /api/profile/photo require auth', async () => {
    const ProfileRouter = require('../routes/ProfileRoute');
    const app = express();
    app.use('/', ProfileRouter);
    const server = await new Promise((resolve) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const { port } = server.address();
    try {
        const post = await fetch(`http://127.0.0.1:${port}/api/profile/photo`, { method: 'POST' });
        const del = await fetch(`http://127.0.0.1:${port}/api/profile/photo`, { method: 'DELETE' });
        assert.equal(post.status, 401);
        assert.equal(del.status, 401);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('profile photo upload then delete works against live storage', { skip: !hasStorage(), timeout: 60000 }, async () => {
    const file = {
        buffer: PNG_1X1,
        filename: 'smoke.png',
        mimeType: 'image/png',
        size: PNG_1X1.length,
    };
    const uploaded = await uploadPublicProfilePhoto(file, { userId: 'photo-smoke-test' });
    assert.match(uploaded.photoUrl, /^https:\/\//i);
    assert.ok(['cloudinary', 'supabase'].includes(uploaded.provider));
    assert.ok(uploaded.photoPublicId);

    const visible = await fetch(uploaded.photoUrl);
    assert.equal(visible.ok, true, `uploaded image was not reachable (${visible.status})`);

    const db = { avatar: { smile: 'grin', hair: 'short', kit: 'black' } };
    const query = memoryPhotoQuery(db);
    const afterUpload = await uploadProfilePhoto('user-1', file, { query });
    assert.match(afterUpload.user.photoUrl, /^https:\/\//i);
    assert.equal(afterUpload.user.avatar.kit, 'black');

    const afterDelete = await removeProfilePhoto('user-1', { query });
    assert.equal(afterDelete.user.photoUrl, null);
    assert.equal(afterDelete.user.avatar.kit, 'black');

    await destroyProfilePhoto(uploaded.photoPublicId);
});

test.after(async () => {
    const { closeDB } = require('../lib/db');
    const cache = require('../lib/cache/redis');
    await closeDB().catch(() => {});
    await cache.quit().catch(() => {});
});
