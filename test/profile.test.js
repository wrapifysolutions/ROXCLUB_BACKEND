const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getProfile,
    updateProfile,
    uploadProfilePhoto,
    removeProfilePhoto,
    getShareCard,
    exportProfile,
    deleteAccount,
    LAUNCH_SECTIONS,
} = require('../lib/profile/profileService');
const { validateProfilePhotoFile } = require('../lib/storage/profilePhoto');
const { GetProfile, PatchProfile, DeleteProfile } = require('../controllers/Profile/ProfileControllers');

function memoryQuery(db) {
    return async (sql, params = []) => {
        if (sql.includes('profile:identity')) {
            const user = db.users[params[0]];
            if (!user) return { rows: [] };
            return {
                rows: [
                    {
                        id: user.id,
                        email: user.email,
                        display_name: user.display_name,
                        gender: user.gender,
                        timezone: user.timezone,
                        date_of_birth: user.dob,
                        avatar_config: user.avatar,
                        notifications_enabled: user.notifications_enabled,
                        onboarding_done: user.onboarding_done,
                        height_cm: user.height_cm,
                        weight_kg: user.weight_kg,
                        xp_total: user.xp_total || 0,
                    },
                ],
            };
        }
        if (sql.includes('engine:dna')) {
            return { rows: db.dna ? [db.dna] : [] };
        }
        if (sql.includes('workout:activity_history')) {
            return { rows: db.activities || [] };
        }
        if (sql.includes('profile:connections')) {
            return { rows: db.integrations || [] };
        }
        if (sql.includes('profile:unread')) {
            return { rows: [{ count: db.unread || 0 }] };
        }
        if (sql.includes('profile:readiness')) {
            return { rows: db.readiness ? [db.readiness] : [] };
        }
        if (sql.includes('profile:null_refs')) {
            return { rows: [] };
        }
        if (sql.includes('profile:delete_user')) {
            delete db.users[params[0]];
            db.deleted = true;
            return { rows: [] };
        }
        if (sql.includes('profile:update_user')) {
            const user = db.users[params[0]];
            user.display_name = params[1];
            user.gender = params[2];
            user.timezone = params[3];
            user.dob = params[4];
            return { rows: [user] };
        }
        if (sql.includes('profile:update_questions')) {
            const user = db.users[params[0]];
            user.display_name = params[1];
            user.dob = params[2];
            user.gender = params[3];
            user.height_cm = params[4];
            user.weight_kg = params[5];
            user.notifications_enabled = params[6];
            user.avatar = params[11] ? JSON.parse(params[11]) : null;
            return { rows: [user] };
        }
        if (sql.includes('profile:update_metrics')) {
            const user = db.users[params[0]];
            user.weight_kg = params[1];
            user.height_cm = params[2];
            return { rows: [user] };
        }
        if (sql.includes('profile:save_photo')) {
            const user = db.users[params[0]];
            user.avatar = params[1] ? JSON.parse(params[1]) : {};
            return { rows: [user] };
        }
        throw new Error(sql);
    };
}

function athleteDb(overrides = {}) {
    return {
        users: {
            'user-1': {
                id: 'user-1',
                email: 'alex@rox.club',
                display_name: 'Alex',
                gender: 'male',
                timezone: 'Asia/Karachi',
                dob: '1998-04-12',
                avatar: { smile: 'grin', hair: 'short', kit: 'black' },
                notifications_enabled: true,
                onboarding_done: true,
                height_cm: 178,
                weight_kg: 78,
                xp_total: 0,
                ...overrides.user,
            },
        },
        dna: {
            status: 'CALIBRATING',
            model_version: 'v0',
            endurance: null,
            engine: null,
            strength: null,
            power: null,
            speed: null,
            mobility: null,
            ...overrides.dna,
        },
        activities: overrides.activities || [
            {
                id: 'act-1',
                session_id: 'sess-1',
                workout_id: 'wk_foundation_a',
                name: 'Foundation Protocol A',
                activity_type: 'workout',
                start_at: '2026-11-03T10:00:00Z',
                end_at: '2026-11-03T10:45:00Z',
                duration_sec: 2700,
                distance_m: null,
                avg_hr: null,
                evidence_status: 'STANDARD',
                roxzone_total_sec: 0,
                sources: ['app'],
                result: { totalXp: 60, subtitle: 'Session complete' },
                session_status: 'completed',
            },
        ],
        integrations: overrides.integrations || [
            { provider: 'apple_health', status: 'connected', last_synced_at: '2026-11-03T09:00:00Z' },
        ],
        unread: overrides.unread || 0,
    };
}

