const { completeGroqChat, groqStatus } = require('../ai/groq');
const { parseNovaText } = require('./novaParse');
const { createUserWorkout, toDetail, toListItem } = require('./userWorkoutService');
const { attachNovaVoice } = require('./novaVoice');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TYPE_BY_EXTENSION = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

const VISION_SYSTEM = [
    'Extract a RoxClub workout from this whiteboard, training-app, or screenshot photo.',
    'Reply with one plain line of known RoxClub moves and numbers only, for example: 1km run, 20 wall balls, 50m sled push, rest 60s.',
    'Known names: SkiErg, Sled Push, Sled Pull, Burpee Broad Jump, Row, Farmers Carry, Sandbag Lunges, Wall Balls, Running, Squat, Pull-up, Deadlift, Press.',
    'Map names, reps, sets, duration, rest, and order. Ignore unknown moves.',
    'Do not invent official HYROX formulas or exercises that are not in that list.',
    'If the photo is unreadable, reply UNREADABLE.',
].join(' ');

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

function mimeFromFile(file) {
    const filenameHint = String(file?.filename || file?.originalname || '');
    const extension = filenameHint.includes('.') ? filenameHint.split('.').pop().toLowerCase() : '';
    const declared = String(file?.mimeType || file?.mimetype || '')
        .toLowerCase()
        .split(';')[0]
        .trim();
    if (ALLOWED_TYPES.has(declared)) return declared;
    if (!declared || declared === 'application/octet-stream') return TYPE_BY_EXTENSION[extension] || null;
    return declared;
}

function validateWorkoutPhoto(file) {
    if (!file) throw httpError('FILE_REQUIRED', 400, 'Workout photo is required');
    const size = Number(file.size || file.bytes || (file.buffer && file.buffer.length) || 0);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_BYTES) {
        throw httpError('FILE_INVALID', 400, 'Workout photo must be a JPEG, PNG, or WebP up to 5 MB');
    }
    const mimeType = mimeFromFile(file);
    if (!ALLOWED_TYPES.has(mimeType)) {
        throw httpError('FILE_TYPE_NOT_ALLOWED', 400, 'Workout photo must be a JPEG, PNG, or WebP');
    }
    const buffer = file.buffer;
    if (!buffer || !Buffer.isBuffer(buffer)) {
        throw httpError('FILE_INVALID', 400, 'Workout photo could not be read');
    }
    return { mimeType, buffer };
}

function cleanExtractedText(text) {
    const cleaned = String(text || '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^["']|["']$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
    if (!cleaned || /^unreadable\b/i.test(cleaned)) return '';
    return cleaned;
}

async function extractWorkoutTextFromPhoto(file, options = {}) {
    const supplied = String(options.ocrText || '').trim();
    if (supplied) {
        const ocrText = cleanExtractedText(supplied);
        if (!ocrText) {
            throw httpError('NOVA_PHOTO_UNREADABLE', 422, 'NOVA could not read a RoxClub workout from that photo');
        }
        return ocrText;
    }
    if (typeof options.extractWorkoutText === 'function') {
        return String((await options.extractWorkoutText(file)) || '').trim().slice(0, 500);
    }

    const { mimeType, buffer } = validateWorkoutPhoto(file);
    const env = options.env || process.env;
    if (process.env.NODE_TEST_CONTEXT && process.env.GROQ_IN_TESTS !== 'true' && typeof options.completeChat !== 'function') {
        throw httpError('NOVA_PHOTO_UNREADABLE', 422, 'Workout photo could not be read');
    }
    const status = groqStatus(env, { vision: true });
    if (!status.available && typeof options.completeChat !== 'function') {
        throw httpError('GROQ_NOT_CONFIGURED', 503, 'NOVA photo import needs GROQ_API_KEY');
    }

    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    const completion = await completeGroqChat({
        ...options,
        vision: true,
        timeoutMs: options.timeoutMs || 20000,
        temperature: 0.1,
        maxTokens: 400,
        messages: [
            { role: 'system', content: VISION_SYSTEM },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Extract the RoxClub workout from this photo.' },
                    { type: 'image_url', image_url: { url: dataUrl } },
                ],
            },
        ],
    });
    return cleanExtractedText(completion?.text);
}

async function importWorkoutFromPhoto(userId, file, options = {}) {
    if (!userId) throw httpError('UNAUTHORIZED', 401, 'Unauthorized Access');
    const text = await extractWorkoutTextFromPhoto(file, options);
    if (!text) {
        throw httpError('NOVA_PHOTO_UNREADABLE', 422, 'NOVA could not read a RoxClub workout from that photo');
    }

    parseNovaText(text);
    const workout = await createUserWorkout(
        userId,
        {
            q: text,
            title: options.title,
            source: 'nova_photo',
            purpose: text,
        },
        options.query
    );

    return attachNovaVoice(
        {
            intent: 'create',
            source: 'photo_import',
            governance: {
                mode: 'approved_content',
                aiMayInvent: false,
                officialHyroxFormulas: false,
                source: 'user_authored_photo',
            },
            extractedText: text,
            workout: toDetail(workout, false),
            workouts: [toListItem(workout)],
            explanation:
                'NOVA mapped this photo onto known RoxClub exercises only. Review or edit it, then save to My Workouts.',
            userMayStillTrain: true,
            offerCreate: false,
        },
        { q: text, intent: 'create' },
        options
    );
}

module.exports = {
    MAX_PHOTO_BYTES,
    VISION_SYSTEM,
    extractWorkoutTextFromPhoto,
    importWorkoutFromPhoto,
};
