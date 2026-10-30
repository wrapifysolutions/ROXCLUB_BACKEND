const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveNavigation } = require('../lib/auth/accountRouting');
const { selectAccountType, submitCoachApplication, listOwnApplications } = require('../lib/account/accountService');
const { reviewApplication, listApplications, assertApprovedCoach } = require('../lib/admin/coachReviewService');
const { bootstrapAdmin } = require('../scripts/bootstrap-admin');
const {
    storageStatus,
    validateCertificationFile,
    createUploadSlot,
    uploadPrivateCertification,
} = require('../lib/storage/privateObjectStorage');

function memory() {
    const db = {
        users: [],
        applications: [],
        audits: [],
        clock: 0,
    };
    const query = async (sql, params) => {
        if (sql.includes('account:load_user') || sql.includes('admin:load_actor')) {
            return { rows: db.users.filter((user) => user.id === params[0]) };
        }
        if (sql.includes('account:latest_coach') || sql.includes('coach:latest_status')) {
            const rows = db.applications
                .filter((row) => row.user_id === params[0])
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            return { rows: rows[0] ? [{ status: rows[0].status }] : [] };
        }
        if (sql.includes('account:set_type')) {
            const user = db.users.find((row) => row.id === params[0]);
            if (user && user.account_type !== 'admin' && (user.account_type == null || user.account_type === params[1])) {
                user.account_type = params[1];
            }
            return { rows: [] };
        }
        if (sql.includes('coach:list_own')) {
            return {
                rows: db.applications
                    .filter((row) => row.user_id === params[0])
                    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
            };
        }
        if (sql.includes('coach:insert_application')) {
            if (db.applications.some((row) => row.user_id === params[0] && row.status === 'pending')) {
                const error = new Error('duplicate');
                error.code = '23505';
                throw error;
            }
            db.clock += 1;
            const row = {
                id: `app-${db.applications.length + 1}`,
                user_id: params[0],
                full_name: params[1],
                email: params[2],
                phone: params[3],
                country: params[4],
                city: params[5],
                specialty: params[6],
                years_experience: params[7],
                qualifications: params[8],
                biography: params[9],
                document_key: null,
                status: 'pending',
                rejection_reason: null,
                reviewed_by: null,
                reviewed_at: null,
                created_at: `2026-01-01T00:00:${String(db.clock).padStart(2, '0')}.000Z`,
            };
            db.applications.push(row);
            return { rows: [row] };
        }
        if (sql.includes('admin:list_applications')) {
            const status = params[0];
            return {
                rows: db.applications.filter((row) => status === 'all' || row.status === status),
            };
        }
        if (sql.includes('admin:load_application')) {
            return { rows: db.applications.filter((row) => row.id === params[0]) };
        }
        if (sql.includes('admin:approve') || sql.includes('admin:reject') || sql.includes('admin:suspend')) {
            const row = db.applications.find((item) => item.id === params[0]);
            if (!row) return { rows: [] };
            if (sql.includes('admin:approve') && row.status === 'pending') row.status = 'approved';
            if (sql.includes('admin:reject') && row.status === 'pending') {
                row.status = 'rejected';
                row.rejection_reason = params[2];
            }
            if (sql.includes('admin:suspend') && row.status === 'approved') {
                row.status = 'suspended';
                row.rejection_reason = params[2];
            }
            row.reviewed_by = params[1];
            row.reviewed_at = new Date().toISOString();
            return { rows: [row] };
        }
        if (sql.includes('admin:audit')) {
            db.audits.push({ action: params[1], actor: params[0] });
            return { rows: [] };
        }
        throw new Error(`Unhandled SQL ${sql.split('\n')[1]}`);
    };
    return { db, opts: { query } };
}

const applicationBody = {
    fullName: 'Coach Kim',
    email: 'attacker@example.com',
    phone: '+10000000000',
    country: 'UAE',
    city: 'Dubai',
    specialty: 'HYROX',
    yearsExperience: 6,
    qualifications: 'Level 2',
    biography: 'Hybrid coach.',
};