test('GET profile returns athlete identity, DNA, activity, and launch section flags', async () => {
    const db = athleteDb();
    const profile = await getProfile('user-1', { query: memoryQuery(db) });

    assert.equal(profile.user.name, 'Alex');
    assert.equal(profile.user.email, 'alex@rox.club');
    assert.equal(profile.user.gender, 'male');
    assert.equal(profile.user.timezone, 'Asia/Karachi');
    assert.equal(profile.user.heightCm, 178);
    assert.deepEqual(profile.user.avatar, { smile: 'grin', hair: 'short', kit: 'black' });
    assert.equal(profile.user.photoUrl, null);
    assert.equal(profile.level.level, 1);
    assert.equal(profile.athleteDna.status, 'CALIBRATING');
    assert.equal(profile.recentActivities[0].activityId, 'act-1');
    assert.equal(profile.connections.providers[0].provider, 'apple_health');
    assert.equal(profile.connections.providers[0].connected, true);
    assert.equal(profile.connections.currentWatch.provider, 'apple_health');
    assert.equal(profile.connections.currentWatch.label, 'Apple Health');
    assert.equal(profile.sharing.latestActivity.activityId, 'act-1');
    assert.match(profile.sharing.card.text, /Alex completed Foundation Protocol A/);
    assert.equal(profile.yourNumbers.readiness.status, 'CALIBRATING');
    assert.equal(profile.help.mode, 'mailto');
    assert.equal(profile.sections.deleteAccount.api, 'DELETE /api/profile');
    assert.equal(profile.sections.verification.status, 'hidden');
    assert.equal(profile.sections.programs.status, 'coming_soon');
    assert.equal(profile.sections.arena.status, 'hidden');
    assert.equal(profile.sections.premium.status, 'coming_soon');
    assert.equal(profile.sections.editProfile.status, 'available');
    assert.deepEqual(profile.sections, LAUNCH_SECTIONS);
});

test('GET profile is 404 before onboarding is complete', async () => {
    const db = athleteDb({ user: { onboarding_done: false } });
    await assert.rejects(
        () => getProfile('user-1', { query: memoryQuery(db) }),
        (error) => error.status === 404 && error.code === 'ONBOARDING_INCOMPLETE'
    );
});

test('PATCH profile updates name, avatar, and body metrics on existing tables', async () => {
    const db = athleteDb();
    const profile = await updateProfile(
        'user-1',
        {
            displayName: 'Alex Khan',
            avatar: { smile: 'calm', hair: 'short', kit: 'white' },
            heightCm: 180,
            weightKg: 80,
        },
        { query: memoryQuery(db) }
    );

    assert.equal(profile.user.name, 'Alex Khan');
    assert.equal(profile.user.avatar.kit, 'white');
    assert.equal(profile.user.heightCm, 180);
    assert.equal(profile.user.weightKg, 80);
    assert.equal(db.users['user-1'].display_name, 'Alex Khan');
});

