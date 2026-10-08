# Backend — Smart Wildlife Conservation API

Node.js + Express + MongoDB (Mongoose) REST API serving the [web dashboard](../../frontend/smart-wildlife-frontend) and the [mobile app](../../mobile/smart-wildlife-mobile).

## Setup

```bash
npm install
cp .env.example .env   # then edit values, especially MONGODB_URI and JWT_SECRET
npm run dev            # starts with nodemon on http://localhost:5000
```

Before starting the backend, copy `.env.example` to `.env` and set `MONGODB_URI` and `JWT_SECRET`. Uploads are stored locally under `uploads/` by default, so Cloudinary credentials are not required.

To use Cloudinary instead, create or sign in to a Cloudinary account and copy the cloud name, API key, and API secret from the Cloudinary console's API Keys section into `.env`:

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

Keep `.env` private; it is ignored by Git. Restart the backend after changing these values. Local uploads are served from `/uploads` by the backend.

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

### Patrol monitoring (`/api/patrols`, `/api/parks`, `/api/rangers`, `src/routes/patrol.routes.js`)
Use case: **Monitor and Evaluate Ranger Patrol Activities**. Viewable by `PARK_MANAGER`, `ADMIN`, `RANGER_SUPERVISOR`; evaluations can be saved, routes changed and patrols planned by `PARK_MANAGER` and `ADMIN`. The `/api/patrols/mine` endpoints are for `RANGER` accounts linked to a ranger profile. Errors use the shape `{ error: { code, message, fields? } }`.

| Method & path | Purpose |
|---|---|
| `GET /api/patrols/monitoring` | Dashboard: active + recently completed patrols, ranger locations, progress, coverage per zone, under-patrolled zones, `gpsStatus`, `lastUpdated` |
| `GET /api/patrols?rangerId=&routeId=&status=&from=&to=` | Filtered list (400 on an invalid status or date) |
| `GET /api/patrols/completed` | Completed history, newest first, with statistics |
| `GET /api/patrols/:patrolId` | Patrol details: ranger, route, progress, coverage, track, timeline (404 if unknown) |
| `GET /api/patrols/:patrolId/coverage` | Coverage of one patrol by zone |
| `PUT /api/patrols/:patrolId/evaluation` | Record or update the evaluation `{ rating, notes }` — completed patrols only |
| `GET /api/parks/:parkId/zones` | Zones and routes for the map (sample park id: `PK-YALA`) |
| `POST /api/patrols` | Park Manager assigns rangers to a route `{ routeId, rangerIds, startTime, endTime }` → a PLANNED patrol (201) |
| `PUT /api/patrols/:patrolId` | Change a planned patrol (409 once it has started) |
| `POST /api/patrols/:patrolId/cancel` | Cancel a planned patrol |
| `GET /api/patrols/mine` | **Ranger (mobile app):** assigned patrol, waypoint checklist, insights, recent history |
| `POST /api/patrols/mine/start` | Ranger starts the patrol (PLANNED → ACTIVE) |
| `POST /api/patrols/mine/locations` | Phone reports positions `{ points: [{ latitude, longitude, timestamp }] }`; late points are stored as SYNCHRONIZED |
| `POST /api/patrols/mine/complete` | Ranger ends the patrol (→ COMPLETED) |
| `GET /api/parks/:parkId/routes` | Patrol routes with how many patrols use each |
| `POST /api/parks/:parkId/routes` | Create a route `{ name, description, waypoints }` — length, zones and id are worked out (201) |
| `PUT /api/parks/:parkId/routes/:routeId` | Edit a route — waypoints are locked (409) while a patrol is on it |
| `DELETE /api/parks/:parkId/routes/:routeId` | Delete a route no patrol has used (409 otherwise) |
| `GET /api/rangers` | Rangers for the filter dropdown |
| `GET /api/rangers/:rangerId/location` | Re-query the GPS service for one ranger (Retry button) |

The GPS Tracking Service (`src/gps/`) locates a ranger who uses the mobile app from the last position their phone reported (`DeviceFirstGpsTrackingService`); every other ranger is **simulated**: each request moves them a little further along the route. Flags: `GPS_DOWN=true` (service unavailable), `GPS_OFFLINE_RANGERS=RN-003,RN-005` (who has no signal; default `RN-003`).

Sample data: `npm run seed:patrols` (Yala National Park: 4 zones, 4 routes, 6 rangers, 8 patrols). It replaces only the `parks`, `rangers` and `patrols` documents for `PK-YALA`. `SEED_NO_ACTIVE=true` seeds without active patrols. Ranger app logins (password `Ranger@123`): `ranger.demo@wildlife.lk` (Dilan Fernando), `ranger2.demo@wildlife.lk`, `ranger3.demo@wildlife.lk`. `npm run seed:app-rangers` adds these three rangers and any missing login **without** resetting routes or patrols; the full `seed:patrols` also creates them. Existing user accounts are never modified.

Thresholds (40 % coverage, 48 h, 24 h, 15 min offline, 200 m, 30 s refresh) are in `src/config/patrol.config.js`.

Design notes — SOLID, patterns, code smells, flow-to-test traceability, demo steps: see [VIVA_NOTES_PATROL_MONITORING.md](VIVA_NOTES_PATROL_MONITORING.md).

## Structure

```
src/
  config/        # DB connection, Cloudinary config, patrol.config (thresholds)
  constants/     # roles.js — single source of truth for role names; patrolEnums
  controllers/   # auth, conflict, conflictArchive, patrol
  errors/        # patrolErrors (NotFoundError, ValidationError, GpsServiceUnavailableError)
  gps/           # GpsTrackingService (abstract), simulator and its adapter, phone-first adapter
  middleware/    # auth (protect/authorize), upload (multer), error handling, patrolError
  models/        # User, ConflictReport, Park, Ranger, Patrol, patrolDomain (LocationPoint, Zone, …)
  repositories/  # patrolContracts (small interfaces) + MongoDB repositories for patrols, rangers, parks
  routes/        # auth.routes, conflict.routes, patrol.routes
  services/      # patrolCalculators, patrolMonitoring, patrolQuery, patrolEvaluation, patrolRoute, patrolAssignment
  strategies/    # coverage strategies (zone proximity, time weighted)
  utils/         # email (nodemailer), cloudinaryUpload, seed, patrolSeed, geo, logger
  app.js         # Express app setup (middleware, route mounting)
  patrol.container.js  # wires the patrol monitoring classes together (dependency injection)
  server.js      # Entry point — loads .env, connects DB, starts listening
```

## Testing

```bash
npm test                      # node:test runner, tests/*.test.js (all modules)
npm run test:coverage         # coverage gate (80%) scoped to conflict controllers
npm run test:patrol           # patrol monitoring tests only (tests/patrol.*.test.js)
npm run test:coverage:patrol  # coverage gate (80%) scoped to patrol monitoring
npm run lint:patrol           # ESLint for the patrol monitoring files only
```

## Status / known gaps

- Rangers-management, incidents, alerts, camera-traps and settings pages referenced by the frontend's routing/nav are **not yet implemented** on this API in this branch.
- Fully implemented end-to-end (model, controller, routes, tests): conflict reports (community → ranger/CLO workflow, including archive/restore) patrol monitoring (Park Manager dashboard, filter, history, details, evaluation), patrol route management (create, edit, delete) and patrol assignment with phone tracking (plan on the web, carry out in the mobile app).
