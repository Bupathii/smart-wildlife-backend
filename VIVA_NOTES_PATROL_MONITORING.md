# Viva Notes — Monitor and Evaluate Ranger Patrol Activities

Use case owner notes for SE3070 Assignment 02. Primary actor: **Park Manager**. Secondary actor: **GPS Tracking Service** (simulated — no real tracking devices are used).

Paths starting with `src/` or `tests/` are in the **backend** repo (`smart-wildlife-backend`). Paths starting with `FE:` are in the **frontend** repo (`smart-wildlife-frontend/src/`). Line numbers point at the tag comment or class declaration; search the file for `SOLID-` or `PATTERN-` to find every tag.

## 1. SOLID principles

| Principle | Where (file : line) | Why it follows the principle | What would go wrong otherwise |
|---|---|---|---|
| **S** — Single Responsibility | `src/services/patrolMonitoring.service.js:318` `PatrolMonitoringService` | It only coordinates the steps that build the dashboard. Geometry, GPS fallback and database access each live in another class. | It would become a god class like Group 059's `WildlifeMonitoringSystem`: one change (e.g. the offline rule) would risk breaking coverage and evaluation. |
| S | `src/services/patrolCalculators.js:24` `PatrolProgressCalculator` | Calculates progress along a route and nothing else. | Progress maths would be copied into the dashboard, details and seed code (duplicate code, feature envy). |
| S | `src/services/patrolCalculators.js:144` `UnderPatrolledZoneDetector` | Only decides which zones are under-patrolled. | Gap rules would be mixed into the dashboard service and be impossible to test alone. |
| S | `src/services/patrolEvaluation.service.js:13` `EvaluationValidator` and `:37` `PatrolEvaluationService` | The validator checks input; the service runs the "record evaluation" flow; the repository stores it. | A single method would validate, decide and save — a long method that is hard to test for each rule. |
| S | `src/services/patrolQuery.service.js:28` `PatrolFilterBuilder` | Turns query-string text into validated filter criteria. | Controllers would parse dates and statuses themselves (fat controllers). |
| S | `src/services/patrolMonitoring.service.js:46` `RangerLocationService`, `:149` `PatrolTrackRecorder`, `:180` `PatrolContextLoader`, `:222` `PatrolViewAssembler` | One job each: get locations with fallback, store new fixes, load related data, shape a patrol for display. | The monitoring service would need all four reasons to change. |
| S | `src/controllers/patrol.controller.js:6` | Controllers only translate HTTP to a service call. | Business rules in controllers cannot be unit-tested without HTTP. |
| S | `src/repositories/PatrolRepository.js:43` | Database access only. | Queries scattered through services; changing the database would touch business code. |
| S | `FE: components/PatrolMap.jsx:66`, `FE: components/PatrolTable.jsx:56`, `FE: components/EvaluationForm.jsx:53`, `FE: components/PatrolWidgets.jsx:70` (`OfflineBadge`), `:96` (`SummaryCards`), `FE: hooks/usePatrolData.js:15` | Each React component draws one thing from props; loading and polling live in one hook. | Pages would each re-implement fetching, polling and error states. |
| **O** — Open/Closed | `src/strategies/CoverageStrategy.js:32` + `src/strategies/TimeWeightedCoverageStrategy.js:12` | A second coverage formula was added as a new subclass. `ZoneCoverageAnalyzer` and `PatrolMonitoringService` were not edited. Selected by `COVERAGE_STRATEGY` in `src/config/patrol.config.js`. | Every new formula would mean editing an `if/else` chain inside the monitoring service. |
| O | `src/strategies/index.js:8` | Registering a strategy is one new line in the factory map. | The container would grow a `switch` statement. |
| O | `src/services/patrolCalculators.js:140` `UnderPatrolledZoneDetector` with `LowCoverageRule` (`:108`) and `NotRecentlyPatrolledRule` (`:122`) | The detector applies whatever rule objects it is given. Test T-24 adds a brand-new rule without touching the detector. | Each new rule would be another `if` inside `detect()`, re-testing everything. |
| **L** — Liskov Substitution | `src/gps/GpsTrackingService.js:8` | `SimulatedGpsTrackingService` (real code) and `MockGpsTrackingService` (`tests/patrol.helpers.js`) both extend it and keep the same contract: `LocationPoint`, `null`, or `GpsServiceUnavailableError`. The test "every GpsTrackingService keeps the same contract (LSP)" (`tests/patrol.services.test.js:641`) runs the same assertions on both. | `RangerLocationService` would need `instanceof` checks for each GPS implementation. |
| L | `src/strategies/ZoneProximityCoverageStrategy.js:10`, `src/strategies/TimeWeightedCoverageStrategy.js:14` | Both return one `{ zoneId, percentage }` per zone, 0–100. T-23 (`tests/patrol.domain.test.js:201`) runs identical assertions against both. | Swapping the strategy in config could break the dashboard. |
| L | `tests/patrol.helpers.js` in-memory repositories | They extend the same contracts as the MongoDB repositories, so every service runs unchanged on either. | Tests would need a real database. |
| **I** — Interface Segregation | `src/repositories/patrolContracts.js:7` (`PatrolReader :19`, `EvaluationWriter :47`, `TrackWriter :55`, `RangerReader :63`, `RangerTrackingWriter :81`, …) | Small role-based contracts instead of one big repository interface. | A service that only reads would still depend on (and could misuse) write methods. |
| I | `src/services/patrolMonitoring.service.js:315`, `src/services/patrolQuery.service.js:83` | These services are given only a `PatrolReader`. | A monitoring bug could accidentally overwrite an evaluation. |
| I | `src/services/patrolEvaluation.service.js:32`, wiring at `src/patrol.container.js:91` | Needs exactly `PatrolReader` + `EvaluationWriter`. Test T-25 (`tests/patrol.services.test.js:514`) runs it with two tiny hand-written stubs. | Tests would have to fake a whole repository to test one method. |
| **D** — Dependency Inversion | `src/patrol.container.js:6` (`createPatrolModule :153`) | The composition root: the only place that says `new PatrolRepository(...)` or picks the GPS service. Services receive repositories, GPS service, strategy, clock and logger through constructors. | Services would import mongoose / create their own GPS client, so they could not be tested without a database or the network. |
| D | `src/services/patrolMonitoring.service.js:43`, `:316`; `src/services/patrolEvaluation.service.js:35`; `src/services/patrolQuery.service.js:84`; `src/services/patrolCalculators.js:66` | Each depends on abstractions (`GpsTrackingService`, repository contracts, `CoverageStrategy`, `clock`). T-25 (`tests/patrol.services.test.js:502`) injects a fake clock and fake repositories. | Time-based rules (15 min offline, 24 h, 48 h) would be untestable because `new Date()` would be hard-coded. |
| D | `FE: hooks/usePatrolData.js:16` | The hook receives a `load` function; it does not know which API it calls. | One hook per screen with copied polling logic. |