test('profile photo upload stores a public URL without replacing the digital avatar', async () => {
    const db = athleteDb();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    validateProfilePhotoFile({
        buffer: jpeg,
        filename: 'me.jpg',
        mimeType: 'image/jpeg',
        size: jpeg.length,
    });
    assert.throws(
        () => validateProfilePhotoFile({ filename: 'cert.pdf', mimeType: 'application/pdf', size: 12 }),
        (error) => error.status === 400 && error.code === 'FILE_TYPE_NOT_ALLOWED'
    );

    const profile = await uploadProfilePhoto(
        'user-1',
        { buffer: jpeg, filename: 'me.jpg', mimeType: 'image/jpeg', size: jpeg.length },
        {
            query: memoryQuery(db),
            uploader: async () => ({
                secure_url: 'https://res.cloudinary.com/demo/image/upload/roxclub/profile-photos/user-1.jpg',
                public_id: 'roxclub/profile-photos/user-1',
            }),
        }
    );
    assert.equal(
        profile.user.photoUrl,
        'https://res.cloudinary.com/demo/image/upload/roxclub/profile-photos/user-1.jpg'
    );
    assert.equal(profile.user.avatar.kit, 'black');
    assert.equal(profile.user.avatar.photoUrl, undefined);

    const patched = await updateProfile(
        'user-1',
        { avatar: { smile: 'calm', hair: 'short', kit: 'white' } },
        { query: memoryQuery(db) }
    );
    assert.equal(patched.user.avatar.kit, 'white');
    assert.equal(patched.user.photoUrl, profile.user.photoUrl);

    let destroyed = null;
    const cleared = await removeProfilePhoto('user-1', {
        query: memoryQuery(db),
        destroyer: async (id) => {
            destroyed = id;
        },
    });
    assert.equal(cleared.user.photoUrl, null);
    assert.equal(cleared.user.avatar.kit, 'white');
    assert.equal(destroyed, 'roxclub/profile-photos/user-1');
});

test('PATCH profile rejects empty name and unknown gender', async () => {
    const db = athleteDb();
    await assert.rejects(
        () => updateProfile('user-1', { displayName: '  ' }, { query: memoryQuery(db) }),
        (error) => error.status === 400
    );
    await assert.rejects(
        () => updateProfile('user-1', { gender: 'other' }, { query: memoryQuery(db) }),
        (error) => error.status === 400
    );
});

test('profile HTTP handlers require auth', async () => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
    await GetProfile({ user: null }, res);
    assert.equal(res.statusCode, 401);
    await PatchProfile({ user: null, body: {} }, res);
    assert.equal(res.statusCode, 401);
    await DeleteProfile({ user: null, body: {} }, res);
    assert.equal(res.statusCode, 401);
});

test('share card uses latest activity and 404s for unknown ids', async () => {
    const db = athleteDb();
    const latest = await getShareCard('user-1', null, { query: memoryQuery(db) });
    assert.equal(latest.card.activityId, 'act-1');
    assert.equal(latest.card.durationMin, 45);
    assert.equal(latest.card.xp, 60);
    await assert.rejects(
        () => getShareCard('user-1', 'missing', { query: memoryQuery(db) }),
        (error) => error.status === 404
    );
});

test('export profile returns athlete data without secrets', async () => {
    const db = athleteDb();
    const exported = await exportProfile('user-1', { query: memoryQuery(db) });
    assert.equal(exported.user.email, 'alex@rox.club');
    assert.equal(exported.activities[0].activityId, 'act-1');
    assert.equal(exported.user.password_hash, undefined);
    assert.ok(exported.exportedAt);
});

test('delete account requires matching email then removes the user', async () => {
    const db = athleteDb();
    await assert.rejects(
        () => deleteAccount('user-1', {}, { query: memoryQuery(db) }),
        (error) => error.status === 400 && error.code === 'CONFIRM_EMAIL_REQUIRED'
    );
    await assert.rejects(
        () => deleteAccount('user-1', { confirmEmail: 'other@rox.club' }, { query: memoryQuery(db) }),
        (error) => error.status === 400 && error.code === 'CONFIRM_EMAIL_MISMATCH'
    );
    const result = await deleteAccount(
        'user-1',
        { confirmEmail: 'Alex@rox.club' },
        { query: memoryQuery(db) }
    );
    assert.equal(result.deleted, true);
    assert.equal(result.redirect, '/login');
    assert.equal(db.users['user-1'], undefined);
});
