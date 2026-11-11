function sourceLabel(source) {
    const key = String(source || '')
        .trim()
        .toUpperCase()
        .replace(/-/g, '_');
    const labels = {
        STRAVA: 'Strava',
        APPLE_HEALTH: 'Apple Health',
        SAMSUNG_HEALTH: 'Samsung Health',
        GARMIN: 'Garmin',
        ZEPP: 'Zepp',
        ROXCLUB_NATIVE: 'ROXCLUB',
    };
    return labels[key] || key.replace(/_/g, ' ') || 'your watch';
}

function sessionEvents(payload = {}, sessionId) {
    const title = payload.workoutTitle || 'Workout';
    const xp = Number(payload.totalXp) || 0;
    const events = [];
    const parts = [title];
    if (payload.subtitle) parts.push(payload.subtitle);
    else if (xp > 0) parts.push(`+${xp} XP`);
    if (Number(payload.streak) > 1) parts.push(`${payload.streak} day streak`);
    events.push({
        type: 'workout_completed',
        body: `${parts.join(' · ')}.`,
        path: '/home',
        onceKey: `workout:${sessionId}`,
        data: {
            sessionId,
            activityId: payload.activityId || '',
            xp: String(xp),
        },
    });

    const rewards = Array.isArray(payload.rewards) ? payload.rewards : [];
    if (rewards.some((reward) => reward.type === 'LEVEL_UP') && payload.levelAfter != null) {
        events.push({
            type: 'level_up',
            body: `You reached Level ${payload.levelAfter}.`,
            path: '/home',
            onceKey: `level:${payload.levelAfter}`,
            data: { level: String(payload.levelAfter) },
        });
    }
    const badge = rewards.find((reward) => reward.type === 'BADGE');
    if (badge?.id) {
        events.push({
            type: 'badge_earned',
            body: `${badge.title || badge.name || 'Badge'} is yours.`,
            path: '/home',
            onceKey: `badge:${badge.id}`,
            data: { badgeId: badge.id },
        });
    }
    const mission = rewards.find((reward) => reward.type === 'MISSION');
    if (mission?.id) {
        events.push({
            type: 'mission_complete',
            body: `${mission.title || 'Mission'} complete.`,
            path: '/home',
            onceKey: `mission:${mission.id}`,
            data: { missionId: mission.id },
        });
    }
    return events;
}

function fanoutSessionNotifications(userId, sessionId, payload) {
    const { notifyLater, isLiveFanout } = require('./notify');
    if (!userId || !sessionId || !isLiveFanout()) return;
    for (const event of sessionEvents(payload, sessionId)) {
        notifyLater(userId, event);
    }
}

function importedEvent(payload = {}, activityId) {
    const name = payload.name || payload.activityType || 'Activity';
    const source = sourceLabel(payload.source);
    return {
        type: 'activity_imported',
        body: `${name} from ${source} is in your log.`,
        path: '/home',
        onceKey: `import:${activityId}`,
        data: {
            activityId,
            source: String(payload.source || ''),
        },
    };
}

function fanoutImportedNotification(userId, payload, activityId) {
    const { notifyLater, isLiveFanout } = require('./notify');
    if (!userId || !activityId || !isLiveFanout()) return;
    notifyLater(userId, importedEvent(payload, activityId));
}

function missedEvent(session) {
    const title = session?.title || 'training';
    return {
        type: 'session_missed',
        body: `${title} was missed. Open Train to catch up.`,
        path: '/train',
        onceKey: `missed:${session.id}`,
        data: {
            scheduledSessionId: session.id,
            date: session.scheduled_on || '',
        },
    };
}

function fanoutMissedNotifications(userId, sessions) {
    const { notifyLater, isLiveFanout } = require('./notify');
    if (!userId || !isLiveFanout()) return;
    for (const session of sessions || []) {
        if (!session?.id) continue;
        notifyLater(userId, missedEvent(session));
    }
}

function todayWorkoutEvent(session, date) {
    const title = session?.title || "Today's session";
    const minutes = Number(session?.duration_min);
    const body = Number.isFinite(minutes) && minutes > 0 ? `${title} · ${minutes} min.` : `${title} is on your calendar.`;
    return {
        type: 'today_workout',
        body,
        path: '/train',
        onceKey: `today:${date}`,
        data: {
            scheduledSessionId: session?.id || '',
            date,
        },
    };
}

function fanoutTodayWorkout(userId, session, date) {
    const { notifyLater, isLiveFanout } = require('./notify');
    if (!userId || !session || !date || !isLiveFanout()) return;
    notifyLater(userId, todayWorkoutEvent(session, date));
}

module.exports = {
    sourceLabel,
    sessionEvents,
    fanoutSessionNotifications,
    importedEvent,
    fanoutImportedNotification,
    missedEvent,
    fanoutMissedNotifications,
    todayWorkoutEvent,
    fanoutTodayWorkout,
};