## 2. Design patterns

| Pattern | File : line | Why it is used |
|---|---|---|
| **MVC / layered** | `src/routes/patrol.routes.js:18` → `src/controllers/patrol.controller.js:8` → `src/services/*` → `src/repositories/*` | Each layer has one concern; business rules are testable without HTTP or a database. |
| **Repository** | `src/repositories/PatrolRepository.js:40`, `RangerRepository.js:15`, `ParkRepositories.js:12/34/60` | Hides MongoDB behind the contracts in `patrolContracts.js`; tests swap in in-memory versions. |
| **Strategy** | `src/strategies/CoverageStrategy.js:30`, `ZoneProximityCoverageStrategy.js:6`, `TimeWeightedCoverageStrategy.js:8` | Coverage can be measured in more than one way; the formula is chosen in config and injected. |
| **Template Method** | `src/strategies/CoverageStrategy.js:36` | The base class fixes the steps (find zone waypoints → score each → average); subclasses only supply `scoreWaypoint()`, so the shared steps are not duplicated. |
| **Adapter** | `src/gps/SimulatedGpsTrackingService.js:9` adapting `src/gps/RouteMovementSimulator.js` | The external provider speaks `{ lat, lng, recordedAt }` and throws plain errors; the adapter converts that to `LocationPoint` and `GpsServiceUnavailableError`. A real provider later needs only a new adapter. |
| **Factory** | `src/patrol.container.js:9` (`createPatrolModule`, `createPatrolApp :187`), `src/strategies/index.js:7` | One function builds the object graph; tests call it with fakes (`createPatrolApp({ repositories, gpsService })`). |
| **Dependency Injection** | constructors of every service; wired in `src/patrol.container.js:108` | See SOLID-D. |
| **Value Object** | `src/models/patrolDomain.js:23` `LocationPoint` (frozen) | A position is passed around as one immutable object with its own behaviour (`isValid`, `calculateDistance`). |
| **Custom error hierarchy + central handler** | `src/errors/patrolErrors.js`, `src/middleware/patrolError.middleware.js:25` | Services throw `NotFoundError` / `ValidationError`; one middleware logs and turns them into `{ error: { code, message } }`. |