test('new users reach role selection for google, apple, and email', () => {
    for (const provider of ['google', 'apple', 'email']) {
        const nav = resolveNavigation({
            accountType: null,
            onboardingCompleted: false,
            coachStatus: null,
            authProvider: provider,
        });
        assert.equal(nav.next, 'role_selection');
        assert.equal(nav.permissions.admin, false);
        assert.equal(nav.permissions.coach, false);
    }
});

test('existing completed athletes skip role selection', () => {
    const nav = resolveNavigation({
        accountType: null,
        onboardingCompleted: true,
        coachStatus: null,
    });
    assert.equal(nav.next, 'home');
    assert.equal(nav.accountType, 'athlete');
    assert.equal(nav.accountTypeSource, 'inferred_athlete');
    assert.equal(nav.permissions.athlete, true);
});

test('athlete selection does not grant admin and coach selection stays separate', async () => {
    const { db, opts } = memory();
    db.users.push({
        id: 'new-1',
        email: 'new@rox.test',
        account_type: null,
        onboarding_completed: false,
    });
    await assert.rejects(
        () => selectAccountType('new-1', { accountType: 'admin' }, opts),
        (error) => error.code === 'ROLE_NOT_ALLOWED'
    );
    const athlete = await selectAccountType('new-1', { accountType: 'athlete' }, opts);
    assert.equal(athlete.accountType, 'athlete');
    assert.equal(athlete.navigation.next, 'onboarding');
    assert.equal(db.users[0].onboarding_completed, false);
});

test('existing athlete can apply as coach without losing athlete routing', async () => {
    const { db, opts } = memory();
    db.users.push({
        id: 'ath-1',
        email: 'alex@rox.test',
        account_type: 'athlete',
        onboarding_completed: true,
    });
    const selected = await selectAccountType('ath-1', { accountType: 'coach' }, opts);
    assert.equal(selected.preservedAthlete, true);
    assert.equal(db.users[0].account_type, 'athlete');
    assert.equal(selected.navigation.next, 'home');

    const application = await submitCoachApplication('ath-1', 'alex@rox.test', applicationBody, opts);
    assert.equal(application.email, 'alex@rox.test');
    assert.equal(application.status, 'pending');
    assert.notEqual(application.email, 'attacker@example.com');
    const nav = resolveNavigation({
        accountType: 'athlete',
        onboardingCompleted: true,
        coachStatus: 'pending',
    });
    assert.equal(nav.next, 'home');
    assert.equal(nav.permissions.coach, false);
    assert.equal(nav.permissions.athlete, true);
});

test('pending coach cannot access protected club route', async () => {
    const { db, opts } = memory();
    db.users.push({ id: 'c1', email: 'c@rox.test', account_type: 'coach', onboarding_completed: false });
    await submitCoachApplication('c1', 'c@rox.test', applicationBody, opts);
    await assert.rejects(
        () => assertApprovedCoach('c1', opts),
        (error) => error.code === 'COACH_NOT_APPROVED'
    );
});

test('non-admin cannot approve and public admin role is rejected', async () => {
    const { db, opts } = memory();
    db.users.push(
        { id: 'c1', email: 'c@rox.test', account_type: 'coach', onboarding_completed: false },
        { id: 'u2', email: 'u@rox.test', account_type: 'athlete', onboarding_completed: true }
    );
    const application = await submitCoachApplication('c1', 'c@rox.test', applicationBody, opts);
    await assert.rejects(
        () => reviewApplication('u2', application.id, 'approve', {}, opts),
        (error) => error.code === 'ADMIN_REQUIRED'
    );
    await assert.rejects(
        () => submitCoachApplication('c1', 'c@rox.test', { ...applicationBody, role: 'admin' }, opts),
        (error) => error.code === 'ROLE_NOT_ALLOWED'
    );
});

