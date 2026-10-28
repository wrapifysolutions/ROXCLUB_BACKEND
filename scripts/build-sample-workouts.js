const fs = require('fs');
const path = require('path');

const difficulties = ['Beginner', 'Intermediate', 'Advanced'];

function act(order, kind, name, icon, label, target) {
    return {
        order,
        kind,
        name,
        iconUrl: `icons/${icon}.png`,
        label,
        target,
    };
}

const CATEGORY_TAGS = {
    cat_hybrid_race: ['HYROX', 'Run', 'Stations'],
    cat_track: ['Road', 'Track', 'Intervals'],
    cat_strength: ['Gym', 'Strength', 'Barbell'],
    cat_ergs: ['SkiErg', 'Row', 'Intervals'],
    cat_power: ['Explosive', 'Stations', 'Power'],
    cat_aerobic: ['Road', 'Zone 2', 'Endurance'],
    cat_conditioning: ['Mixed', 'Circuits', 'Stations'],
    cat_recovery: ['Mobility', 'Easy', 'Recovery'],
};

let nextSortOrder = 1;

function base(id, categoryId, slug, type, title, durationMin, difficulty, purpose, activities, extra = {}) {
    const sortOrder = nextSortOrder;
    nextSortOrder += 1;
    return {
        id,
        categoryId,
        type,
        title,
        imageUrl: `/workouts/placeholder-${slug}.jpg`,
        durationMin,
        difficulty,
        author: 'ROX CLUB',
        equipment: extra.equipment || 'Full kit',
        purpose,
        tags: extra.tags || CATEGORY_TAGS[categoryId] || [],
        sortOrder,
        showInLibrary: extra.showInLibrary !== false,
        isSample: true,
        xp: extra.xp == null ? null : extra.xp,
        activities,
    };
}

const foundation = {
    id: 'wk_foundation_a',
    categoryId: 'cat_hybrid_race',
    type: 'hybrid',
    title: 'Foundation Protocol A',
    imageUrl: '/workouts/placeholder-hybrid-race.jpg',
    durationMin: 45,
    difficulty: 'Intermediate',
    author: 'ROX CLUB',
    equipment: 'Full kit',
    purpose: 'Open the HYROX engine with the full station sequence at foundation loads.',
    tags: CATEGORY_TAGS.cat_hybrid_race,
    sortOrder: nextSortOrder++,
    showInLibrary: true,
    isSample: true,
    activities: [
        act(1, 'run', 'Running', 'run', '1 km', { distanceM: 1000 }),
        act(2, 'station', 'Wall Balls', 'wall-ball', '20 reps', { reps: 20 }),
        act(3, 'station', 'Sandbag Lunges', 'sandbag', '30 m (20 kg)', { distanceM: 30, loadKg: 20 }),
        act(4, 'station', 'Burpee Broad Jump', 'burpee', '10 reps', { reps: 10 }),
        act(5, 'station', 'Sled Push', 'sled', '20 m (102 kg)', { distanceM: 20, loadKg: 102 }),
        act(6, 'station', 'Row', 'row', '500 m', { distanceM: 500 }),
        act(7, 'station', 'SkiErg', 'skierg', '1 km', { distanceM: 1000 }),
        act(8, 'station', 'Farmers Carry', 'farmers', '20 m (2x32 kg)', { distanceM: 20, loadKg: 32 }),
    ],
};

const raceStations = [
    ['SkiErg', 'skierg', '1 km', { distanceM: 1000 }],
    ['Sled Push', 'sled', '20 m (102 kg)', { distanceM: 20, loadKg: 102 }],
    ['Sled Pull', 'sled', '20 m (78 kg)', { distanceM: 20, loadKg: 78 }],
    ['Burpee Broad Jump', 'burpee', '80 m', { distanceM: 80 }],
    ['Row', 'row', '500 m', { distanceM: 500 }],
    ['Farmers Carry', 'farmers', '200 m (2x24 kg)', { distanceM: 200, loadKg: 24 }],
    ['Sandbag Lunges', 'sandbag', '100 m (20 kg)', { distanceM: 100, loadKg: 20 }],
    ['Wall Balls', 'wall-ball', '100 reps', { reps: 100 }],
];

