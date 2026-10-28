function fileKey(relativePath) {
    const name = String(relativePath || '').split('/').pop() || '';
    return name.replace(/\.[a-z0-9]+$/i, '');
}

function toActivityDto(activity) {
    const dto = {
        order: activity.order,
        kind: activity.kind,
        name: activity.name,
        iconKey: fileKey(activity.iconUrl),
        iconUrl: null,
        label: activity.label,
        target: { ...activity.target },
    };
    if (activity.notes) dto.notes = activity.notes;
    if (activity.loadRule) dto.loadRule = activity.loadRule;
    if (activity.paceIntensity) dto.paceIntensity = activity.paceIntensity;
    if (activity.movementId) dto.movementId = activity.movementId;
    return dto;
}

function toWorkoutDetail(workout, categoryName, isSaved) {
    const activities = workout.activities.map(toActivityDto);
    const dto = {
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
    if (workout.format) dto.format = workout.format;
    if (workout.source) dto.source = workout.source;
    if (Array.isArray(workout.instructions) && workout.instructions.length > 0) {
        dto.instructions = [...workout.instructions];
    }
    return dto;
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

function toWorkoutListItem(workout, categoryName) {
    return {
        id: workout.id,
        title: workout.title,
        durationMin: workout.durationMin,
        difficulty: workout.difficulty,
        categoryName: categoryName || null,
        type: workout.type,
        imageUrl: null,
    };
}

module.exports = {
    toWorkoutDetail,
    toSavedWorkoutSummary,
    toWorkoutListItem,
};
