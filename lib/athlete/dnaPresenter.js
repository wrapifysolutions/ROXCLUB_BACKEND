const CORE_KEYS = ['endurance', 'engine', 'strength', 'power', 'speed'];
const SPEED_PENDING = 'ATHLETE_DNA_SPEED_FORMULA_NOT_APPROVED';
const WEIGHTS_PENDING = 'ATHLETE_DNA_WEIGHTS_NOT_APPROVED';

function numberOrNull(value) {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function attributeSlot(value, options = {}) {
    const current = numberOrNull(value);
    const peak = numberOrNull(options.peak);
    const pending = options.pending != null ? options.pending : current == null;
    return {
        current,
        peak,
        available: current != null,
        pending,
        reason: options.reason || (pending ? WEIGHTS_PENDING : null),
    };
}

function emptyDna() {
    return {
        status: 'CALIBRATING',
        modelVersion: 'v0',
        visibleNumeric: false,
        pendingModel: true,
        reason: WEIGHTS_PENDING,
        attributes: {
            endurance: attributeSlot(null),
            engine: attributeSlot(null),
            strength: attributeSlot(null),
            power: attributeSlot(null),
            speed: attributeSlot(null, { reason: SPEED_PENDING }),
        },
        legacy: {
            mobility: {
                current: null,
                peak: null,
                available: false,
                notACoreAttribute: true,
                notSpeed: true,
                preserved: true,
            },
        },
    };
}

function presentAthleteDna(row) {
    if (!row) return emptyDna();
    const attributes = {
        endurance: attributeSlot(row.endurance, { peak: row.peak_endurance }),
        engine: attributeSlot(row.engine, { peak: row.peak_engine }),
        strength: attributeSlot(row.strength, { peak: row.peak_strength }),
        power: attributeSlot(row.power, { peak: row.peak_power }),
        speed: attributeSlot(row.speed, {
            peak: row.peak_speed,
            reason: row.speed == null ? SPEED_PENDING : null,
        }),
    };
    const coreNumeric = CORE_KEYS.some((key) => attributes[key].current != null);
    const status = row.status || 'CALIBRATING';
    const visibleNumeric = coreNumeric && status !== 'CALIBRATING';
    return {
        status,
        modelVersion: row.model_version || row.modelVersion || 'v0',
        visibleNumeric,
        pendingModel: !coreNumeric || status === 'CALIBRATING' || attributes.speed.pending,
        reason: coreNumeric ? (attributes.speed.pending ? SPEED_PENDING : null) : WEIGHTS_PENDING,
        attributes,
        legacy: {
            mobility: {
                current: numberOrNull(row.mobility),
                peak: numberOrNull(row.peak_mobility),
                available: numberOrNull(row.mobility) != null,
                notACoreAttribute: true,
                notSpeed: true,
                preserved: true,
            },
        },
    };
}

function compactCoreValues(presented) {
    return {
        endurance: presented.attributes.endurance.current,
        engine: presented.attributes.engine.current,
        strength: presented.attributes.strength.current,
        power: presented.attributes.power.current,
        speed: presented.attributes.speed.current,
    };
}

module.exports = {
    CORE_KEYS,
    SPEED_PENDING,
    WEIGHTS_PENDING,
    emptyDna,
    presentAthleteDna,
    compactCoreValues,
    attributeSlot,
};
