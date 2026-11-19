const test = require('node:test');
const assert = require('node:assert/strict');
const { detectNovaIntent, looksLikeWeekPlan } = require('../lib/workouts/novaIntent');

test('detects week plans, session create, and plain questions', () => {
    assert.equal(looksLikeWeekPlan('suggest a 1 week training plan'), true);
    assert.equal(detectNovaIntent({ q: 'create a 1 week training plan' }), 'plan');
    assert.equal(detectNovaIntent({ intent: 'create', q: 'weekly workout schedule please' }), 'plan');
    assert.equal(detectNovaIntent({ q: 'create 1km run 20 wall balls' }), 'create');
    assert.equal(detectNovaIntent({ q: 'make me 30 min hyrox' }), 'recommend');
    assert.equal(detectNovaIntent({ q: 'what should I train today?' }), 'recommend');
    assert.equal(
        detectNovaIntent({ q: 'I want a 45-minute HYROX focusing on sled push, running' }),
        'recommend'
    );
    assert.equal(detectNovaIntent({ q: '1km run, 20 wall balls' }), 'recommend');
    assert.equal(detectNovaIntent({ intent: 'create', q: '1km run, 20 wall balls' }), 'create');
});
