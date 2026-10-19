# RoxClub API — Work Log (19 Oct 2026)

Backend for RoxClub auth + onboarding. Today’s work focused on **Neon Postgres**, **custom email signup with OTP**, **JWT cookie sessions**, and **onboarding questions**.

---

## What we built today

### 1. Database connection (Neon Postgres)
- Production Postgres via Neon connection string in `.env`
- Connection pool in `lib/pool.js` (keep-alive, 20s timeout, max 10 clients)
- Startup health check with `SELECT 1` in `lib/db.js`
- Graceful shutdown closes the pool on `SIGINT` / `SIGTERM`

### 2. Custom email auth
- Signup with email + password
- Password stored as **bcrypt hash** (never plain text)
- 6-digit OTP emailed via Nodemailer (Gmail SMTP)
- OTP stored as **hash** in `users` table
- OTP valid for **1 minute** (`otp_expires_at`)
- Expired OTP is cleared from DB on verify
- Resend OTP resets hash + expiry to a fresh 1 minute

### 3. JWT + cookie session
- After OTP verify or login, sets `httpOnly` cookie `roxclub_token` (7 days)
- Token also returned in JSON for Postman / mobile
- `GET /auth/me` → if cookie/token valid → go home; else → login
- Logout clears the cookie
- Auth middleware accepts cookie JWT, Bearer JWT, or Supabase Bearer

### 4. Onboarding questions
- Table: `onboarding_questions` (references `users.id`)
- Fields: display name, DOB, gender, height, weight, training experience, goals
- `POST /onboarding-questions` saves/updates answers for the logged-in user

### 5. Project structure cleanup
Controllers moved into folders; imports fixed:

```
controllers/
  AuthControllers/     → email signup, OTP, login, session, resend
  Onboarding/          → user onboarding + questions
models/Onboarding/     → SQL table definitions
lib/                   → pool, db, token, nodemailer, supabase
middlewares/           → auth
routes/                → OnboardingRoute.js
```

---

## Run locally

```bash
npm install
npm run dev
```

Server: `http://localhost:3000`

Required `.env` keys (do not commit real secrets):

```env
POSTGRES_SQL_URL=
PORT=3000
Project_Url=
SupaBase_Publishable_Key=
SupaBase_Secret_Key=
SESSION_SECRET=
SMTP_USER=
SMTP_PASS=
JWT_SECRET=
JWT_EXPIRES_IN=7d
```

---

## Auth API (Postman)

### Signup
`POST /auth/email-signup`

```json
{
  "email": "ali@gmail.com",
  "password": "mypass123"
}
```

### Verify OTP
`POST /auth/verify-email-otp`

```json
{
  "email": "ali@gmail.com",
  "otp": "123456"
}
```

Returns `token` + sets cookie. Use `redirect: "/home"`.

### Resend OTP
`POST /auth/resend-otp`

```json
{
  "email": "ali@gmail.com"
}
```

### Login
`POST /auth/email-login`

```json
{
  "email": "ali@gmail.com",
  "password": "mypass123"
}
```

### Check session (returning user)
`GET /auth/me`  
Header: `Authorization: Bearer <token>`  
or send cookie `roxclub_token`.

### Logout
`POST /auth/logout`

---

## Onboarding API

### Save questions
`POST /onboarding-questions`  
Header: `Authorization: Bearer <token>`

```json
{
  "display_name": "Ali Khan",
  "date_of_birth": "2000-05-15",
  "gender": "male",
  "height": 175.5,
  "weight": 72.3,
  "training_experience": "beginner",
  "training_goals": "muscle gain"
}
```

`user_id` comes from the token — do not send it in the body.

---

## Main tables

### `users`
- `email`, `password_hash`, `otp_hash`, `otp_expires_at`
- `auth_provider` (`email` | `google` | `apple`)
- `is_email_verified`

### `onboarding_questions`
- `user_id` → `users(id)` FK, unique, cascade delete
- Profile / fitness fields listed above

---

## Scripts used today

| Script | Purpose |
|--------|---------|
| `scripts/ensure-users-otp-columns.js` | Create/update `users` OTP columns |
| `scripts/test-custom-email-db.js` | Test hash + 1-minute OTP expiry |
| `scripts/test-auth-token.js` | Test JWT sign/verify |

---

## Notes / bugs fixed today
- Neon connect timeout: raised pool timeout; removed `channel_binding=require`
- Resend OTP was not updating DB (old expiry kept short) — fixed to reset 1-minute expiry
- Folder moves broke imports — routes + `../../lib` paths fixed
- `start` uses `node`; `dev` uses `nodemon`
