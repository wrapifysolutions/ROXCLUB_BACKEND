const test = require('node:test');
const assert = require('node:assert/strict');
const {
    sessionEvents,
    importedEvent,
    missedEvent,
    todayWorkoutEvent,
    sourceLabel,
    fanoutSessionNotifications,
} = require('../lib/notifications/events');
const { isLiveFanout } = require('../lib/notifications/notify');

test('session complete builds workout, level, badge, and mission events', () => {
    const events = sessionEvents(
        {
            workoutTitle: 'Foundation Protocol A',
            totalXp: 42,
            streak: 3,
            activityId: 'act-1',
            levelAfter: 4,
            rewards: [
                { type: 'LEVEL_UP', level: 4 },
                { type: 'BADGE', id: 'first_session', title: 'First session' },
                { type: 'MISSION', id: 'complete_3_sessions', title: 'Complete 3 sessions' },
            ],
        },
        'sess-1'
    );
    assert.equal(events[0].type, 'workout_completed');
    assert.match(events[0].body, /Foundation Protocol A/);
    assert.match(events[0].body, /\+42 XP/);
    assert.match(events[0].body, /3 day streak/);
    assert.equal(events[0].onceKey, 'workout:sess-1');
    assert.equal(events.some((event) => event.type === 'level_up' && event.onceKey === 'level:4'), true);
    assert.equal(events.some((event) => event.type === 'badge_earned'), true);
    assert.equal(events.some((event) => event.type === 'mission_complete'), true);
});

test('imported and missed copy names the source and the session', () => {
    const imported = importedEvent({ source: 'STRAVA', name: 'Morning Run', activityType: 'Run' }, 'act-9');
    assert.equal(imported.type, 'activity_imported');
    assert.match(imported.body, /Morning Run/);
    assert.match(imported.body, /Strava/);
    assert.equal(imported.onceKey, 'import:act-9');
    assert.equal(sourceLabel('APPLE_HEALTH'), 'Apple Health');
    const missed = missedEvent({ id: 'plan-1', title: 'Zone 2 Run', scheduled_on: '2026-11-10' });
    assert.equal(missed.type, 'session_missed');
    assert.match(missed.body, /Zone 2 Run/);
    const today = todayWorkoutEvent({ id: 'plan-2', title: 'Lower Base', duration_min: 40 }, '2026-11-11');
    assert.equal(today.type, 'today_workout');
    assert.match(today.body, /Lower Base/);
    assert.match(today.body, /40 min/);
    assert.equal(today.onceKey, 'today:2026-11-11');
});

test('node tests never fan out live FCM from session complete', () => {
    assert.equal(isLiveFanout(), false);
    assert.equal(fanoutSessionNotifications('user-1', 'sess-1', { totalXp: 10 }), undefined);
});