test('admin approval grants coach permission without changing athlete account type', async () => {
    const { db, opts } = memory();
    db.users.push(
        { id: 'ath-1', email: 'alex@rox.test', account_type: 'athlete', onboarding_completed: true },
        { id: 'admin-1', email: 'admin@rox.test', account_type: 'admin', onboarding_completed: true }
    );
    const application = await submitCoachApplication('ath-1', 'alex@rox.test', applicationBody, opts);
    const approved = await reviewApplication('admin-1', application.id, 'approve', {}, opts);
    assert.equal(approved.application.status, 'approved');
    assert.equal(db.users[0].account_type, 'athlete');
    assert.equal(db.users[0].onboarding_completed, true);
    await assertApprovedCoach('ath-1', opts);
    const nav = resolveNavigation({
        accountType: 'athlete',
        onboardingCompleted: true,
        coachStatus: 'approved',
    });
    assert.equal(nav.next, 'home');
    assert.equal(nav.permissions.coach, true);
    assert.equal(nav.permissions.athlete, true);
});

test('rejection keeps history and allows a new application', async () => {
    const { db, opts } = memory();
    db.users.push(
        { id: 'c1', email: 'c@rox.test', account_type: 'coach', onboarding_completed: false },
        { id: 'admin-1', email: 'admin@rox.test', account_type: 'admin', onboarding_completed: true }
    );
    const first = await submitCoachApplication('c1', 'c@rox.test', applicationBody, opts);
    await reviewApplication('admin-1', first.id, 'reject', { reason: 'Need certificate' }, opts);
    const second = await submitCoachApplication('c1', 'c@rox.test', applicationBody, opts);
    const mine = await listOwnApplications('c1', opts);
    assert.equal(mine.history.length, 2);
    assert.equal(mine.current.status, 'pending');
    assert.equal(mine.history.some((row) => row.status === 'rejected'), true);
    assert.equal(second.id !== first.id, true);
});

test('duplicate pending application is rejected', async () => {
    const { db, opts } = memory();
    db.users.push({ id: 'c1', email: 'c@rox.test', account_type: 'coach', onboarding_completed: false });
    await submitCoachApplication('c1', 'c@rox.test', applicationBody, opts);
    await assert.rejects(
        () => submitCoachApplication('c1', 'c@rox.test', applicationBody, opts),
        (error) => error.code === 'APPLICATION_PENDING'
    );
    assert.equal(db.applications.length, 1);
});

test('applicants cannot approve themselves', async () => {
    const { db, opts } = memory();
    db.users.push({ id: 'c1', email: 'c@rox.test', account_type: 'admin', onboarding_completed: false });
    db.applications.push({
        id: 'app-self',
        user_id: 'c1',
        status: 'pending',
        email: 'c@rox.test',
        full_name: 'Self',
        phone: '1',
        country: 'UAE',
        city: 'Dubai',
        specialty: 'HYROX',
        years_experience: 1,
        qualifications: 'q',
        biography: 'b',
        created_at: new Date().toISOString(),
    });
    await assert.rejects(
        () => reviewApplication('c1', 'app-self', 'approve', {}, opts),
        (error) => error.code === 'ROLE_NOT_ALLOWED'
    );
});

test('admin list is admin-only', async () => {
    const { db, opts } = memory();
    db.users.push({ id: 'u2', email: 'u@rox.test', account_type: 'athlete', onboarding_completed: true });
    await assert.rejects(
        () => listApplications('u2', 'pending', opts),
        (error) => error.code === 'ADMIN_REQUIRED'
    );
});

