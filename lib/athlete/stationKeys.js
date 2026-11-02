const STATION_KEYS = [
    'ski_erg',
    'sled_push',
    'sled_pull',
    'burpee_broad_jump',
    'row',
    'farmers_carry',
    'sandbag_lunges',
    'wall_balls',
];

function stationKeyFromName(name) {
    const text = String(name || '').toLowerCase();
    if (text.includes('ski')) return 'ski_erg';
    if (text.includes('sled') && text.includes('push')) return 'sled_push';
    if (text.includes('sled') && text.includes('pull')) return 'sled_pull';
    if (text.includes('burpee')) return 'burpee_broad_jump';
    if (text.includes('row')) return 'row';
    if (text.includes('farmer')) return 'farmers_carry';
    if (text.includes('lunge')) return 'sandbag_lunges';
    if (text.includes('wall')) return 'wall_balls';
    return null;
}

module.exports = { STATION_KEYS, stationKeyFromName };