## 3. Code smells avoided

| Smell | How it is avoided | Example |
|---|---|---|
| Long method | ESLint `max-lines-per-function: 30` and `complexity: 8` are enforced (`eslint.config.js`); long flows are split into private helpers. | `PatrolMonitoringService.getDashboard()` → `#buildDashboard()` → `#summary()` |
| Large / god class | Monitoring, querying, evaluation, location lookup and calculations are separate classes. | `src/services/` (16 small classes instead of one) |
| Magic numbers / strings | Every threshold is in `src/config/patrol.config.js` (40 %, 48 h, 24 h, 15 min, 200 m, 30 s, 500 chars). Statuses come only from `src/constants/patrolEnums.js`. ESLint `no-magic-numbers` is on. | `LowCoverageRule` receives `thresholdPercent` from config |
| Duplicate code | One geometry module, one context loader, one view assembler, one API client, one data hook. | `src/utils/geo.js`, `PatrolContextLoader`, `FE: api/patrols.js`, `FE: hooks/usePatrolData.js` |
| Long parameter list | Constructors and helpers take one options object; ESLint `max-params: 4`. | `new RangerLocationService({ gpsService, rangerRepository, clock, logger, offlineAfterMinutes })` |
| Primitive obsession | `LocationPoint` and `Zone` objects instead of loose latitude/longitude numbers. | `src/models/patrolDomain.js` |
| Feature envy | Calculations live with the data they use, not in controllers. | `PatrolProgressCalculator`, `PatrolCoverage.identifyUnderPatrolledZones()` |
| Dead code / debug `console.log` | None. Logging goes through the injected logger (`src/utils/logger.js`); ESLint `no-console` is on. | `createPatrolErrorHandler(logger)` |
| Deep nesting | Guard clauses and early returns; ESLint `max-depth: 3`. | `PatrolEvaluationService.recordEvaluation()` |
| Inconsistent naming | Class, field and enum names are copied from the corrected class diagram (`Patrol`, `PatrolRoute`, `PatrolCoverage`, `PatrolEvaluation`, `TrackingStatus`…). | `src/models/` |
| Swallowed errors | Every `catch` either handles a specific case or rethrows. | `RangerLocationService.#fetchFixes()` only catches `GpsServiceUnavailableError`; `SimulatedGpsTrackingService.#fetchFix()` rethrows as a domain error |

## 4. Flow traceability

Precondition (not implemented here): the Park Manager is already signed in. The flow starts when the manager opens the Patrols page.

