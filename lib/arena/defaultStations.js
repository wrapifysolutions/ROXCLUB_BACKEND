const DEFAULT_HYBRID_STATIONS = [
    {
        sequence: 1,
        segment_type: 'run',
        station_key: 'run_1',
        title: 'Run 1',
        distance_m: 1000,
        instructions: 'Run 1000 m to the next station.',
    },
    {
        sequence: 2,
        segment_type: 'station',
        station_key: 'ski_erg',
        title: 'Ski Ergometer',
        distance_m: 1000,
        instructions: 'SkiErg 1000 m.',
    },
    {
        sequence: 3,
        segment_type: 'run',
        station_key: 'run_2',
        title: 'Run 2',
        distance_m: 1000,
        instructions: 'Run 1000 m to the next station.',
    },
    {
        sequence: 4,
        segment_type: 'station',
        station_key: 'sled_push',
        title: 'Sled Push',
        distance_m: 50,
        load_kg: 50,
        instructions: 'Push the sled 50 m.',
    },
    {
        sequence: 5,
        segment_type: 'run',
        station_key: 'run_3',
        title: 'Run 3',
        distance_m: 1000,
        instructions: 'Run 1000 m to the next station.',
    },
    {
        sequence: 6,
        segment_type: 'station',
        station_key: 'sled_pull',
        title: 'Sled Pull',
        distance_m: 50,
        load_kg: 50,
        instructions: 'Pull the sled 50 m.',
    },
    {
        sequence: 7,
        segment_type: 'run',
        station_key: 'run_4',
        title: 'Run 4',
        distance_m: 1000,
        instructions: 'Run 1000 m to the next station.',
    },
    {
        sequence: 8,
        segment_type: 'station',
        station_key: 'burpee_broad_jump',
        title: 'Burpee Broad Jump',
        distance_m: 80,
        instructions: 'Burpee broad jump 80 m.',
    },
    {
        sequence: 9,
        segment_type: 'run',
        station_key: 'run_5',
        title: 'Run 5',
        distance_m: 1000,
        instructions: 'Run 1000 m to the next station.',
    },
    {
        sequence: 10,
        segment_type: 'station',
        station_key: 'row',
        title: 'Row',
        distance_m: 1000,
        instructions: 'Row 1000 m.',
    },
    {
        sequence: 11,
        segment_type: 'run',
        station_key: 'run_6',
        title: 'Run 6',
        distance_m: 1000,
        instructions: 'Run 1000 m to the next station.',
    },
    {
        sequence: 12,
        segment_type: 'station',
        station_key: 'farmers_carry',
        title: 'Farmers Carry',
        distance_m: 200,
        load_kg: 24,
        instructions: 'Farmers carry 200 m.',
    },
    {
        sequence: 13,
        segment_type: 'run',
        station_key: 'run_7',
        title: 'Run 7',
        distance_m: 1000,
        instructions: 'Run 1000 m to the next station.',
    },
    {
        sequence: 14,
        segment_type: 'station',
        station_key: 'sandbag_lunges',
        title: 'Sandbag Lunges',
        distance_m: 100,
        load_kg: 20,
        instructions: 'Walking lunges 100 m with sandbag.',
    },
    {
        sequence: 15,
        segment_type: 'run',
        station_key: 'run_8',
        title: 'Run 8',
        distance_m: 1000,
        instructions: 'Run 1000 m to the last station.',
    },
    {
        sequence: 16,
        segment_type: 'station',
        station_key: 'wall_balls',
        title: 'Wall Balls',
        repetitions: 100,
        load_kg: 6,
        instructions: 'Complete 100 wall balls.',
    },
];

function defaultByKey(key) {
    return DEFAULT_HYBRID_STATIONS.find((row) => row.station_key === key) || null;
}

function defaultBySequence(sequence) {
    return DEFAULT_HYBRID_STATIONS.find((row) => row.sequence === Number(sequence)) || null;
}

module.exports = {
    DEFAULT_HYBRID_STATIONS,
    defaultByKey,
    defaultBySequence,
};
