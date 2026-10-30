#!/usr/bin/env node
/**
 * READ-ONLY validator for a filled Race Build coach schedule.
 *
 * Does NOT:
 * - enable enrollment
 * - write public-programs.json / programs.json
 * - mutate user_programs or scheduled_sessions
 * - invent workout IDs
 *
 * Usage:
 *   node scripts/validate_race_build_coach_schedule.js [path/to/filled.json]
 *
 * Default path:
 *   content/programs/race_build_12w/coach-schedule.filled.json
 */

const fs = require('fs');
const path = require('path');
const { loadWorkoutCatalog, getWorkout } = require('../lib/workouts/workoutCatalog');
const { contentStatus, getPublicDefinition } = require('../lib/programs/publicCatalog');

const PROGRAM_ID = 'race_build_12w';
const REQUIRED_WEEKS = 12;
const REQUIRED_PER_WEEK = 3;
const REQUIRED_TOTAL = 36;
const PHASE_BANDS = [
    { name: 'Base', from: 1, to: 4 },
    { name: 'Build', from: 5, to: 9 },
    { name: 'Peak', from: 10, to: 11 },
    { name: 'Taper', from: 12, to: 12 },
];
const DAY_VALUES = new Set([
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
    'Sun',
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
]);

function phaseForWeek(weekNumber) {
    const band = PHASE_BANDS.find((item) => weekNumber >= item.from && weekNumber <= item.to);
    return band?.name || null;
}

function fail(errors, code, message, extra = {}) {
    errors.push({ code, message, ...extra });
}

