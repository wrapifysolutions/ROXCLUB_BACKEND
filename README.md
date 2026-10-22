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

### 5. Strava + Zepp integrations (production OAuth)
- `GET /api/integrations/strava/connect` (auth) → returns Strava authorize URL
- `GET /api/integrations/strava/callback` → exchanges code, encrypts tokens, redirects to frontend
- `GET /api/integrations/strava/status` (auth) → connection status
- `DELETE /api/integrations/strava` (auth) → local disconnect + Strava deauthorize
- OAuth `state` stored in DB (`oauth_states`), not in memory
- Access/refresh tokens encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`)
- Auto refresh helper via `getValidAccessToken(userId)` before API calls
- Tables ensured on server boot: `user_integrations`, `oauth_states`

**Zepp / Amazfit (Huami partner flow)**
- `GET /api/integrations/zepp/connect` (auth) → Xiaomi authorize URL
- `GET /api/integrations/zepp/callback` → Xiaomi code → Huami token → encrypted save
- `GET /api/integrations/zepp/status` (auth)
- `DELETE /api/integrations/zepp` (auth)
- Uses same `user_integrations` table with `provider = 'zepp'`
- Needs Xiaomi Open Platform + Huami/Zepp partner credentials (not fully self-serve like Strava)

**Apple Health (HealthKit — iOS only, no web OAuth)**
- `GET /api/integrations` (auth) → all providers for “Connect your data” screen
- `POST /api/integrations/apple-health/connect` (auth) → iOS reports HealthKit granted
- `GET /api/integrations/apple-health/status` (auth)
- `POST /api/integrations/apple-health/sync` (auth) → push HRV/sleep/resting HR/steps
- `DELETE /api/integrations/apple-health` (auth)
- Stores samples in `apple_health_samples`

### 6. Project structure cleanup
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

## Deploy to Vercel

1. Push this repo to GitHub (do **not** commit `.env`).
2. Import the repo in [vercel.com/new](https://vercel.com/new).
3. Framework Preset: **Other** (Express is auto-detected from `server.js`).
4. Add all env vars from `.env.example` in **Project → Settings → Environment Variables**.
5. Deploy.

Or CLI:

```bash
npm i -g vercel
vercel login
vercel
vercel --prod
```

After deploy, update production redirect URLs:

- `STRAVA_REDIRECT_URI=https://YOUR_APP.vercel.app/api/integrations/strava/callback`
- `ZEPP_REDIRECT_URI=https://YOUR_APP.vercel.app/api/integrations/zepp/callback`

Also set the same callback domain/URL in Strava / Xiaomi dashboards.

Health check: `GET https://YOUR_APP.vercel.app/` → `{ "ok": true }`

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
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=https://your-api.com/api/integrations/strava/callback
STRAVA_FRONTEND_SUCCESS_URL=roxclub://integrations/strava?status=connected&provider=strava
STRAVA_FRONTEND_ERROR_URL=roxclub://integrations/strava?status=error
TOKEN_ENCRYPTION_KEY=   # 64-char hex (32 bytes)
ZEPP_XIAOMI_CLIENT_ID=
ZEPP_XIAOMI_CLIENT_SECRET=
ZEPP_REDIRECT_URI=https://your-api.com/api/integrations/zepp/callback
ZEPP_HUAMI_THIRD_NAME=
ZEPP_HUAMI_APP_NAME=
ZEPP_HUAMI_APP_ID=
ZEPP_HUAMI_APP_SECRET=
ZEPP_FRONTEND_SUCCESS_URL=
ZEPP_FRONTEND_ERROR_URL=
```

Strava dashboard callback domain must match your API host (for local: `localhost`).  
Zepp needs Xiaomi redirect URI + Huami partner values from their onboarding team.

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

## Strava API (Postman / app)

1. Login → copy JWT  
2. `GET /api/integrations/strava/connect` with `Authorization: Bearer <token>`  
3. Open `authorizationUrl` in browser → approve Strava  
4. Strava hits callback → tokens saved encrypted → browser redirects to frontend success URL  
5. `GET /api/integrations/strava/status` to confirm `connected: true`

## Zepp API (Postman / app)

Same order as Strava, after filling Zepp env credentials:

1. Login → JWT  
2. `GET /api/integrations/zepp/connect`  
3. Open `authorizationUrl` (Xiaomi login) → approve  
4. Callback saves Huami/Zepp tokens  
5. `GET /api/integrations/zepp/status`  
6. `DELETE /api/integrations/zepp` to disconnect  

## Notes / bugs fixed today
- Neon connect timeout: raised pool timeout; removed `channel_binding=require`
- Resend OTP was not updating DB (old expiry kept short) — fixed to reset 1-minute expiry
- Folder moves broke imports — routes + `../../lib` paths fixed
- `start` uses `node`; `dev` uses `nodemon`
- Strava env mismatch + in-memory state replaced with DB state + encrypted tokens
