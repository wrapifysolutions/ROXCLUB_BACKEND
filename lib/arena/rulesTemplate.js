const SCREEN_TITLE = 'Full Race Rules';

const LOAD_COLUMNS = [
    { key: 'station', label: 'Station' },
    { key: 'openMen', label: 'Open Men' },
    { key: 'openWomen', label: 'Open Women' },
    { key: 'doubles', label: 'Doubles' },
];

function ruleText(item) {
    if (typeof item === 'string') return item.trim();
    if (item && typeof item === 'object') return String(item.text || item.title || '').trim();
    return '';
}

function uniqueRules(items) {
    const seen = new Set();
    const out = [];
    for (const item of items || []) {
        const text = ruleText(item);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
    }
    return out;
}

function formatStationValue(station) {
    if (station.repetitions != null) return `${station.repetitions} reps`;
    if (station.distanceM >= 1000 && station.distanceM % 1000 === 0) {
        return `${station.distanceM / 1000} km`;
    }
    if (station.distanceM != null) return `${station.distanceM} m`;
    if (station.loadKg != null) return `${station.loadKg} kg`;
    return '';
}

function formatLoad(station) {
    if (station.loadKg != null) return `${station.loadKg} kg`;
    return formatStationValue(station);
}

function fallbackGeneralRules(rules, workCount, runCount) {
    const bullets = [];
    if (rules.orderFixed !== false) {
        bullets.push(`Complete ${runCount} runs and ${workCount} stations in the fixed order.`);
    }
    bullets.push(...(Array.isArray(rules.requiredWork) ? rules.requiredWork : []));
    bullets.push(...(Array.isArray(rules.movementStandards) ? rules.movementStandards : []));
    if (rules.evidence?.required) {
        bullets.push('Results are validated from supported evidence when required.');
    }
    if (rules.roxzone?.timingDefined) {
        bullets.push('Roxzone time is tracked separately and does not affect main results.');
    }
    bullets.push(...(Array.isArray(rules.penalties) ? rules.penalties : []));
    return uniqueRules(bullets);
}

function categoryLoadRows(coachRows, workStations, division) {
    if (Array.isArray(coachRows) && coachRows.length) {
        return coachRows
            .map((row) => ({
                station: String(row.station || row.title || '').trim(),
                openMen: String(row.openMen || row.open_men || '').trim() || null,
                openWomen: String(row.openWomen || row.open_women || '').trim() || null,
                doubles: String(row.doubles || '').trim() || null,
            }))
            .filter((row) => row.station);
    }
    return workStations.map((station) => {
        const load = formatLoad(station) || null;
        return {
            station: station.title,
            openMen: division === 'women' ? null : load,
            openWomen: division === 'men' ? null : load,
            doubles: division === 'mixed' ? load : null,
        };
    });
}

function athleteRulesTemplate({ event, rules, stations }) {
    const stored = rules && typeof rules === 'object' ? rules : {};
    const workStations = (stations || []).filter((station) => station.type === 'station');
    const runCount = (stations || []).filter((station) => station.type === 'run').length;
    const generalRules = Array.isArray(stored.generalRules)
        ? uniqueRules(stored.generalRules)
        : fallbackGeneralRules(stored, workStations.length, runCount);

    return {
        eventId: event.id,
        title: event.title,
        screenTitle: SCREEN_TITLE,
        aboutRules: stored.aboutRules || stored.overview || event.description || '',
        generalRules,
        categoryLoads: {
            columns: LOAD_COLUMNS,
            rows: categoryLoadRows(stored.categoryLoads, workStations, event.division),
        },
        stations: workStations.map((station) => ({
            key: station.key,
            title: station.title,
            value: formatStationValue(station),
        })),
    };
}

module.exports = {
    SCREEN_TITLE,
    LOAD_COLUMNS,
    uniqueRules,
    formatStationValue,
    athleteRulesTemplate,
};
