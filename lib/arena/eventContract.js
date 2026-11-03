const { httpError } = require('./times');

const EVENT_TYPES = [
    { value: 'simulation', label: 'Virtual simulation' },
    { value: 'in_person', label: 'In-person event' },
    { value: 'hybrid_challenge', label: 'Hybrid challenge' },
];

const SPORT_TYPES = [
    { value: 'Hybrid', stravaEquivalent: 'Workout', category: 'hybrid' },
    { value: 'Run', stravaEquivalent: 'Run', category: 'running' },
    { value: 'Ride', stravaEquivalent: 'Ride', category: 'endurance' },
    { value: 'Walk', stravaEquivalent: 'Walk', category: 'endurance' },
    { value: 'Hike', stravaEquivalent: 'Hike', category: 'endurance' },
    { value: 'Rowing', stravaEquivalent: 'Rowing', category: 'endurance' },
    { value: 'Workout', stravaEquivalent: 'Workout', category: 'conditioning' },
    { value: 'WeightTraining', stravaEquivalent: 'WeightTraining', category: 'strength' },
];

const DIVISIONS = ['open', 'men', 'women', 'mixed'];
const CATEGORIES = ['hybrid', 'running', 'strength', 'endurance', 'conditioning'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const VISIBILITIES = ['public', 'club'];
const SEGMENT_TYPES = ['run', 'station', 'roxzone'];
const LOAD_STATIONS = new Set([
    'sled_push',
    'sled_pull',
    'farmers_carry',
    'sandbag_lunges',
    'wall_balls',
]);

function clean(value, max) {
    return String(value || '').trim().slice(0, max);
}

function invalid(message, fields = []) {
    const error = httpError('INVALID_EVENT', 400, message);
    error.fields = fields;
    return error;
}

function parseDate(value, field, fields) {
    if (value == null || value === '') {
        fields.push(field);
        return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        fields.push(field);
        return null;
    }
    return date;
}

function stringList(value, maxItems = 24, maxLen = 400) {
    if (!Array.isArray(value)) return null;
    const out = [];
    const seen = new Set();
    for (const item of value.slice(0, maxItems)) {
        const text = (
            typeof item === 'string' ? item : String(item?.text || item?.title || '')
        )
            .trim()
            .slice(0, maxLen);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
    }
    return out;
}

function coachEventForm() {
    return {
        requiredFields: [
            'title',
            'description',
            'imageKey',
            'location',
            'startsAt',
            'endsAt',
            'eventType',
            'sportType',
            'division',
            'category',
        ],
        optionalFields: [
            'difficulty',
            'visibility',
            'timezone',
            'maxParticipants',
            'clubId',
            'stations',
            'aboutRules',
            'generalRules',
            'categoryLoads',
            'overview',
            'movementStandards',
            'penalties',
        ],
        eventTypes: EVENT_TYPES,
        sportTypes: SPORT_TYPES,
        divisions: DIVISIONS,
        categories: CATEGORIES,
        difficulties: DIFFICULTIES,
        visibilities: VISIBILITIES,
        stationTypes: SEGMENT_TYPES,
        notes: [
            'eventType follows ROXCLUB Arena (simulation, in_person, hybrid_challenge).',
            'sportType follows Strava activity naming so coaches enter a familiar sport.',
            'If stations are omitted, the published ROXCLUB hybrid course is used.',
            'Full Race Rules template fields: aboutRules, generalRules, categoryLoads, stations. Each event stores its own values.',
            'Virtual results cannot create real-world athletic evidence.',
        ],
    };
}

function parseCoachEvent(body = {}) {
    const fields = [];
    const title = clean(body.title, 160);
    const description = clean(body.description, 4000);
    const imageKey = clean(body.imageKey || body.image_key, 255);
    const location = clean(body.location, 160);
    const eventType = clean(body.eventType || body.event_type, 40);
    const sportType = clean(body.sportType || body.sport_type, 40);
    const division = clean(body.division, 40);
    const category = clean(body.category, 40);
    const difficulty = clean(body.difficulty, 40);
    const visibility = clean(body.visibility || 'public', 20) || 'public';
    const timezone = clean(body.timezone || 'UTC', 80) || 'UTC';

    if (title.length < 4) fields.push('title');
    if (description.length < 20) fields.push('description');
    if (!imageKey) fields.push('imageKey');
    if (location.length < 2) fields.push('location');
    if (!EVENT_TYPES.some((item) => item.value === eventType)) fields.push('eventType');
    if (!SPORT_TYPES.some((item) => item.value === sportType)) fields.push('sportType');
    if (!DIVISIONS.includes(division)) fields.push('division');
    if (!CATEGORIES.includes(category)) fields.push('category');
    if (difficulty && !DIFFICULTIES.includes(difficulty)) fields.push('difficulty');
    if (!VISIBILITIES.includes(visibility)) fields.push('visibility');
    if (visibility === 'club' && !body.clubId && !body.club_id) fields.push('clubId');

    const startsAt = parseDate(body.startsAt || body.starts_at, 'startsAt', fields);
    const endsAt = parseDate(body.endsAt || body.ends_at, 'endsAt', fields);
    if (startsAt && endsAt && endsAt <= startsAt) fields.push('endsAt');
    if (startsAt && endsAt && (endsAt.getTime() - startsAt.getTime()) / 86400000 > 30) {
        fields.push('endsAt');
    }

    if (fields.length) {
        throw invalid(
            'Coach event form is incomplete. Enter the same core details Strava requires for a club event, plus the ROXCLUB race format.',
            [...new Set(fields)]
        );
    }

    const sport = SPORT_TYPES.find((item) => item.value === sportType);
    const nested = body.rules && typeof body.rules === 'object' ? body.rules : {};
    const aboutRules = clean(
        body.aboutRules || nested.aboutRules || body.overview || nested.overview || description,
        2000
    );
    const generalRules = stringList(body.generalRules || nested.generalRules);
    const movementStandards = stringList(body.movementStandards || nested.movementStandards) || [];
    const requiredWork = stringList(body.requiredWork || nested.requiredWork) || [];
    const penalties = stringList(body.penalties || nested.penalties) || [];
    const categoryLoads = parseCategoryLoads(body.categoryLoads || nested.categoryLoads);
    return {
        title,
        description,
        imageKey,
        location,
        eventType,
        sportType,
        division,
        category: category || sport.category,
        difficulty: difficulty || null,
        visibility,
        timezone,
        maxParticipants:
            body.maxParticipants == null && body.max_participants == null
                ? null
                : Math.max(1, Number(body.maxParticipants || body.max_participants)),
        clubId: visibility === 'club' ? body.clubId || body.club_id : null,
        startsAt,
        endsAt,
        aboutRules,
        overview: aboutRules,
        generalRules,
        categoryLoads,
        formatSummary: clean(body.formatSummary || nested.formatSummary, 400),
        formatKey: clean(body.formatKey || nested.formatKey || 'roxclub_hybrid_v1', 80),
        estimatedDurationMs:
            body.estimatedDurationMs == null && nested.estimatedDurationMs == null
                ? null
                : Number(body.estimatedDurationMs ?? nested.estimatedDurationMs),
        orderFixed: body.orderFixed !== false && nested.orderFixed !== false,
        movementStandards,
        requiredWork,
        penalties,
        roxzone:
            (body.roxzone && typeof body.roxzone === 'object' && body.roxzone) ||
            (nested.roxzone && typeof nested.roxzone === 'object' && nested.roxzone) ||
            { timingDefined: false },
        evidence: { required: true, virtualCannotCreateRealWorldEvidence: true },
    };
}

function parseCategoryLoads(raw) {
    if (!Array.isArray(raw)) return null;
    return raw
        .slice(0, 24)
        .map((row) => ({
            station: clean(row.station || row.title, 80),
            openMen: clean(row.openMen || row.open_men, 40) || null,
            openWomen: clean(row.openWomen || row.open_women, 40) || null,
            doubles: clean(row.doubles, 40) || null,
        }))
        .filter((row) => row.station);
}

function assertStationWork(station) {
    if (station.segment_type === 'run' && !(station.distance_m > 0)) {
        throw invalid(`Run station ${station.station_key} needs distanceM`, ['stations']);
    }
    if (station.segment_type === 'station') {
        const hasWork = station.distance_m > 0 || station.repetitions > 0;
        if (!hasWork) {
            throw invalid(`Station ${station.station_key} needs distanceM or repetitions`, ['stations']);
        }
        if (LOAD_STATIONS.has(station.station_key) && !(station.load_kg > 0)) {
            throw invalid(`Station ${station.station_key} needs loadKg`, ['stations']);
        }
    }
}

module.exports = {
    EVENT_TYPES,
    SPORT_TYPES,
    DIVISIONS,
    CATEGORIES,
    DIFFICULTIES,
    VISIBILITIES,
    SEGMENT_TYPES,
    coachEventForm,
    parseCoachEvent,
    assertStationWork,
};
