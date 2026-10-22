const PROGRAMS = {
    hyrox: {
        beginner: { key: 'hyrox_foundation', name: 'HYROX Foundation' },
        intermediate: { key: 'hyrox_build', name: 'HYROX Build' },
        advanced: { key: 'hyrox_race', name: 'HYROX Race' },
    },
    hybrid: {
        beginner: { key: 'hybrid_base', name: 'Hybrid Base' },
        intermediate: { key: 'hybrid_engine', name: 'Hybrid Engine' },
        advanced: { key: 'hybrid_race', name: 'Hybrid Race' },
    },
    general_fitness: {
        beginner: { key: 'general_start', name: 'General Fitness' },
        intermediate: { key: 'general_build', name: 'General Fitness' },
        advanced: { key: 'general_perform', name: 'General Fitness' },
    },
};

function normalizeGender(value) {
    const gender = String(value || '').trim().toLowerCase();
    if (gender === 'male' || gender === 'm') return 'male';
    if (gender === 'female' || gender === 'f') return 'female';
    return null;
}

function normalizeExperience(value) {
    const level = String(value || '').trim().toLowerCase();
    if (level === 'beginner' || level === 'intermediate' || level === 'advanced') {
        return level;
    }
    return null;
}

function normalizeRace(value) {
    const text = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ');
    if (!text) return null;
    if (text.includes('hyrox')) return 'hyrox';
    if (text.includes('hybrid')) return 'hybrid';
    if (text.includes('general') || text === 'fitness') return 'general_fitness';
    return null;
}

function raceLabel(event) {
    if (event === 'hyrox') return 'HYROX race';
    if (event === 'hybrid') return 'hybrid race';
    return 'general fitness';
}

function matchProgram(event, experience) {
    const group = PROGRAMS[event] || PROGRAMS.general_fitness;
    return group[experience] || group.beginner;
}

function readDate(value, { required = false, label = 'date', allowFuture = true } = {}) {
    if (value == null || String(value).trim() === '') {
        return required ? { error: `${label} is required` } : { value: null };
    }

    const text = String(value).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
        return { error: `${label} must be YYYY-MM-DD` };
    }

    if (!allowFuture && Date.parse(`${text}T00:00:00Z`) > Date.now()) {
        return { error: `${label} cannot be in the future` };
    }

    return { value: text };
}

function readMetric(value, { min, max, label }) {
    if (value == null || value === '') return { value: null };
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        return { error: `${label} must be between ${min} and ${max}` };
    }
    return { value: Math.round(number * 100) / 100 };
}

module.exports = {
    normalizeGender,
    normalizeExperience,
    normalizeRace,
    raceLabel,
    matchProgram,
    readDate,
    readMetric,
};
