const test = require('node:test');
const assert = require('node:assert/strict');
const { isLikelySupabaseToken } = require('../middlewares/auth.middleware');
const { GetAuthSession } = require('../controllers/AuthControllers/AuthSession');
const { resolveNavigation } = require('../lib/auth/accountRouting');

function fakeJwt(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `header.${body}.sig`;
}

function mockRes() {
    return {
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
        clearCookie() {},
    };
}

test('a Supabase access token is recognized on /auth/me', () => {
    const token = fakeJwt({
        iss: 'https://example.supabase.co/auth/v1',
        sub: '11111111-1111-1111-1111-111111111111',
        role: 'authenticated',
    });
    assert.equal(isLikelySupabaseToken(token), true);
});

test('an email RoxClub JWT is not sent to Supabase', () => {
    const token = fakeJwt({
        sub: '11111111-1111-1111-1111-111111111111',
        email: 'athlete@example.com',
        auth_provider: 'email',
    });
    assert.equal(isLikelySupabaseToken(token), false);
});

test('a new Google user with no role resolves to role_selection', () => {
    const navigation = resolveNavigation({});
    assert.equal(navigation.next, 'role_selection');
    assert.equal(navigation.accountType, null);
    assert.equal(navigation.permissions.coach, false);
    assert.equal(navigation.permissions.admin, false);
});

test('GET /auth/me without a token stays unauthenticated', async () => {
    const res = mockRes();
    await GetAuthSession({ headers: {}, cookies: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.authenticated, false);
    assert.equal(res.body.message, 'Not authenticated');
});

test('GET /auth/me rejects a non-Supabase bearer as an expired session', async () => {
    const res = mockRes();
    await GetAuthSession(
        { headers: { authorization: 'Bearer not-a-jwt' }, cookies: {} },
        res
    );
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.authenticated, false);
    assert.equal(res.body.message, 'Session expired');
});