function loadDocument(filePath) {
    if (!fs.existsSync(filePath)) {
        return {
            ok: false,
            errors: [
                {
                    code: 'FILE_MISSING',
                    message: `Schedule file not found: ${filePath}`,
                    hint: 'Copy coach-schedule.template.json to coach-schedule.filled.json and fill coach fields.',
                },
            ],
            report: null,
        };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const assignments = Array.isArray(raw) ? raw : raw.assignments;
    if (!Array.isArray(assignments)) {
        return {
            ok: false,
            errors: [{ code: 'INVALID_SHAPE', message: 'Document must include an assignments array' }],
            report: null,
        };
    }
    return { ok: true, errors: [], document: raw, assignments };
}

function validate(assignments) {
    loadWorkoutCatalog();
    const errors = [];
    const warnings = [];

    if (assignments.length !== REQUIRED_TOTAL) {
        fail(
            errors,
            'ASSIGNMENT_COUNT',
            `Expected ${REQUIRED_TOTAL} assignments (12×3), found ${assignments.length}`
        );
    }

    const byWeek = new Map();
    const weekDayKeys = new Set();
    const weekOrderKeys = new Set();

    for (let index = 0; index < assignments.length; index += 1) {
        const row = assignments[index] || {};
        const label = `index=${index}`;

        if (row.programId !== PROGRAM_ID) {
            fail(errors, 'PROGRAM_ID', `${label}: programId must be ${PROGRAM_ID}`, { row });
        }

        const week = Number(row.weekNumber);
        if (!Number.isInteger(week) || week < 1 || week > REQUIRED_WEEKS) {
            fail(errors, 'WEEK_NUMBER', `${label}: weekNumber must be 1–${REQUIRED_WEEKS}`, { row });
            continue;
        }

        const expectedPhase = phaseForWeek(week);
        if (row.phase !== expectedPhase) {
            fail(
                errors,
                'PHASE_MISMATCH',
                `${label}: week ${week} phase must be ${expectedPhase}, found ${row.phase}`,
                { row }
            );
        }

        const order = Number(row.sessionOrder);
        if (!Number.isInteger(order) || order < 1 || order > REQUIRED_PER_WEEK) {
            fail(errors, 'SESSION_ORDER', `${label}: sessionOrder must be 1–${REQUIRED_PER_WEEK}`, {
                row,
            });
        } else {
            const orderKey = `${week}:${order}`;
            if (weekOrderKeys.has(orderKey)) {
                fail(errors, 'DUPLICATE_SESSION_ORDER', `${label}: duplicate week/sessionOrder ${orderKey}`);
            }
            weekOrderKeys.add(orderKey);
        }

        if (row.dayOfWeek == null || row.dayOfWeek === '') {
            fail(errors, 'DAY_REQUIRED', `${label}: dayOfWeek is required for approval`, { row });
        } else if (!DAY_VALUES.has(row.dayOfWeek)) {
            fail(
                errors,
                'DAY_INVALID',
                `${label}: dayOfWeek must be Mon–Sun or 1–7`,
                { dayOfWeek: row.dayOfWeek }
            );
        } else {
            const dayKey = `${week}:${String(row.dayOfWeek)}`;
            if (weekDayKeys.has(dayKey)) {
                fail(errors, 'DUPLICATE_WEEK_DAY', `${label}: duplicate week/dayOfWeek ${dayKey}`);
            }
            weekDayKeys.add(dayKey);
        }

        if (!row.workoutId) {
            fail(errors, 'WORKOUT_REQUIRED', `${label}: workoutId is required for approval`, { row });
        } else {
            const workout = getWorkout(row.workoutId);
            if (!workout) {
                fail(
                    errors,
                    'WORKOUT_NOT_FOUND',
                    `${label}: workoutId ${row.workoutId} does not resolve in the playable catalog`
                );
            }
        }

        if (row.coachApprovalStatus !== 'approved') {
            fail(
                errors,
                'NOT_APPROVED',
                `${label}: coachApprovalStatus must be "approved" (found ${row.coachApprovalStatus})`
            );
        }
        if (!row.approvalVersion) {
            fail(errors, 'APPROVAL_VERSION', `${label}: approvalVersion is required`);
        }
        if (!row.approvedBy) {
            fail(errors, 'APPROVED_BY', `${label}: approvedBy is required`);
        }
        if (!row.approvedAt) {
            fail(errors, 'APPROVED_AT', `${label}: approvedAt is required`);
        }

        if (!byWeek.has(week)) byWeek.set(week, []);
        byWeek.get(week).push(row);
    }

    for (let week = 1; week <= REQUIRED_WEEKS; week += 1) {
        const rows = byWeek.get(week) || [];
        if (rows.length !== REQUIRED_PER_WEEK) {
            fail(
                errors,
                'WEEK_ASSIGNMENT_COUNT',
                `Week ${week} must have exactly ${REQUIRED_PER_WEEK} assignments, found ${rows.length}`
            );
        }
    }

    const publicDef = getPublicDefinition(PROGRAM_ID);
    const publicContent = contentStatus(publicDef);
    if (publicContent.enrollable) {
        fail(
            errors,
            'ENROLLMENT_ALREADY_ENABLED',
            'Public Race Build is already enrollable; refuse silent activation checks until product confirms'
        );
    } else {
        warnings.push({
            code: 'ENROLLMENT_STILL_BLOCKED',
            message:
                'Validation success must not enable enrollment. Public catalog remains awaiting_coach_schedule until a separate activation change is approved.',
        });
    }

    warnings.push({
        code: 'NO_AUTO_ACTIVATION',
        message:
            'This script never writes catalogs, user_programs, or scheduled_sessions. Existing legacy 72-session enrollments stay untouched.',
    });

    return {
        ok: errors.length === 0,
        programId: PROGRAM_ID,
        assignmentCount: assignments.length,
        requiredAssignments: REQUIRED_TOTAL,
        errors,
        warnings,
        enrollmentRemainsBlocked: !publicContent.enrollable,
        publicContentReadiness: publicContent.status,
    };
}

function main() {
    const input =
        process.argv[2] ||
        path.join('content', 'programs', 'race_build_12w', 'coach-schedule.filled.json');
    const absolute = path.resolve(process.cwd(), input);
    const loaded = loadDocument(absolute);
    if (!loaded.ok) {
        console.log(JSON.stringify({ ok: false, file: absolute, ...loaded }, null, 2));
        process.exitCode = 1;
        return;
    }

    const report = validate(loaded.assignments);
    console.log(
        JSON.stringify(
            {
                ok: report.ok,
                file: absolute,
                ...report,
                nextStepsIfValid: report.ok
                    ? [
                          'Product + coach sign-off on approvalVersion',
                          'Engineering activation PR (separate): link approved schedule, set contentReadiness ready',
                          'Do not migrate existing Race Build users automatically',
                          'Re-enable Intermediate HYROX onboarding only after activation PR',
                      ]
                    : [
                          'Fix listed errors in the filled coach schedule',
                          'Re-run this validator',
                          'Do not change enrollment guards until validation passes and activation is approved',
                      ],
            },
            null,
            2
        )
    );
    if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
    main();
}

module.exports = {
    validate,
    phaseForWeek,
    PROGRAM_ID,
    REQUIRED_TOTAL,
    REQUIRED_WEEKS,
    REQUIRED_PER_WEEK,
};