function hybridRace(index) {
    const pairs = [2, 3, 4, 4][index];
    const activities = [];
    for (let i = 0; i < pairs; i += 1) {
        const station = raceStations[(index + i) % raceStations.length];
        activities.push(act(activities.length + 1, 'run', 'Running', 'run', '1 km', { distanceM: 1000 }));
        activities.push(act(activities.length + 1, 'station', station[0], station[1], station[2], station[3]));
    }
    const minutes = pairs * 12;
    return base(
        `wk_hybrid_0${index + 1}`,
        'cat_hybrid_race',
        'hybrid-race',
        'hybrid',
        ['Race Intro', 'Station Builder', 'Mixed Relay', 'Full Send'][index],
        minutes,
        difficulties[index % 3],
        '1 km runs alternating with HYROX stations.',
        activities
    );
}

function track(index) {
    const plans = [
        {
            title: 'Track Primer',
            minutes: 25,
            activities: [
                act(1, 'run', 'Warm-up', 'run', '1 km easy, 6:30 /km', { distanceM: 1000, durationSec: 390 }),
                act(2, 'run', 'Strides', 'run', '4 x 100 m, relaxed', { distanceM: 400, durationSec: 90 }),
            ],
        },
        {
            title: '400 Repeats',
            minutes: 40,
            activities: [
                act(1, 'run', 'Warm-up', 'run', '1.5 km easy', { distanceM: 1500, durationSec: 540 }),
                act(2, 'run', 'Intervals', 'run', '6 x 400 m @ 3:40 /km', { distanceM: 2400, durationSec: 530 }),
                act(3, 'run', 'Cool-down', 'run', '1 km easy', { distanceM: 1000, durationSec: 390 }),
            ],
        },
        {
            title: 'Tempo Kilometres',
            minutes: 45,
            activities: [
                act(1, 'run', 'Warm-up', 'run', '2 km easy', { distanceM: 2000, durationSec: 720 }),
                act(2, 'run', 'Tempo', 'run', '4 x 1 km @ 4:30 /km', { distanceM: 4000, durationSec: 1080 }),
                act(3, 'run', 'Cool-down', 'run', '1 km easy', { distanceM: 1000, durationSec: 360 }),
            ],
        },
        {
            title: 'Speed Endurance',
            minutes: 50,
            activities: [
                act(1, 'run', 'Warm-up', 'run', '2 km + drills', { distanceM: 2000, durationSec: 780 }),
                act(2, 'run', 'Reps', 'run', '5 x 800 m @ 3:50 /km', { distanceM: 4000, durationSec: 920 }),
                act(3, 'run', 'Cool-down', 'run', '1 km jog', { distanceM: 1000, durationSec: 420 }),
            ],
        },
        {
            title: 'Race Pace Sharpening',
            minutes: 35,
            activities: [
                act(1, 'run', 'Warm-up', 'run', '1 km easy', { distanceM: 1000, durationSec: 360 }),
                act(2, 'run', 'Race pace', 'run', '3 x 1 km @ goal pace', { distanceM: 3000, durationSec: 780 }),
                act(3, 'run', 'Cool-down', 'run', '800 m easy', { distanceM: 800, durationSec: 300 }),
            ],
        },
    ];
    const plan = plans[index];
    return base(
        `wk_track_0${index + 1}`,
        'cat_track',
        'track',
        'run',
        plan.title,
        plan.minutes,
        difficulties[index % 3],
        'Track session with warm-up, work, and notes on pace.',
        plan.activities,
        { equipment: 'Spikes or trainers' }
    );
}

