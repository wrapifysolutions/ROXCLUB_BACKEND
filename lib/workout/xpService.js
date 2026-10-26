const xpConfig = require('../../config/xp.json');
const evidenceConfig = require('../../config/evidence.json');
const badgeConfig = require('../../config/badges.json');
const missionConfig = require('../../config/missions.json');

const WATCH_PROVIDERS = {
    zepp: 'ZEPP',
    apple_health: 'APPLE',
    strava: 'STRAVA',
};

function multiplierFor(priorSessionsToday) {
    const table = xpConfig.dailyMultipliers || [1];
    const index = Math.min(Math.max(0, priorSessionsToday), table.length - 1);
    return Number(table[index] ?? 1);
}

function buildXp({ workoutType, partial, finishedWork, priorSessionsToday }) {
    if (workoutType === 'recovery') return [];
    const multiplier = multiplierFor(priorSessionsToday);
    const rows = [];
    if (!partial) {
        const xp = Math.round(Number(xpConfig.sessionBaseXp) * multiplier);
        if (xp > 0) rows.push({ reason: 'session_base', xp });
    }
    for (const activity of finishedWork) {
        const xp = Math.round(Number(xpConfig.activityXp) * multiplier);
        if (xp > 0) rows.push({ reason: `activity:${activity.name}`, xp });
    }
    return rows;
}

function coinsFor(workoutType) {
    if (workoutType === 'recovery') return Number(xpConfig.recoveryCoins) || 0;
    return Number(xpConfig.coinsPerSession) || 0;
}

function levelState(totalXp) {
    const thresholds = xpConfig.levelThresholds || [0];
    const total = Math.max(0, Number(totalXp) || 0);
    let level = 1;
    for (let index = 1; index < thresholds.length; index += 1) {
        if (total >= Number(thresholds[index])) level = index + 1;
        else break;
    }
    const floor = Number(thresholds[level - 1] ?? 0);
    const ceiling = thresholds[level] == null ? null : Number(thresholds[level]);
    return {
        level,
        xpIntoLevel: total - floor,
        xpToNextLevel: ceiling == null ? 0 : ceiling - total,
        nextLevelXp: ceiling == null ? 0 : ceiling - floor,
    };
}

function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function nextStreak(current, lastActiveOn, localDate, workoutType) {
    const keepRecovery = xpConfig.streak?.recoveryKeepsStreak !== false;
    if (workoutType === 'recovery' && !keepRecovery) {
        return { streak: Number(current) || 0, lastActiveOn: lastActiveOn || null };
    }
    const previous = Number(current) || 0;
    if (lastActiveOn === localDate) {
        return { streak: Math.max(previous, 1), lastActiveOn: localDate };
    }
    if (lastActiveOn && addDays(lastActiveOn, 1) === localDate) {
        return { streak: previous + 1, lastActiveOn: localDate };
    }
    return { streak: 1, lastActiveOn: localDate };
}

function evidenceConfidence(status) {
    return evidenceConfig.confidence?.[status] || 'LOW';
}

function watchSignals(match) {
    const signals = [];
    if (match?.hasGps) signals.push('GPS');
    if (match?.averageHr != null && Number.isFinite(Number(match.averageHr))) signals.push('HR');
    if (match?.hrv != null && Number.isFinite(Number(match.hrv))) signals.push('HRV');
    if (match?.cadence != null && Number.isFinite(Number(match.cadence))) signals.push('Cadence');
    return signals;
}

function buildEvidence({ status, splits, matches }) {
    const signals = ['Timer'];
    const outdoor = (splits || []).some((split) => split.kind === 'run' && split.inputMethod === 'gps');
    if (outdoor) signals.push('GPS');
    const sources = [{ provider: 'ROXCLUB', signals }];
    for (const match of matches || []) {
        const watch = watchSignals(match);
        if (watch.length === 0) continue;
        const source = {
            provider: WATCH_PROVIDERS[match.source] || String(match.source || 'WATCH').toUpperCase(),
            signals: watch,
        };
        if (match.deviceName) source.deviceName = match.deviceName;
        sources.push(source);
    }
    return { status, confidence: evidenceConfidence(status), sources };
}

function evidenceStatus(workItems, avgHr) {
    const items = workItems || [];
    const total = items.length;
    if (avgHr != null && Number.isFinite(Number(avgHr))) return 'VERIFIED';
    if (total === 0) return 'STANDARD';
    const withHr = items.filter((item) => item.avgHr != null && Number.isFinite(Number(item.avgHr))).length;
    const manual = items.filter((item) => item.inputMethod === 'manual').length;
    if (withHr / total > Number(evidenceConfig.verifiedHrCoverage ?? 0.5)) return 'VERIFIED';
    if (manual / total > Number(evidenceConfig.limitedManualCoverage ?? 0.5)) return 'LIMITED';
    return 'STANDARD';
}

function badgeRewards(completedSessions, alreadyAwarded) {
    const owned = new Set(alreadyAwarded || []);
    const rewards = [];
    for (const badge of badgeConfig.badges || []) {
        if (owned.has(badge.id)) continue;
        if (badge.rule === 'first_completed_session' && completedSessions >= 1) {
            rewards.push({
                type: 'BADGE',
                id: badge.id,
                name: badge.name,
                title: badge.name,
                coins: Number(badge.coins) || 0,
            });
        }
    }
    return rewards;
}

function missionRewards(completedSessions, alreadyAwarded) {
    const owned = new Set(alreadyAwarded || []);
    const rewards = [];
    for (const mission of missionConfig.missions || []) {
        if (owned.has(mission.id)) continue;
        if (mission.rule === 'completed_sessions' && completedSessions >= Number(mission.count)) {
            rewards.push({
                type: 'MISSION',
                id: mission.id,
                title: mission.title,
                coins: Number(mission.coins) || 0,
            });
        }
    }
    return rewards;
}

function streakReward(streakDays, localDate) {
    const coins = Number(xpConfig.streak?.coins) || 0;
    return {
        type: 'STREAK_COINS',
        id: `streak_${localDate}`,
        title: `${streakDays} day streak`,
        coins,
    };
}

module.exports = {
    xpConfig,
    buildXp,
    coinsFor,
    levelState,
    nextStreak,
    evidenceStatus,
    buildEvidence,
    badgeRewards,
    missionRewards,
    streakReward,
};
