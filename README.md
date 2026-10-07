# Backend — Smart Wildlife Conservation API

Node.js + Express + MongoDB (Mongoose) REST API serving the [web dashboard](../../frontend/smart-wildlife-frontend) and the [mobile app](../../mobile/smart-wildlife-mobile).

## Setup

```bash
npm install
cp .env.example .env   # then edit values, especially MONGODB_URI and JWT_SECRET
npm run dev            # starts with nodemon on http://localhost:5000
```

Health check: `GET http://localhost:5000/api/health`

On a physical device/Expo Go, the mobile app needs this server reachable over LAN — see `EXPO_PUBLIC_API_URL` in the mobile README, and `CORS_ORIGIN` here.

## Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 5000) |
| `MONGODB_URI` | Mongo/Atlas connection string. Server logs a warning and skips DB connection (not a crash) if unset. |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Auth token signing |
| `CORS_ORIGIN` | Comma-separated list of allowed origins |
| `UPLOAD_DIR` | Local folder for uploaded evidence files (served at `/uploads`) |
| `CLIENT_URL` | Used to build password-reset links |
| `EMAIL_*` | Nodemailer SMTP config for "Forgot Password" emails. If blank, reset links are logged to the console instead (local dev) |
| `CLOUDINARY_*` | Cloudinary credentials — conflict-report evidence images are uploaded here (see `src/utils/cloudinaryUpload.js`) |

## Roles (`src/constants/roles.js`)

| Role | Surface |
|---|---|
| `ADMIN` | Web — full access, including conflict-report archive management |
| `PARK_MANAGER` | Web |
| `RANGER_SUPERVISOR` | Web |
| `RESEARCHER` | Web |
| `COMMUNITY_LIAISON_OFFICER` | Web (and mobile — responds to conflict reports) |
| `RANGER` | Mobile only — responds to conflict reports, no web dashboard access |
| `COMMUNITY_MEMBER` | Mobile only — submits conflict reports, no web dashboard access |

The frontend's `src/config/roleAccess.js` mirrors this split and must be kept in sync if roles change.

## API surface

### Auth (`/api/auth`, `src/routes/auth.routes.js`)
| Method & path | Auth | Purpose |
|---|---|---|
| `POST /login` | — | Returns `{ token, user }` |
| `GET /me` | Bearer token | Current user |
| `POST /forgot-password` | — | Always returns a generic success message (doesn't leak whether the email exists) |
| `POST /reset-password/:token` | — | Resets password from a hashed, time-limited token |

### Conflict reports (`/api/conflicts`, `src/routes/conflict.routes.js`)
All routes require `protect` (valid JWT). Role gating via `authorize(...roles)`:

| Method & path | Roles | Purpose |
|---|---|---|
| `POST /` | `COMMUNITY_MEMBER` | Create a report; `multipart/form-data`, up to 5 evidence images (`upload.array('evidence', 5)` → Cloudinary) |
| `GET /my` | `COMMUNITY_MEMBER` | Reporter's own reports |
| `GET /` | `RANGER`, `COMMUNITY_LIAISON_OFFICER`, `PARK_MANAGER`, `RANGER_SUPERVISOR`, `RESEARCHER`, `ADMIN` | Paginated list (archived excluded automatically) |
| `GET /:id` | any authenticated role | Single report |
| `PATCH /:id/response` | `RANGER`, `COMMUNITY_LIAISON_OFFICER` | Update status / urgency / response note |
| `GET /admin/archived` | `ADMIN` | List archived reports |
| `GET /admin/:id` | `ADMIN` | Fetch active or archived report by id |
| `PATCH /:id/archive` | `ADMIN` | Soft-archive (reports are never hard-deleted except via the explicit permanent-delete route below) |
| `PATCH /:id/restore` | `ADMIN` | Un-archive |
| `DELETE /:id/permanent` | `ADMIN` | Hard delete — controller refuses unless the report is already archived |

Notable model behavior (`src/models/ConflictReport.js`): archived reports are excluded from all `find`/`findOne`/`findById` queries by a `pre('find')` hook unless the query opts in with `.withArchived()`. `clientReportId` is a unique/sparse field used by the mobile app's offline sync to avoid duplicate submissions.

## Structure

```
src/
  config/        # DB connection, Cloudinary config
  constants/     # roles.js — single source of truth for role names
  controllers/   # auth, conflict, conflictArchive
  middleware/    # auth (protect/authorize), upload (multer), error handling
  models/        # User, ConflictReport
  routes/        # auth.routes, conflict.routes
  utils/         # email (nodemailer), cloudinaryUpload, seed
  app.js         # Express app setup (middleware, route mounting)
  server.js      # Entry point — loads .env, connects DB, starts listening
```

## Testing

```bash
npm test             # node:test runner, tests/*.test.js
npm run test:coverage  # coverage gate (80%) scoped to conflict controllers
```

## Status / known gaps

- Patrols, rangers-management, animals, risk-zones, alerts, camera-traps, and reports modules referenced by the frontend's routing/nav are **not yet implemented** on this API — those frontend pages are currently placeholders with no backing endpoints.
- Conflict reports (community → ranger/CLO workflow, including archive/restore) is the one fully implemented domain module end-to-end (model, controller, routes, tests).
