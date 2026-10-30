# Race Build — Content Approval Workflow

Status: **template only**. Does not enable enrollment.

## Product locks

| Rule | Value |
|------|-------|
| programId | `race_build_12w` |
| Duration | 12 weeks |
| Frequency | 3 workouts / week |
| Assignments required | 36 |
| Phases | Base 1–4, Build 5–9, Peak 10–11, Taper 12 |
| Intermediate HYROX onboarding | Blocked until approved schedule is activated |
| Temporary fallback program | **None** |
| Legacy 72-session users | Unchanged |

## Files

| File | Purpose |
|------|---------|
| `coach-schedule.template.json` | Empty 36-slot JSON template |
| `coach-schedule.template.csv` | Same slots for spreadsheet editing |
| `coach-schedule.filled.json` | Coach working copy (create locally; not committed until approved) |
| `../../../scripts/validate_race_build_coach_schedule.js` | Read-only validation |

## Exact approval steps

1. **Copy template**  
   `coach-schedule.template.json` → `coach-schedule.filled.json` (local / shared coach folder).

2. **Coach fills only**  
   For each of 36 rows: `dayOfWeek`, `workoutId`, then set  
   `coachApprovalStatus=approved`, `approvalVersion`, `approvedBy`, `approvedAt`.  
   Do **not** invent workouts; use existing playable catalog IDs only.

3. **Validate (no activation)**  
   ```bash
   node scripts/validate_race_build_coach_schedule.js content/programs/race_build_12w/coach-schedule.filled.json
   ```  
   Must exit 0 with `"ok": true` and `"enrollmentRemainsBlocked": true`.

4. **Product sign-off**  
   Confirm Figma alignment (3/week), phases, and Intermediate HYROX re-enable timing.

5. **Engineering activation (separate PR — not this workflow)**  
   Only after steps 3–4: wire approved mapping into catalog, set `contentReadiness=ready`, enable enroll + Intermediate onboarding.  
   **Do not** rewrite existing users’ 72-session calendars.

6. **QA**  
   Run Postman checklist in `../POSTMAN_QA_CHECKLIST.md` before and after activation PR.

## What this workflow never does

- Auto-enable `POST /api/programs/race_build_12w/enroll`
- Auto-edit `data/programs.json` or `data/public-programs.json`
- Migrate legacy enrollments
- Assign a temporary Intermediate HYROX fallback