function strength(index) {
    const plans = [
        ['Lower Base', 40, [['Back Squat', 3, 8, 60, 90], ['Romanian Deadlift', 3, 8, 50, 90], ['Split Squat', 3, 8, 20, 60]]],
        ['Upper Builder', 45, [['Bench Press', 4, 6, 50, 120], ['Bent-over Row', 4, 8, 40, 90], ['Overhead Press', 3, 8, 30, 90]]],
        ['Posterior Chain', 50, [['Deadlift', 5, 3, 100, 180], ['Hip Thrust', 3, 8, 80, 90], ['Hamstring Curl', 3, 10, 30, 60]]],
        ['Full Body Strength', 55, [['Front Squat', 4, 5, 70, 150], ['Pull-up', 4, 6, 0, 120], ['Walking Lunge', 3, 10, 24, 90]]],
        ['Heavy Doubles', 35, [['Back Squat', 6, 2, 110, 180], ['Bench Press', 6, 2, 70, 180]]],
    ];
    const [title, minutes, moves] = plans[index];
    return base(
        `wk_strength_0${index + 1}`,
        'cat_strength',
        'strength',
        'strength',
        title,
        minutes,
        difficulties[index % 3],
        'Strength session with sets, reps, load, and rest.',
        moves.map((move, moveIndex) =>
            act(moveIndex + 1, 'strength_exercise', move[0], 'strength', `${move[1]} x ${move[2]} @ ${move[3]} kg`, {
                sets: move[1],
                reps: move[2],
                loadKg: move[3],
                restSec: move[4],
            })
        ),
        { equipment: 'Barbell and rack' }
    );
}

function ergs(index) {
    const blocks = [
        ['SkiErg Primer', 20, [['SkiErg', 500, 120], ['Row', 500, 120]]],
        ['Erg Intervals', 30, [['SkiErg', 250, 60], ['Row', 250, 60], ['SkiErg', 250, 60], ['Row', 250, 60]]],
        ['SkiErg Threshold', 35, [['SkiErg', 1000, 240], ['SkiErg', 1000, 240], ['Row', 1000, 240]]],
        ['Row Repeats', 40, [['Row', 500, 110], ['Row', 500, 110], ['Row', 500, 110], ['SkiErg', 1000, 240]]],
        ['Mixed Erg Finisher', 25, [['SkiErg', 500, 120], ['Row', 500, 120], ['SkiErg', 250, 55]]],
    ];
    const [title, minutes, pieces] = blocks[index];
    return base(
        `wk_ergs_0${index + 1}`,
        'cat_ergs',
        'ergs',
        'hybrid',
        title,
        minutes,
        difficulties[index % 3],
        'SkiErg and Row intervals.',
        pieces.map((piece, pieceIndex) =>
            act(
                pieceIndex + 1,
                'station',
                piece[0],
                piece[0] === 'Row' ? 'row' : 'skierg',
                `${piece[1]} m`,
                { distanceM: piece[1], durationSec: piece[2] }
            )
        ),
        { equipment: 'SkiErg and rower' }
    );
}

function power(index) {
    const plans = [
        ['Power Primer', 20, [['Wall Balls', { reps: 15 }], ['Burpee Broad Jump', { reps: 8 }], ['Sled Push', { distanceM: 15, loadKg: 70 }]]],
        ['Jump Repeat', 25, [['Burpee Broad Jump', { reps: 10 }], ['Wall Balls', { reps: 20 }], ['Burpee Broad Jump', { reps: 10 }]]],
        ['Sled Power', 30, [['Sled Push', { distanceM: 20, loadKg: 102 }], ['Wall Balls', { reps: 15 }], ['Sled Push', { distanceM: 20, loadKg: 120 }]]],
        ['Explosive Circuit', 35, [['Wall Balls', { reps: 20 }], ['Sled Push', { distanceM: 20, loadKg: 102 }], ['Burpee Broad Jump', { reps: 12 }], ['Wall Balls', { reps: 20 }]]],
        ['Peak Power', 15, [['Burpee Broad Jump', { reps: 6 }], ['Sled Push', { distanceM: 10, loadKg: 140 }]]],
    ];
    const [title, minutes, moves] = plans[index];
    const icons = { 'Wall Balls': 'wall-ball', 'Burpee Broad Jump': 'burpee', 'Sled Push': 'sled' };
    return base(
        `wk_power_0${index + 1}`,
        'cat_power',
        'power',
        'hybrid',
        title,
        minutes,
        difficulties[index % 3],
        'Explosive stations: wall balls, broad jumps, and sled pushes.',
        moves.map((move, moveIndex) => {
            const target = move[1];
            const label = target.reps
                ? `${target.reps} reps`
                : `${target.distanceM} m (${target.loadKg} kg)`;
            return act(moveIndex + 1, 'station', move[0], icons[move[0]], label, target);
        })
    );
}

