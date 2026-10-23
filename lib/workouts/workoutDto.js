function fileKey(relativePath) {
    const name = String(relativePath || '').split('/').pop() || '';
    return name.replace(/\.[a-z0-9]+$/i, '');
}

function toActivityDto(activity) {
    return {
        order: activity.order,
        kind: activity.kind,
        name: activity.name,
        iconKey: fileKey(activity.iconUrl),
        iconUrl: null,
        label: activity.label,
        target: { ...activity.target },
    };
}

function toWorkoutDetail(workout, categoryName, isSaved) {
    const activities = workout.activities.map(toActivityDto);
    return {
        id: workout.id,
        title: workout.title,
        categoryId: workout.categoryId,
        categoryName,
        type: workout.type,
        imageKey: workout.id,
        imageUrl: null,
        durationMin: workout.durationMin,
        difficulty: workout.difficulty,
        author: workout.author,
        equipment: workout.equipment,
        purpose: workout.purpose,
        activityCount: activities.length,
        activities,
        isSaved: Boolean(isSaved),
    };
}

function toSavedWorkoutSummary(workout) {
    return {
        id: workout.id,
        title: workout.title,
        imageKey: workout.id,
        imageUrl: null,
        durationMin: workout.durationMin,
        difficulty: workout.difficulty,
    };
}

module.exports = {
    toWorkoutDetail,
    toSavedWorkoutSummary,
};
