const workouts = require('../data/workouts.json');

const samples = workouts.filter((workout) => workout.isSample === true);

for (const workout of samples) {
    console.log(
        [
            workout.id,
            workout.categoryId,
            workout.type,
            workout.difficulty,
            `${workout.durationMin}min`,
            workout.title,
        ].join('\t')
    );
}

console.log(`\n${samples.length} sample workouts`);
