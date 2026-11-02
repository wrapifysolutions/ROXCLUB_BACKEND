const MAX_GOAL_MS = 24 * 60 * 60 * 1000;
const MIN_PACE_MS = 90 * 1000;
const MAX_PACE_MS = 30 * 60 * 1000;

function httpError(code, status, message, extra = {}) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    Object.assign(error, extra);
    return error;
}

function pad(value) {
    return String(value).padStart(2, '0');
}

function formatClock(ms) {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
    const total = Math.round(ms);
    const hours = Math.floor(total / 3600000);
    const minutes = Math.floor((total % 3600000) / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const millis = total % 1000;
    if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    if (millis) return `${pad(minutes)}:${pad(seconds)}.${String(millis).padStart(3, '0')}`;
    return `${pad(minutes)}:${pad(seconds)}`;
}

function parseClock(value, { field, minMs = 1, maxMs = MAX_GOAL_MS } = {}) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        if (value < minMs || value > maxMs) {
            throw httpError('INVALID_TIME', 400, `${field} is outside the allowed range`);
        }
        return value;
    }
    const text = String(value).trim();
    const match = text.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) {
        throw httpError('INVALID_TIME', 400, `${field} must be a positive clock time such as 02:42:16`);
    }
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const millis = Number((match[4] || '0').padEnd(3, '0'));
    if (minutes > 59 || seconds > 59) {
        throw httpError('INVALID_TIME', 400, `${field} contains an invalid minute or second`);
    }
    const ms = hours * 3600000 + minutes * 60000 + seconds * 1000 + millis;
    if (ms < minMs || ms > maxMs) {
        throw httpError('INVALID_TIME', 400, `${field} is outside the allowed range`);
    }
    return ms;
}

function parsePace(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        if (value < MIN_PACE_MS || value > MAX_PACE_MS) {
            throw httpError('INVALID_PACE', 400, 'runPace must be between 1:30 and 30:00 per kilometre');
        }
        return value;
    }
    const text = String(value).trim().replace(/\s*min\/km$/i, '');
    const match = text.match(/^(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) {
        throw httpError('INVALID_PACE', 400, 'runPace must be a min/km clock such as 02:42');
    }
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const millis = Number((match[3] || '0').padEnd(3, '0'));
    if (seconds > 59) throw httpError('INVALID_PACE', 400, 'runPace seconds must be 0-59');
    const ms = minutes * 60000 + seconds * 1000 + millis;
    if (ms < MIN_PACE_MS || ms > MAX_PACE_MS) {
        throw httpError('INVALID_PACE', 400, 'runPace must be between 1:30 and 30:00 per kilometre');
    }
    return ms;
}

function displayTime(ms) {
    return {
        milliseconds: ms == null ? null : ms,
        clock: formatClock(ms),
    };
}

function displayPace(ms) {
    if (ms == null) return { millisecondsPerKm: null, clock: null, unit: 'min/km' };
    return {
        millisecondsPerKm: ms,
        clock: formatClock(ms),
        unit: 'min/km',
    };
}

module.exports = {
    httpError,
    formatClock,
    parseClock,
    parsePace,
    displayTime,
    displayPace,
    MAX_GOAL_MS,
    MIN_PACE_MS,
    MAX_PACE_MS,
};
