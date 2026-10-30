const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    validate,
    phaseForWeek,
    REQUIRED_TOTAL,
    REQUIRED_WEEKS,
    REQUIRED_PER_WEEK,
} = require('../scripts/validate_race_build_coach_schedule');
const { contentStatus, getPublicDefinition } = require('../lib/programs/publicCatalog');

const templatePath = path.join(
    __dirname,
    '..',
    'content',
    'programs',
    'race_build_12w',
    'coach-schedule.template.json'
);

test('Race Build coach template has 36 empty slots with correct phases', () => {
    const doc = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    assert.equal(doc.meta.requiredAssignments, 36);
    assert.equal(doc.assignments.length, REQUIRED_TOTAL);
    assert.equal(doc.meta.status, 'template_empty');

    for (let week = 1; week <= REQUIRED_WEEKS; week += 1) {
        const rows = doc.assignments.filter((row) => row.weekNumber === week);
        assert.equal(rows.length, REQUIRED_PER_WEEK);
        for (const row of rows) {
            assert.equal(row.programId, 'race_build_12w');
            assert.equal(row.phase, phaseForWeek(week));
            assert.equal(row.workoutId, null);
            assert.equal(row.dayOfWeek, null);
            assert.equal(row.coachApprovalStatus, 'pending');
            assert.equal(row.approvalVersion, null);
            assert.equal(row.approvedBy, null);
            assert.equal(row.approvedAt, null);
        }
    }
});

test('empty template fails validation and does not enable enrollment', () => {
    const doc = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    const report = validate(doc.assignments);
    assert.equal(report.ok, false);
    assert.equal(report.enrollmentRemainsBlocked, true);
    assert.ok(report.errors.some((error) => error.code === 'WORKOUT_REQUIRED'));
    assert.ok(report.errors.some((error) => error.code === 'NOT_APPROVED'));
    assert.equal(contentStatus(getPublicDefinition('race_build_12w')).enrollable, false);
});

test('CSV template exists alongside JSON template', () => {
    const csvPath = path.join(
        __dirname,
        '..',
        'content',
        'programs',
        'race_build_12w',
        'coach-schedule.template.csv'
    );
    assert.equal(fs.existsSync(csvPath), true);
    const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
    assert.equal(lines.length, 37);
    assert.match(lines[0], /programId,weekNumber,phase,dayOfWeek,workoutId/);
});