function aerobic(index) {
    if (index === 0) {
        return base(
            'wk_zone2_run',
            'cat_aerobic',
            'aerobic',
            'run',
            'Zone 2 Run',
            40,
            'Beginner',
            'Easy aerobic running to build the base under race pace.',
            [act(1, 'run', 'Zone 2 Run', 'run', '5 km, Zone 2, easy pace', { distanceM: 5000, durationSec: 2400 })],
            { equipment: 'Watch' }
        );
    }
    const plans = [
        ['Easy Spin Out', 30, 4000, 1800, '4 km easy, conversational'],
        ['Long Easy', 70, 10000, 4200, '10 km Zone 2'],
        ['Steady Aerobic', 55, 8000, 3000, '8 km steady, nose breathing'],
        ['Recovery Miles', 35, 5000, 2100, '5 km very easy'],
    ];
    const plan = plans[index - 1];
    return base(
        `wk_aerobic_0${index}`,
        'cat_aerobic',
        'aerobic',
        'run',
        plan[0],
        plan[1],
        difficulties[index % 3],
        'Zone 2 and long easy running.',
        [act(1, 'run', plan[0], 'run', plan[4], { distanceM: plan[2], durationSec: plan[3] })],
        { equipment: 'Watch' }
    );
}

function conditioning(index) {
    const rounds = [3, 4, 4, 5, 3][index];
    const activities = [];
    for (let round = 0; round < rounds; round += 1) {
        const station = raceStations[(index + round) % raceStations.length];
        activities.push(
            act(activities.length + 1, 'run', 'Short Run', 'run', '400 m', { distanceM: 400, durationSec: 120 })
        );
        activities.push(
            act(activities.length + 1, 'station', station[0], station[1], station[2], station[3])
        );
    }
    return base(
        `wk_conditioning_0${index + 1}`,
        'cat_conditioning',
        'conditioning',
        'hybrid',
        ['Chipper', 'Engine Circuit', 'Mixed Grinder', 'Station Ladder', 'Short Fuse'][index],
        rounds * 8,
        difficulties[index % 3],
        'Mixed circuits of short runs and stations.',
        activities
    );
}

function recovery(index) {
    const plans = [
        ['Easy Spin', 15, [['Easy Spin', 600], ['Breathing', 300]]],
        ['Mobility Flow', 20, [['Hip Flow', 480], ['Thoracic Openers', 420], ['Breathing', 300]]],
        ['Downshift', 25, [['Easy Bike', 900], ['Walk', 600]]],
        ['Breath Reset', 15, [['Box Breathing', 480], ['Easy Spin', 420]]],
        ['Flush and Stretch', 30, [['Easy Spin', 600], ['Mobility', 720], ['Breathing', 480]]],
    ];
    const [title, minutes, blocks] = plans[index];
    return base(
        `wk_recovery_0${index + 1}`,
        'cat_recovery',
        'recovery',
        'recovery',
        title,
        minutes,
        'Beginner',
        'Easy recovery blocks. This session earns 0 XP.',
        blocks.map((block, blockIndex) =>
            act(blockIndex + 1, 'recovery_block', block[0], 'bike', `${Math.round(block[1] / 60)} min`, {
                durationSec: block[1],
            })
        ),
        { equipment: 'Mat', xp: 0 }
    );
}

const samples = [
    foundation,
    ...[0, 1, 2, 3].map(hybridRace),
    ...[0, 1, 2, 3, 4].map(track),
    ...[0, 1, 2, 3, 4].map(strength),
    ...[0, 1, 2, 3, 4].map(ergs),
    ...[0, 1, 2, 3, 4].map(power),
    ...[0, 1, 2, 3, 4].map(aerobic),
    ...[0, 1, 2, 3, 4].map(conditioning),
    ...[0, 1, 2, 3, 4].map(recovery),
];

const workouts = samples;

for (const workout of workouts) {
    if (workout.xp == null) delete workout.xp;
}

const target = path.join(__dirname, '..', 'data', 'workouts.json');
fs.writeFileSync(target, `${JSON.stringify(workouts, null, 2)}\n`);
console.log(`wrote ${workouts.length} library workouts (program workouts stay in data/program-workouts.json)`);
