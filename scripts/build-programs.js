const fs = require('fs');
const path = require('path');

const workouts = {
    wk_foundation_a: { id: 'wk_foundation_a', title: 'Foundation Protocol A', durationMin: 45, category: 'strength' },
    wk_zone2_run: { id: 'wk_zone2_run', title: 'Zone 2 Run', durationMin: 40, category: 'engine' },
    wk_engine_intervals: { id: 'wk_engine_intervals', title: 'Engine Intervals', durationMin: 35, category: 'engine' },
    wk_foundation_b: { id: 'wk_foundation_b', title: 'Foundation Protocol B', durationMin: 45, category: 'strength' },
    wk_simulation: { id: 'wk_simulation', title: 'Race Simulation', durationMin: 50, category: 'race' },
    wk_hybrid_base: { id: 'wk_hybrid_base', title: 'Hybrid Base', durationMin: 40, category: 'hybrid' },
    wk_hybrid_engine: { id: 'wk_hybrid_engine', title: 'Hybrid Engine', durationMin: 45, category: 'hybrid' },
    wk_general_a: { id: 'wk_general_a', title: 'Full Body A', durationMin: 40, category: 'strength' },
    wk_easy_cardio: { id: 'wk_easy_cardio', title: 'Easy Cardio', durationMin: 30, category: 'engine' },
};

function weeksFrom(patterns, count) {
    return Array.from({ length: count }, (_, index) => ({
        week: index + 1,
        days: patterns[index % patterns.length].map((workoutId, dayIndex) => ({
            day: dayIndex + 1,
            workoutId,
        })),
    }));
}

const raceWeek1 = [
    'wk_foundation_a',
    'wk_zone2_run',
    'wk_engine_intervals',
    'wk_foundation_b',
    'wk_zone2_run',
    'wk_simulation',
];

const programs = {
    race_build_12w: {
        id: 'race_build_12w',
        name: 'Race Build 12 Week',
        weeks: weeksFrom(
            [
                raceWeek1,
                ['wk_foundation_b', 'wk_zone2_run', 'wk_engine_intervals', 'wk_foundation_a', 'wk_simulation', 'wk_zone2_run'],
                ['wk_engine_intervals', 'wk_foundation_a', 'wk_zone2_run', 'wk_simulation', 'wk_foundation_b', 'wk_zone2_run'],
            ],
            12
        ),
    },
    hyrox_base_8w: {
        id: 'hyrox_base_8w',
        name: 'HYROX Base 8 Week',
        weeks: weeksFrom(
            [[
                'wk_foundation_a',
                'wk_zone2_run',
                'wk_foundation_b',
                'wk_easy_cardio',
                'wk_simulation',
            ]],
            8
        ),
    },
    hyrox_peak_8w: {
        id: 'hyrox_peak_8w',
        name: 'HYROX Peak 8 Week',
        weeks: weeksFrom(
            [[
                'wk_foundation_b',
                'wk_engine_intervals',
                'wk_simulation',
                'wk_zone2_run',
            ]],
            8
        ),
    },
    hybrid_base_8w: {
        id: 'hybrid_base_8w',
        name: 'Hybrid Base 8 Week',
        weeks: weeksFrom(
            [[
                'wk_hybrid_base',
                'wk_zone2_run',
                'wk_hybrid_base',
            ]],
            8
        ),
    },
    hybrid_engine_12w: {
        id: 'hybrid_engine_12w',
        name: 'Hybrid Engine 12 Week',
        weeks: weeksFrom(
            [[
                'wk_hybrid_engine',
                'wk_zone2_run',
                'wk_hybrid_base',
                'wk_engine_intervals',
            ]],
            12
        ),
    },
    hybrid_race_8w: {
        id: 'hybrid_race_8w',
        name: 'Hybrid Race 8 Week',
        weeks: weeksFrom(
            [[
                'wk_hybrid_engine',
                'wk_simulation',
                'wk_engine_intervals',
            ]],
            8
        ),
    },
    general_start_8w: {
        id: 'general_start_8w',
        name: 'General Start 8 Week',
        weeks: weeksFrom(
            [[
                'wk_general_a',
                'wk_easy_cardio',
                'wk_general_a',
            ]],
            8
        ),
    },
    general_build_8w: {
        id: 'general_build_8w',
        name: 'General Build 8 Week',
        weeks: weeksFrom(
            [[
                'wk_general_a',
                'wk_easy_cardio',
                'wk_hybrid_base',
                'wk_zone2_run',
            ]],
            8
        ),
    },
    general_perform_8w: {
        id: 'general_perform_8w',
        name: 'General Perform 8 Week',
        weeks: weeksFrom(
            [[
                'wk_hybrid_engine',
                'wk_engine_intervals',
                'wk_general_a',
            ]],
            8
        ),
    },
};

const doc = { workouts, programs };
const target = path.join(__dirname, '..', 'data', 'programs.json');
fs.writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`);
console.log('wrote', target);