test('bootstrap does not grant admin before email verification and never returns the password', async () => {
    const calls = [];
    const db = { user: null, audits: 0 };
    const queryFn = async (sql, params) => {
        calls.push(sql);
        if (sql.includes('SELECT id, email')) {
            return { rows: db.user ? [db.user] : [] };
        }
        if (sql.includes('INSERT INTO users')) {
            db.user = { id: 'boot-1', email: params[0], is_email_verified: false, account_type: null };
            assert.equal(String(params[1]).includes('super-secret-pass'), false);
            return { rows: [{ id: 'boot-1' }] };
        }
        if (sql.includes("account_type = 'admin'")) {
            db.user.account_type = 'admin';
            return { rows: [] };
        }
        if (sql.includes('admin_audit_log')) {
            db.audits += 1;
            return { rows: [] };
        }
        if (sql.includes('UPDATE users')) return { rows: [] };
        throw new Error(sql);
    };
    const pending = await bootstrapAdmin({
        env: {
            ADMIN_BOOTSTRAP_ENABLED: 'true',
            ADMIN_BOOTSTRAP_EMAIL: 'handbsoftwaresolutions@gmail.com',
            ADMIN_BOOTSTRAP_PASSWORD: 'super-secret-pass',
        },
        queryFn,
        hash: async (value) => `hashed:${value.length}`,
        sendOtp: async () => {},
    });
    assert.equal(pending.code, 'VERIFY_EMAIL_REQUIRED');
    assert.equal(db.user.account_type, null);
    assert.equal(JSON.stringify(pending).includes('super-secret-pass'), false);

    db.user.is_email_verified = true;
    const granted = await bootstrapAdmin({
        env: {
            ADMIN_BOOTSTRAP_ENABLED: 'true',
            ADMIN_BOOTSTRAP_EMAIL: 'handbsoftwaresolutions@gmail.com',
            ADMIN_BOOTSTRAP_PASSWORD: 'super-secret-pass',
        },
        queryFn,
        hash: async (value) => `hashed:${value.length}`,
    });
    assert.equal(granted.code, 'ADMIN_GRANTED');
    assert.equal(db.user.account_type, 'admin');
    assert.equal(db.audits, 1);
});

test('certification upload stays disabled without Cloudinary configuration', () => {
    const previous = {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET,
    };
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    const status = storageStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.provider, 'cloudinary');
    assert.equal(status.code, 'STORAGE_NOT_CONFIGURED');
    assert.throws(() => createUploadSlot(), (error) => error.code === 'STORAGE_NOT_CONFIGURED');
    const file = validateCertificationFile({
        size: 1024,
        mimeType: 'application/pdf',
        filename: 'cert.pdf',
    });
    assert.equal(file.filename, 'cert.pdf');
    process.env.CLOUDINARY_CLOUD_NAME = previous.cloudName;
    process.env.CLOUDINARY_API_KEY = previous.apiKey;
    process.env.CLOUDINARY_API_SECRET = previous.apiSecret;
});

test('Cloudinary certification upload is private and does not return a public URL', async () => {
    const previous = {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET,
    };
    process.env.CLOUDINARY_CLOUD_NAME = 'roxclub-test';
    process.env.CLOUDINARY_API_KEY = 'test-key';
    process.env.CLOUDINARY_API_SECRET = 'test-secret';
    let seen = null;
    const uploaded = await uploadPrivateCertification(
        {
            buffer: Buffer.from('pdf'),
            filename: 'cert.pdf',
            mimeType: 'application/pdf',
            size: 3,
        },
        {
            userId: 'user-1',
            uploader: async ({ options }) => {
                seen = options;
                return { public_id: 'roxclub/coach-certifications/user-1/cert', secure_url: 'https://res.cloudinary.com/public/cert.pdf' };
            },
        }
    );
    assert.equal(seen.type, 'authenticated');
    assert.equal(seen.access_mode, 'authenticated');
    assert.equal(seen.resource_type, 'raw');
    assert.equal(uploaded.documentKey.includes('https://'), false);
    assert.equal(uploaded.access, 'authenticated');
    process.env.CLOUDINARY_CLOUD_NAME = previous.cloudName;
    process.env.CLOUDINARY_API_KEY = previous.apiKey;
    process.env.CLOUDINARY_API_SECRET = previous.apiSecret;
});
