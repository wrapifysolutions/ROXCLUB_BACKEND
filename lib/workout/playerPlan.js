const ROXZONE_TARGET_SEC = 30;

function autoRoxzoneEnabled(workout) {
    if (workout?.autoRoxzone === false) return false;
    if (workout?.autoRoxzone === true) return true;
    return workout?.type === 'hybrid';
}

function runStationSwitch(left, right) {
    return (left === 'run' && right === 'station') || (left === 'station' && right === 'run');
}

function roxzone(index) {
    return {
        index,
        activityIndex: index,
        order: index + 1,
        kind: 'roxzone',
        name: 'Roxzone',
        iconUrl: 'icons/roxzone.png',
        label: '30 sec',
        target: { durationSec: ROXZONE_TARGET_SEC },
    };
}

function playerActivities(workout) {
    const source = Array.isArray(workout?.activities) ? workout.activities : [];
    const insertRoxzone = autoRoxzoneEnabled(workout);
    const expanded = [];
    let previousKind = null;
    for (const activity of source) {
        if (insertRoxzone && runStationSwitch(previousKind, activity.kind)) {
            expanded.push(roxzone(expanded.length));
        }
        previousKind = activity.kind;
        const index = expanded.length;
        expanded.push({
            ...activity,
            index,
            activityIndex: index,
            order: index + 1,
        });
    }

    const displayTotal = expanded.filter((activity) => activity.kind !== 'roxzone').length;
    let displayIndex = 0;
    return expanded.map((activity) => {
        if (activity.kind === 'roxzone') {
            return { ...activity, displayIndex: null, displayTotal };
        }
        displayIndex += 1;
        return { ...activity, displayIndex, displayTotal };
    });
}

function workActivities(plan) {
    return plan.filter((activity) => activity.kind !== 'roxzone');
}

module.exports = {
    ROXZONE_TARGET_SEC,
    autoRoxzoneEnabled,
    playerActivities,
    workActivities,
};
