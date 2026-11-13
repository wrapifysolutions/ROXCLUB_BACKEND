const test = require('node:test');
const assert = require('node:assert/strict');

const {
    looksLikeQuestion,
    questionText,
    catalogReply,
    sanitizeReply,
    attachNovaVoice,
} = require('../lib/workouts/novaVoice');

test('detects general questions and chat history text', () => {
    assert.equal(looksLikeQuestion('what should I train today?'), true);
    assert.equal(looksLikeQuestion('How do I start running'), true);
    assert.equal(looksLikeQuestion('1km run 20 wall balls'), false);
    assert.equal(
        questionText({ messages: [{ role: 'user', content: 'Can I do a short hybrid?' }] }),
        'Can I do a short hybrid?'
    );
});

test('catalog reply stays positive and names only provided workouts', () => {
    const reply = catalogReply(
        {
            intent: 'recommend',
            workouts: [{ id: 'wk_foundation_a', title: 'Foundation Protocol A', durationMin: 40 }],
            userMayStillTrain: true,
        },
        { q: 'what should I do today?' }
    );
    assert.match(reply, /Foundation Protocol A/);
    assert.match(reply, /Great question|strong next step/i);
    assert.doesNotMatch(reply, /cannot|failed|low/i);
});

test('negative or invented Groq copy is dropped', () => {
    const result = {
        workouts: [{ id: 'wk_foundation_a', title: 'Foundation Protocol A' }],
    };
    assert.equal(sanitizeReply('You failed and cannot train today.', result), null);
    assert.equal(sanitizeReply('Here is the official HYROX formula.', result), null);
    assert.match(
        sanitizeReply('Foundation Protocol A is a great next session when you are ready.', result),
        /Foundation Protocol A/
    );
});

test('Groq reply is used when grounded and ignored when the provider fails', async () => {
    const base = {
        intent: 'recommend',
        workouts: [{ id: 'wk_foundation_a', title: 'Foundation Protocol A', durationMin: 40 }],
        userMayStillTrain: true,
        classification: {},
    };

    const voiced = await attachNovaVoice(base, { q: 'what workout should I do?' }, {
        completeChat: async () => ({
            text: 'Great question. Foundation Protocol A is a confident next step from your library.',
            provider: 'groq',
            model: 'test-model',
        }),
    });
    assert.equal(voiced.asked, 'question');
    assert.equal(voiced.voice.provider, 'groq');
    assert.match(voiced.reply, /Foundation Protocol A/);
    assert.equal(voiced.workouts[0].id, 'wk_foundation_a');

    const fallback = await attachNovaVoice(base, { q: 'what workout should I do?' }, {
        completeChat: async () => {
            throw new Error('groq down');
        },
    });
    assert.equal(fallback.voice.provider, 'catalog');
    assert.match(fallback.reply, /Foundation Protocol A/);
});
