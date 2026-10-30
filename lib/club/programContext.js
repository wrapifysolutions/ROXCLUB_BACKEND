async function loadAssignedCoachProgram(versionId, query) {
    if (!versionId) return null;
    const { rows } = await query(
        `
        /* club:plan_program */
        SELECT p.id AS program_id, p.title, v.duration_weeks, v.id AS version_id
        FROM coach_program_versions v
        JOIN coach_programs p ON p.id = v.program_id
        WHERE v.id = $1
        `,
        [versionId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
        programId: row.program_id,
        title: row.title,
        durationWeeks: Number(row.duration_weeks) || 1,
        versionId: row.version_id,
    };
}

module.exports = { loadAssignedCoachProgram };
