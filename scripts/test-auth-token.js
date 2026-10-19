const { createAccessToken, verifyAccessToken } = require('../lib/token');

const token = createAccessToken({
    id: '11111111-1111-1111-1111-111111111111',
    email: 'demo@roxclub.local',
    auth_provider: 'email',
});

const payload = verifyAccessToken(token);
console.log({
    tokenPreview: `${token.slice(0, 24)}...`,
    email: payload.email,
    sub: payload.sub,
    hasExp: Boolean(payload.exp),
});
