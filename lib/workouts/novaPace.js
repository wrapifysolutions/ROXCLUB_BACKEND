const { DEFAULT_HYBRID_STATIONS } = require('../arena/defaultStations');
const { DIVISIONS } = require('../arena/eventContract');
const { formatClock, parseClock, displayPace } = require('../arena/times');

const MIN_GOAL_MS = 20 * 60 * 1000;
const MAX_GOAL_MS = 8 * 60 * 60 * 1000;

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

function stationWeight(station) {
    if (station.segment_type === 'run') return Math.max(0.5, (station.distance_m || 1000) / 1000);
    if (station.repetitions) return 1.2;
    const meters = Number(station.distance_m) || 0;
    if (meters >= 1000) return 1.1;
    if (meters >= 200) return 0.65;
    if (meters >= 80) return 0.8;
    if (meters >= 50) return 0.7;
    return 0.6;
}

function normalizeDivision(value) {
    const raw = String(value || 'open').trim().toLowerCase();
    return DIVISIONS.includes(raw) ? raw : 'open';
}

function paceHybridRace(input = {}) {
    const division = normalizeDivision(input.division);
    const goalMs = parseClock(input.goalTime, {
        field: 'goalTime',
        minMs: MIN_GOAL_MS,
        maxMs: MAX_GOAL_MS,
    });
    if (goalMs == null) {
        throw httpError('INVALID_TIME', 400, 'goalTime is required, for example 01:30:00');
    }

    const stations = DEFAULT_HYBRID_STATIONS;
    const weights = stations.map(stationWeight);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let allocated = 0;
    let runMs = 0;
    let runKm = 0;

    const splits = stations.map((station, index) => {
        const isLast = index === stations.length - 1;
        const targetMs = isLast
            ? Math.max(1000, goalMs - allocated)
            : Math.max(1000, Math.round(goalMs * (weights[index] / totalWeight)));
        allocated += targetMs;
        const distanceM = station.distance_m || null;
        if (station.segment_type === 'run' && distanceM) {
            runMs += targetMs;
            runKm += distanceM / 1000;
        }
        return {
            sequence: station.sequence,
            key: station.station_key,
            title: station.title,
            type: station.segment_type,
            distanceM,
            repetitions: station.repetitions || null,
            loadKg: station.load_kg || null,
            targetMs,
            target: formatClock(targetMs),
        };
    });

    const runPaceMs = runKm > 0 ? Math.round(runMs / runKm) : null;

    return {
        intent: 'pace',
        division,
        goalTime: formatClock(goalMs),
        goalTimeMs: goalMs,
        runPace: displayPace(runPaceMs),
        splits,
        officialHyrox: false,
        predictionAvailable: false,
        source: 'roxclub_hybrid_course',
        note: 'Athlete targets allocated across the RoxClub hybrid course from your goal time. Not an official race formula or predicted finish.',
    };
}

module.exports = {
    MIN_GOAL_MS,
    MAX_GOAL_MS,
    paceHybridRace,
};
