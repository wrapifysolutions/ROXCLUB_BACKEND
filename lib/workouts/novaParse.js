const EXERCISES = [
    { re: /\bsled\s*push(?:es)?\b/i, kind: 'station', name: 'Sled Push', iconUrl: 'icons/sled-push.png' },
    { re: /\bsled\s*pull(?:s)?\b/i, kind: 'station', name: 'Sled Pull', iconUrl: 'icons/sled-pull.png' },
    { re: /\bski\s*ergs?|skiergs?\b/i, kind: 'station', name: 'SkiErg', iconUrl: 'icons/ski.png' },
    { re: /\bwall\s*balls?\b/i, kind: 'station', name: 'Wall Balls', iconUrl: 'icons/wall-ball.png' },
    { re: /\bburpee\s*broad\s*jumps?|\bburpees?\b/i, kind: 'station', name: 'Burpee Broad Jump', iconUrl: 'icons/burpee.png' },
    { re: /\bfarmers?\s*carr(?:y|ies)\b/i, kind: 'station', name: 'Farmers Carry', iconUrl: 'icons/farmers.png' },
    { re: /\bsandbag\s*lunges?|\blunges?\b/i, kind: 'station', name: 'Sandbag Lunges', iconUrl: 'icons/sandbag.png' },
    { re: /\brow(?:ing|er|s)?\b/i, kind: 'station', name: 'Row', iconUrl: 'icons/row.png' },
    { re: /\brun(?:ning)?\b/i, kind: 'run', name: 'Running', iconUrl: 'icons/run.png' },
    { re: /\bfront\s*squats?|\bsquats?\b/i, kind: 'strength_exercise', name: 'Squat', iconUrl: 'icons/strength.png' },
    { re: /\bpull[-\s]?ups?\b/i, kind: 'strength_exercise', name: 'Pull-up', iconUrl: 'icons/strength.png' },
    { re: /\bdeadlifts?\b/i, kind: 'strength_exercise', name: 'Deadlift', iconUrl: 'icons/strength.png' },
    { re: /\bbench\s*press|\bpress\b/i, kind: 'strength_exercise', name: 'Press', iconUrl: 'icons/strength.png' },
];

function parseDurationMin(text) {
    const match = String(text || '').match(/\b(\d{1,3})\s*(-\s*)?(min|mins|minute|minutes)\b/i);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
}

function distanceFrom(match) {
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    return unit === 'm' ? amount : Math.round(amount * 1000);
}

function nearbyTarget(before, after) {
    const target = {};
    const distance =
        before.match(/(\d+(?:\.\d+)?)\s*(km|k|m)\s*$/i) ||
        after.match(/^\s*(\d+(?:\.\d+)?)\s*(km|k|m)\b/i);
    const distanceM = distanceFrom(distance);
    if (distanceM != null) target.distanceM = distanceM;

    const sets = before.match(/\b(\d{1,2})\s*[x×]\s*(\d{1,3})\s*$/i);
    if (sets) {
        target.sets = Number(sets[1]);
        target.reps = Number(sets[2]);
    }
    const repsWord =
        before.match(/\b(\d{1,3})\s*(reps?|rep)\s*$/i) ||
        after.match(/^\s*(\d{1,3})\s*(reps?|rep)\b/i);
    if (repsWord && target.reps == null) target.reps = Number(repsWord[1]);
    const leadingReps = before.match(/(\d{1,3})\s*$/);
    if (leadingReps && target.reps == null && target.distanceM == null) {
        target.reps = Number(leadingReps[1]);
    }
    const rest = after.match(/^\s*rest\s*(\d{1,3})\s*(sec|secs|s|min)?\b/i);
    if (rest) {
        const amount = Number(rest[1]);
        target.restSec = /min/i.test(rest[2] || '') ? amount * 60 : amount;
    }
    const load =
        before.match(/\b(\d{1,3})\s*kg\s*$/i) ||
        after.match(/^\s*(\d{1,3})\s*kg\b/i);
    if (load) target.loadKg = Number(load[1]);
    return target;
}

function labelFor(activity) {
    const target = activity.target || {};
    if (target.sets && target.reps) return `${target.sets} x ${target.reps}`;
    if (target.reps) return `${target.reps} reps`;
    if (target.distanceM >= 1000) return `${target.distanceM / 1000} km`;
    if (target.distanceM) return `${target.distanceM} m`;
    if (target.durationSec) return `${Math.round(target.durationSec / 60)} min`;
    return activity.name;
}

function inferType(text, activities) {
    const raw = String(text || '');
    if (/\bhyrox|hybrid|station\b/i.test(raw) || activities.some((item) => item.kind === 'station')) {
        return { type: 'hybrid', categoryId: 'cat_hybrid_race' };
    }
    if (activities.every((item) => item.kind === 'strength_exercise')) {
        return { type: 'strength', categoryId: 'cat_strength' };
    }
    if (activities.every((item) => item.kind === 'run')) {
        return { type: 'run', categoryId: 'cat_track' };
    }
    return { type: 'hybrid', categoryId: 'cat_hybrid_race' };
}

function parseNovaText(text) {
    const q = String(text || '').trim().slice(0, 500);
    if (!q) {
        const error = new Error('Workout text is required');
        error.status = 400;
        error.code = 'NOVA_TEXT_REQUIRED';
        throw error;
    }

    const found = [];
    for (const token of EXERCISES) {
        token.re.lastIndex = 0;
        const match = token.re.exec(q);
        if (!match) continue;
        const before = q.slice(Math.max(0, match.index - 16), match.index);
        const after = q.slice(match.index + match[0].length, match.index + match[0].length + 16);
        found.push({
            index: match.index,
            kind: token.kind,
            name: token.name,
            iconUrl: token.iconUrl,
            target: nearbyTarget(before, after),
        });
    }

    found.sort((left, right) => left.index - right.index);
    const unique = [];
    const seen = new Set();
    for (const item of found) {
        const key = `${item.kind}:${item.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
    }

    if (unique.length === 0) {
        const error = new Error('No known ROXCLUB exercises found in that text');
        error.status = 400;
        error.code = 'NOVA_NO_EXERCISES';
        throw error;
    }

    const activities = unique.map((item, order) => ({
        order: order + 1,
        kind: item.kind,
        name: item.name,
        iconUrl: item.iconUrl,
        target: item.target,
        label: labelFor({ name: item.name, target: item.target }),
    }));

    const meta = inferType(q, activities);
    const durationMin = parseDurationMin(q) || Math.max(20, activities.length * 8);
    return {
        title: `NOVA · ${durationMin} min ${meta.type === 'hybrid' ? 'Hybrid' : meta.type}`,
        categoryId: meta.categoryId,
        type: meta.type,
        durationMin,
        difficulty: 'Intermediate',
        author: 'NOVA',
        source: 'nova_text',
        purpose: q,
        activities,
        showInLibrary: false,
    };
}

module.exports = { parseNovaText, parseDurationMin };
