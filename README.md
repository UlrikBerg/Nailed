# nailed

Peer-to-peer marketplace for beauty services. Web + iOS + Android.

## Stack

- **Backend:** Node.js (Express 5), MySQL 8, JWT auth
- **Frontend:** simple HTML + CSS, vanilla JS (no framework)
- **Auth:** Google OIDC (primary), Vipps Login (pending Vipps approval)
- **Hosting:** Hostinger Cloud (Node.js plan) + MySQL

## Project layout

```
.
├── server.js                  Entry point — loads .env, starts Express
├── backend/
│   ├── app.js                 Express app factory
│   ├── config.js              Env-driven config
│   ├── db.js                  MySQL connection pool + query helpers
│   ├── schema.sql             Database schema (idempotent)
│   ├── setup-db.js            Applies schema.sql to the configured DB
│   ├── lib/                   jwt, sessions, util, slugify, PKCE
│   ├── middleware/            auth (Bearer), error handler
│   ├── providers/             OAuth provider abstraction (google, vipps)
│   └── routes/                /api/v1/* route handlers
├── admin/                     Admin panel (HTML+CSS+JS)
├── kunde-panel.html           Customer panel
├── salong-panel.html          Salon-owner panel
├── bli-salong.html            Application form to become a salon
├── login.html                 Provider picker (Google live, Vipps stub)
├── auth-complete.html         Bridge page that stores tokens after OAuth
├── assets/auth.js             Client-side token + fetch helper (NailedAuth)
└── (other public marketing pages: index.html, utforsk.html, salon.html, ...)
```

## Local setup

