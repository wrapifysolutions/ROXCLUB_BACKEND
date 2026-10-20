require('dotenv').config();
const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
    const raw = process.env.TOKEN_ENCRYPTION_KEY;
    if (!raw || raw.length !== 64) {
        throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
    }
    return Buffer.from(raw, 'hex');
}

function encryptToken(plainText) {
    if (plainText == null) {
        return null;
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    const encrypted = Buffer.concat([
        cipher.update(String(plainText), 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptToken(payload) {
    if (!payload) {
        return null;
    }

    const [ivHex, tagHex, dataHex] = String(payload).split(':');
    if (!ivHex || !tagHex || !dataHex) {
        throw new Error('Invalid encrypted token format');
    }

    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        getKey(),
        Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(dataHex, 'hex')),
        decipher.final(),
    ]);

    return decrypted.toString('utf8');
}

module.exports = { encryptToken, decryptToken };
