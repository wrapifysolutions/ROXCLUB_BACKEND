# Programs Section — Postman QA Checklist

Auth: obtain JWT (cookie or Bearer). Replace `{{baseUrl}}` and `{{token}}`.

Use a **non-production** Neon branch when possible. Read-only SQL is listed for verification; do not run UPDATE/DELETE.

---

## 0. Preconditions

- [ ] Server running with current Programs guards
- [ ] User A: no `user_programs` row
- [ ] User B: existing `race_build_12w` enrollment with legacy sessions (if available)
- [ ] User C: Intermediate HYROX answers saved, onboarding not completed (or reset test user)

---

## 1. GET /api/programs (Explore)

**Request:** `GET {{baseUrl}}/api/programs`  
**Headers:** `Authorization: Bearer {{token}}`  
**Expected:** `200`

**JSON assertions**
- [ ] `programs.length === 4`
- [ ] Race Build `id === "race_build_12w"`
- [ ] Race Build `durationWeeks === 12`
- [ ] Race Build `workoutFrequency.workoutsPerWeek === 3`
- [ ] Race Build `workoutFrequency.source === "product_target"`
- [ ] Race Build `intendedFrequency.targetTrainingSessions === 36`
- [ ] Race Build `contentReadiness === "awaiting_coach_schedule"`
- [ ] Race Build `enrollable === false`
- [ ] Race Build `canEnroll === false`
- [ ] Race Build `enrollmentBlockedReason === "missing_approved_schedule"`
- [ ] `rox_engine_8w`, `strength_hybrid_6w`, `off_season_base_6w` also `enrollable === false`

**Neon (read-only)**
```sql
-- No new enrollments should appear after Explore calls
SELECT COUNT(*) FROM user_programs WHERE program_id = 'race_build_12w';
```

---

## 2. GET /api/programs/race_build_12w (Detail)

**Expected:** `200`

**JSON assertions**
- [ ] `phases` Base 1–4, Build 5–9, Peak 10–11, Taper 12
- [ ] `scheduleAvailable === false`
- [ ] `weekPreview === null`
- [ ] `legacySchedule.exists === true`
- [ ] `legacySchedule.approved === false`
- [ ] `legacySchedule.totalScheduledSessions === 72`
- [ ] `legacySchedule.workoutsPerWeek === 6`
- [ ] `workoutFrequency.workoutsPerWeek === 3` (product target, not legacy)

---

## 3. GET /api/programs/me (Active — empty)

As User A (no enrollment).  
**Expected:** `200`

**JSON assertions**
- [ ] `enrollment === null`
- [ ] `emptyState` present with title/message

---

## 4. POST /api/programs/race_build_12w/enroll (blocked)

As User A.  
**Body:** `{}` or `{ "startDate": "2026-10-28" }`  
**Expected:** `409`

**JSON assertions**
- [ ] `error === "PROGRAM_NOT_ENROLLABLE"`
- [ ] No success `created: true`

**Neon (read-only)**
```sql
SELECT * FROM user_programs WHERE user_id = '<user-a-uuid>';
-- expect 0 rows

SELECT COUNT(*) FROM scheduled_sessions WHERE user_id = '<user-a-uuid>';
-- expect 0
```

---

## 5. GET /api/programs/me (Active — legacy Race Build user)

As User B.  
**Expected:** `200`

**JSON assertions**
- [ ] `enrollment.programId === "race_build_12w"`
- [ ] `enrollment.scheduleProvenance === "legacy_unapproved"`
- [ ] `enrollment.approvedProductFrequency.workoutsPerWeek === 3`
- [ ] `enrollment.progress.totalScheduledSessions` reflects **actual** legacy rows (often 72), not 36
- [ ] `enrollment.phase` matches week bands for current week
- [ ] `continue.planPath` points at `/api/plan/week?weekStart=...`

**Neon (read-only)**
```sql
SELECT program_id, start_date FROM user_programs WHERE user_id = '<user-b-uuid>';
SELECT COUNT(*) AS sessions FROM scheduled_sessions WHERE user_id = '<user-b-uuid>' AND program_id = 'race_build_12w';
-- expect unchanged counts before/after QA
```

---

## 6. GET /api/plan/week

As User B.  
**Expected:** `200`

**JSON assertions**
- [ ] `programId === "race_build_12w"` (if returned)
- [ ] `phase` is Base/Build/Peak/Taper per week number (week 12 → Taper)
- [ ] Day statuses still driven by real `scheduled_sessions` (may show up to 6 training days/week for legacy users)
- [ ] Response must **not** claim an approved 3/week product schedule

---

## 7. Intermediate HYROX onboarding blocker

As User C (goal hyrox, experience Intermediate, no `user_programs`).  
**Request:** existing onboarding complete endpoint  
**Expected:** `409`

**JSON assertions**
- [ ] `error === "PRODUCT_CONFIGURATION_BLOCKER"`
- [ ] `enrollError === "PROGRAM_NOT_ENROLLABLE"`
- [ ] `details.affectedOnboardingPaths` includes `{ goal: "hyrox", level: "Intermediate", matchedProgramId: "race_build_12w" }`

**Neon (read-only)**
```sql
SELECT * FROM user_programs WHERE user_id = '<user-c-uuid>';
-- expect 0 rows after failed complete
SELECT COUNT(*) FROM scheduled_sessions WHERE user_id = '<user-c-uuid>';
-- expect 0
```

**Control — other paths still work**
- [ ] hyrox + Beginner → can complete → `hyrox_base_8w` (or existing match)
- [ ] hyrox + Advanced → `hyrox_peak_8w`
- [ ] hybrid / general_fitness paths unchanged

---

## 8. Other three incomplete programs

For each of `rox_engine_8w`, `strength_hybrid_6w`, `off_season_base_6w`:

1. `GET /api/programs/:id` → `200`, `enrollable === false`, `weekPreview === null`
2. `POST /api/programs/:id/enroll` → `409` `PROGRAM_NOT_ENROLLABLE`
3. Neon: no new `user_programs` / `scheduled_sessions` for User A

---

## 9. Regression smoke (after any future activation PR only)

Do **not** run as “pass” criteria for the current template-only state.

- [ ] After activation: Race Build enrollable, Intermediate HYROX unblocked
- [ ] User B legacy calendar still untouched
- [ ] New enrollments create **36** sessions, not 72

---

## Suggested Postman folder order

1. Auth  
2. Explore list  
3. Race Build detail  
4. Me empty  
5. Enroll Race Build (expect 409)  
6. Me legacy user  
7. Plan week legacy user  
8. Onboarding Intermediate HYROX (expect 409)  
9. Onboarding Beginner HYROX control  
10. Enroll ROX Engine / Strength / Off-Season (expect 409 each)