| Flow | Frontend screen | API endpoint | Service method | Test |
|---|---|---|---|---|
| Main 1 — open dashboard | `FE: pages/Patrols.jsx`, `FE: pages/PatrolMonitoring.jsx` | `GET /api/patrols/monitoring` | `PatrolMonitoringService.getDashboard` | T-01, T-22 |
| Main 2 — active + recently completed (24 h) patrols | Active patrols table, "Completed in the last 24 hours" | same | `getDashboard` (`findInProgress`, `findCompletedSince`) | T-01, "recently completed" test |
| Main 3 — latest locations from GPS | Map markers | same | `RangerLocationService.resolveLocations` | T-01, T-06 |
| Main 4 — map with routes | `FE: components/PatrolMap.jsx` | `GET /api/parks/:parkId/zones` | `PatrolReferenceService.getParkMap` | T-22 |
| Main 5 — ranger markers | `PatrolMap` | `GET /api/patrols/monitoring` | `PatrolViewAssembler.toView` | T-01 |
| Main 6 — progress | Progress bar | same | `PatrolProgressCalculator.calculate` | T-02 |
| Main 7 — coverage per zone | Coverage by zone, zone colours | same | `ZoneCoverageAnalyzer.analyze` + `CoverageStrategy` | T-05, T-23 |
| Main 8 — under-patrolled zones | Alerts panel, red zones | same | `UnderPatrolledZoneDetector.detect` | T-03, T-04, T-05, T-24 |
| Main 9–11 — select patrol, view details | `FE: pages/PatrolDetails.jsx` | `GET /api/patrols/:patrolId`, `GET /api/patrols/:patrolId/coverage` | `PatrolQueryService.getPatrolDetails`, `getPatrolCoverage` | T-12, details tests, T-22 |
| Main 12 — refresh every 30 s + Refresh button | "Last updated HH:MM", Refresh | `GET /api/patrols/monitoring` | `FE: hooks/usePatrolData.js` | manual |
| AF1 — Filter Patrols | `FE: pages/PatrolFilter.jsx` | `GET /api/patrols?rangerId=&routeId=&status=&from=&to=` | `PatrolFilterBuilder.build`, `PatrolQueryService.listPatrols` | T-09, T-10, T-22 |
| AF2 — Completed Patrol History | `FE: pages/PatrolHistory.jsx` | `GET /api/patrols/completed` | `PatrolQueryService.getCompletedHistory` | T-11, T-22 |
| AF3 — Inspect another patrol | Row click in any table | `GET /api/patrols/:patrolId` | `getPatrolDetails` | T-12, T-22 |
| AF4 — Record Patrol Evaluation | `FE: components/EvaluationForm.jsx` | `PUT /api/patrols/:patrolId/evaluation` | `PatrolEvaluationService.recordEvaluation` | T-13, T-17, T-18, T-22 |
| EX1 — ranger location unavailable | Grey marker, "Offline – last synced HH:MM", Retry | `GET /api/rangers/:rangerId/location` | `RangerLocationService.locateRanger` / `#markOffline` | T-06, retry test, T-22 |
| EX2 — no active patrols | Empty state + "View completed patrols" | `GET /api/patrols/monitoring` (`noActivePatrols`) | `getDashboard` | T-08, T-22 |
| EX3 — GPS service unavailable | Yellow banner | same (`gpsStatus: "UNAVAILABLE"`) | `RangerLocationService.#fetchFixes` | T-07, T-22 |
| EX4 — system error | Error screen + "Try again"; later failures show "Could not refresh – showing data from HH:MM" | any | `createPatrolErrorHandler` | T-19 |
| EX5 — invalid evaluation input | Messages under the inputs | `PUT …/evaluation` → 400 | `EvaluationValidator.assertValid` | T-14, T-15, T-16, T-22 |

Test IDs are the first words of each test name in `tests/patrol.domain.test.js`, `tests/patrol.services.test.js` and `tests/patrol.api.test.js`.

## 5. How to demo

Setup (once):

```bash
# backend
npm install
npm run seed:patrols        # Yala sample data (only parks / rangers / patrols are replaced)
npm run dev                 # http://localhost:5000

# frontend
npm install
npm run dev                 # http://localhost:5173
```

Sign in as the Park Manager (`manager.demo@wildlife.lk`) and click **Patrols** in the sidebar.

1. **Dashboard** — point out the four summary cards, the map (zones coloured by coverage, dashed routes, ranger markers), the active patrols table and "Last updated HH:MM". Wait 30 s or press **Refresh**: rangers move and progress grows.
2. **Under-patrolled zones** — the Alerts panel lists *Palatupana Coast* (coverage below 40 %) and *Menik River Buffer* (not patrolled in the last 48 hours); both are red on the map.
3. **Offline ranger (EX1)** — *Nadeesh Silva* (PT-003) has a grey marker and the badge "Offline – last synced HH:MM". Press **Retry**: the badge stays because the device still has no signal. The other patrols keep updating.
4. **Select a patrol** — click PT-001 to open Patrol Details: ranger, route, progress, coverage by zone, track on the map, timeline. The evaluation panel says "Evaluation available after the patrol is completed".
5. **Record an evaluation (AF4)** — open **Completed Patrols**, click PT-006, then "Open details and evaluation". Try rating 2 with empty notes (error under the field), then rating 4 with notes → "Evaluation saved". Save again with another rating to show it updates the same evaluation.
6. **Filter (AF1)** — open **Filter Patrols**: filter by ranger, status, date. Choose status *Cancelled* to show "No patrols match these filters" and **Clear filters**.
7. **History (AF2)** — **Completed Patrols**: statistics, table with duration / coverage / rating; click a row to see its historical track.
8. **GPS unavailable (EX3)** — stop the backend, start it with `GPS_DOWN=true` (PowerShell: `$env:GPS_DOWN='true'; npm run dev`). The dashboard shows the yellow banner "Location service unavailable – showing last synchronised locations".
9. **Refresh failure (EX4)** — with the dashboard open, stop the backend: after the next refresh it shows "Could not refresh – showing data from HH:MM" and keeps the last data. Reload the page with the backend still stopped to show the full error screen with **Try again**.
10. **No active patrols (EX2)** — run `SEED_NO_ACTIVE=true npm run seed:patrols` (PowerShell: `$env:SEED_NO_ACTIVE='true'; npm run seed:patrols`), refresh: "No active patrols are currently running" with **View completed patrols**. Run `npm run seed:patrols` again (without the flag) to restore the data.