1. **Install Node.js** (≥ 20).
2. **Install MySQL** locally (or point `.env` at Hostinger's MySQL).
   ```bash
   brew install mysql
   brew services start mysql
   mysql -u root -e "CREATE DATABASE nailed CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   mysql -u root -e "CREATE USER 'nailed'@'localhost' IDENTIFIED BY 'change-me'; GRANT ALL ON nailed.* TO 'nailed'@'localhost'; FLUSH PRIVILEGES;"
   ```
3. **Copy `.env.example` to `.env`** and fill in:
   - `JWT_SECRET` — generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
   - DB credentials
   - Google OAuth (see [docs/GOOGLE_OAUTH_SETUP.md](docs/GOOGLE_OAUTH_SETUP.md))
   - Vipps left blank for now (see [docs/VIPPS_INTEGRATION.md](docs/VIPPS_INTEGRATION.md))
   - `BOOTSTRAP_ADMIN_EMAILS` — comma-separated emails that get role=admin on first login
4. **Install deps + apply schema:**
   ```bash
   npm install
   npm run db:setup
   ```
5. **Run dev server:**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000.

## Deploy to Hostinger Cloud

See [docs/HOSTINGER_DEPLOY.md](docs/HOSTINGER_DEPLOY.md) for step-by-step. Summary:

1. Create MySQL DB in hPanel → copy creds.
2. Configure Node.js app in hPanel → entry `server.js`, Node 20+.
3. Run `npm install` + set env vars (`JWT_SECRET` is required to make auth work).
4. Run `npm run db:setup` once.
5. Restart the app. Verify with `curl /api/v1/health` — `ready.jwt`, `ready.db` should be `true` and `issues` should be empty.

The server boots even with missing env vars — auth-protected routes return 503 with a clear
`jwt_not_configured` error so you can debug from `curl /api/v1/health` alone.

## API

All endpoints under `/api/v1`. JSON in/out. Auth via `Authorization: Bearer <accessToken>`.

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /health` | — | Liveness check |
| `GET /auth/providers` | — | Lists enabled OAuth providers |
| `GET /auth/:provider/start` | — | Begins OAuth flow, redirects to provider |
| `GET /auth/:provider/callback` | — | Provider redirects here; ends in `/auth-complete.html` |
| `POST /auth/refresh` | — | `{refreshToken}` → `{accessToken}` |
| `POST /auth/logout` | — | `{refreshToken}` → revokes session |
| `GET /me` | user | Current profile |
| `PATCH /me` | user | Edit profile |
| `DELETE /me` | user | Soft-delete account |
| `GET /me/sessions`, `DELETE /me/sessions/:id` | user | Active sessions |
| `GET /salons` | — | Public listing |
| `GET /salons/:slug` | — | Public salon detail |
| `GET /salons/me/own` | salon_owner | Salon you own |
| `PATCH /salons/:id` | salon_owner | Edit salon profile |
| `GET/POST /salons/:id/services` | mixed | List public; mutate as owner |
| `PATCH/DELETE /salons/:salonId/services/:id` | salon_owner | Edit/soft-delete service |
| `GET /bookings/mine` | user | Bookings as customer (`?filter=upcoming\|past`) |
| `GET /bookings/incoming` | salon_owner | Bookings at your salon |
| `POST /bookings` | user | Create booking |
| `PATCH /bookings/:id` | mixed | Status changes (cancel/confirm/complete/no_show) |
| `GET/POST/DELETE /favorites` | user | Manage favorites |
| `POST /salons/:id/images` | salon_owner | Multipart upload — field `file` |
| `GET /salons/:id/images` | — | Public list of gallery images |
| `DELETE /salons/:id/images/:imageId` | salon_owner | Remove image |
| `PATCH /salons/:id/cover` | salon_owner | `{image_id}` — pick cover from gallery |
| `PATCH /salons/:id/images/reorder` | salon_owner | `{order: [imageId,...]}` |
| `GET /salon-applications/mine` | user | Your latest application |
| `POST /salon-applications` | user | Submit application |
| `POST /salon-applications/:id/withdraw` | user | Withdraw pending application |
| `GET /admin/dashboard` | admin | Counts |
| `GET /admin/users`, `POST /admin/users/:id/(un)suspend` | admin | User moderation |
| `GET /admin/salons`, `POST /admin/salons/:id/(activate\|suspend)` | admin | Salon moderation |
| `GET /admin/bookings` | admin | All bookings |
| `GET /admin/salon-applications` | admin | Applications, filterable by status |
| `POST /admin/salon-applications/:id/(approve\|reject)` | admin | Decisions |

## Storage (images)

The `STORAGE_BACKEND` env var controls where salon images live:

- `local` (default) — writes to `./uploads/`, served from `/uploads/*` by Express. Use for dev.
- `r2` — Cloudflare R2 (S3-compatible). Use for production. See [docs/R2_SETUP.md](docs/R2_SETUP.md).

Switching is one env var change; existing image keys work across backends because the DB stores
keys (e.g. `salons/12/abc.webp`), and each backend's `publicUrl(key)` builds the right URL.

Server-side, every uploaded image is auto-rotated by EXIF, capped at 2400px on the longest side,
and re-encoded to WebP at q=82. Originals are not preserved (Fase 1 storage is "good enough"; if
you ever need original-fidelity, rework `backend/routes/images.js`).

## Phases

- **Fase 1:** Backend + auth + panels + salon-application flow. ✓
- **Fase 2:** Image uploads (local/R2), salon photo gallery, salon settings (cover, accept-bookings,
  phone visibility), customer notification preferences, public salon page reads real data. ✓
- **Fase 3:** Public marketplace pages (utforsk, favoritter, booking flow) read from DB.
  GDPR/legal texts. Cookie banner. Data export & full erasure.

## Notes

- **CLAUDE.md rules:** frontend = simple HTML/CSS only, backend = JavaScript.
- **Password rule:** there is none. Auth is OIDC-only (Google + Vipps). No bcrypt, no password reset.
- **Mobile clients:** the API is Bearer-token-based and CORS-aware, so iOS/Android apps can use the
  same endpoints. Mobile OIDC flow uses PKCE + custom URL scheme.