Other flag: `GPS_OFFLINE_RANGERS=RN-001,RN-005` chooses which rangers have no signal (empty value = everybody online).

Quality checks to show:

```bash
npm run test:patrol            # 74 tests
npm run test:coverage:patrol   # coverage table (about 99 % lines, 98 % branches)
npm run lint:patrol            # 0 errors
```

## 6. Likely viva questions

1. **Why the Strategy pattern for coverage?** Coverage has more than one sensible definition (visited at all vs. visited recently). Putting each formula in its own class lets us switch in `patrol.config.js` and add new ones without editing the monitoring service — that is the Open/Closed principle.
2. **Where is Dependency Inversion?** `src/patrol.container.js`. Services only know abstractions (repository contracts, `GpsTrackingService`, `CoverageStrategy`, a `clock` function, a logger). The container is the single place that picks the concrete classes.
3. **How do you test without the real GPS?** The service depends on the abstract `GpsTrackingService`. Tests inject `MockGpsTrackingService`, which returns chosen fixes, `null`, or throws `GpsServiceUnavailableError`. One test runs the same contract checks on the mock and the simulated service (Liskov).
4. **Why composition between Patrol and PatrolEvaluation?** An evaluation has no meaning without its patrol and is deleted with it, and a patrol has at most one (0..1). So it is embedded in the patrol document, and saving again replaces it (T-17).
5. **How did you reach 80 % coverage?** Business logic is in small classes with injected dependencies, so every rule is tested directly: positive, negative, boundary (40 % / 39.9 %, 48 h / 47 h, 500 / 501 characters, 15 / 16 minutes) and error cases. Repositories are tested with a fake Mongoose model, and every endpoint with Supertest. Result: about 99 % lines and 98 % branches.
6. **What is the difference between EX1 and EX3?** EX1: the service works but one ranger has no fix (or it is older than 15 minutes) — only that ranger is marked OFFLINE. EX3: the service itself cannot be reached — all rangers show their last synchronised location and a banner appears. In code: `null` vs. `GpsServiceUnavailableError`.
7. **How is progress different from coverage?** Progress = furthest distance reached along the route ÷ route length. Coverage = share of the zone's route waypoints that a ranger passed within 200 m. A ranger can finish the route (100 % progress) but skip checkpoints (lower coverage) — see PT-006.
8. **Where is Interface Segregation?** `patrolContracts.js`. `PatrolMonitoringService` gets only a `PatrolReader`; `PatrolEvaluationService` gets a `PatrolReader` and an `EvaluationWriter`. T-25 proves the evaluation service works with two tiny stubs.
9. **What happens when the database fails?** The error reaches `createPatrolErrorHandler`, is logged with the injected logger, and the client gets `500 { error: { code: "INTERNAL_ERROR", message } }` with no internal details (T-19). The first page load shows the error screen; a failed auto-refresh keeps the old data and shows a notice.
10. **Why is a simulated GPS acceptable, and how would you replace it?** The GPS service is an external system outside our scope. `RouteMovementSimulator` stands in for the provider and `SimulatedGpsTrackingService` is the adapter. For a real provider we would write one new adapter class and change one line in the container.
11. **Which design problems from Group 059 did you fix?** (Check this against your own Assignment 01 critique before the viva.) In this code: the `WildlifeMonitoringSystem` god class is replaced by focused services; recording an evaluation is a new «extend» flow with its own `PatrolEvaluation` class; and status labels come only from the `PatrolStatus` enum (Active, Delayed, On Hold, Completed).
