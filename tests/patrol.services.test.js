'use strict';

/**
 * Unit tests for the patrol monitoring services, the GPS adapter and the
 * repositories. Everything runs on in-memory fakes: no MongoDB, no network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPatrolModule } = require('../src/patrol.container');
const contracts = require('../src/repositories/patrolContracts');
const PatrolRepository = require('../src/repositories/PatrolRepository');
const RangerRepository = require('../src/repositories/RangerRepository');
const parkRepositories = require('../src/repositories/ParkRepositories');
const GpsTrackingService = require('../src/gps/GpsTrackingService');
const RouteMovementSimulator = require('../src/gps/RouteMovementSimulator');
const SimulatedGpsTrackingService = require('../src/gps/SimulatedGpsTrackingService');
const {
  GpsServiceUnavailableError,
  NotFoundError,
  ValidationError,
} = require('../src/errors/patrolErrors');
const { PatrolStatus, TrackingStatus, GpsStatus } = require('../src/constants/patrolEnums');
const { LocationPoint, Zone } = require('../src/models/patrolDomain');
const { PatrolViewAssembler } = require('../src/services/patrolMonitoring.service');
const {
  EvaluationValidator,
  PatrolEvaluationService,
} = require('../src/services/patrolEvaluation.service');
const { PatrolFilterBuilder } = require('../src/services/patrolQuery.service');
const { createConsoleLogger } = require('../src/utils/logger');
const { buildSeedData, PARK_ID } = require('../src/utils/patrolSeed');
const { distanceAlongRouteKm } = require('../src/utils/geo');
const config = require('../src/config/patrol.config');
const {
  NOW,
  hoursAgo,
  minutesAgo,
  fixAt,
  createRepositories,
  createSilentLogger,
  MockGpsTrackingService,
} = require('./patrol.helpers');

const HOUR_MS = 3_600_000;
const ids = (patrols) => patrols.map((patrol) => patrol.patrolId);
const byId = (items, key, id) => items.find((item) => item[key] === id);

/** Builds the module on in-memory repositories with a mock GPS service. */
function createModule({ gps = {}, clock = () => NOW, ...repositoryOptions } = {}) {
  const repositories = createRepositories(repositoryOptions);
  const gpsService = new MockGpsTrackingService(gps);
  const logger = createSilentLogger();
  const { services } = createPatrolModule({ repositories, gpsService, clock, logger });
  const [northRoute, southRoute] = repositories.seed.park.routes;

  return { ...services, repositories, gpsService, logger, northRoute, southRoute };
}

/** Fixes for every ranger on patrol except RN-003, who has no signal. */
function fixesForEveryoneButRn003(repositories) {
  const [northRoute, southRoute] = repositories.seed.park.routes;
  return {
    'RN-001': fixAt(northRoute, 5),
    'RN-002': fixAt(southRoute, 3),
    'RN-006': fixAt(southRoute, 3),
    'RN-005': fixAt(northRoute, 1),
  };
}

/* ------------------------- Monitoring dashboard -------------------------- */

test('T-01 the dashboard returns active patrols with progress, coverage and locations', async () => {
  const module = createModule();
  module.gpsService.fixes = fixesForEveryoneButRn003(module.repositories);
  const trackLengthBefore = (await module.repositories.patrols.findByPatrolId('PT-002')).track
    .length;

  const dashboard = await module.monitoringService.getDashboard();
  const patrol = byId(dashboard.activePatrols, 'patrolId', 'PT-001');

  assert.deepEqual(ids(dashboard.activePatrols), ['PT-004', 'PT-001', 'PT-003', 'PT-002']);
  assert.deepEqual(dashboard.summary, {
    activePatrols: 4,
    rangersOnline: 4,
    rangersOffline: 1,
    averageCoverage: 50,
    underPatrolledZones: 2,
  });
  assert.equal(patrol.status, PatrolStatus.ACTIVE);
  assert.equal(patrol.progressPercentage, 100, 'the live fix is at the last waypoint');
  assert.equal(patrol.coveragePercentage, 66.7, '4 of the 6 route waypoints visited');
  assert.equal(patrol.route.name, 'Block 1 North Circuit');
  assert.equal(patrol.rangers[0].name, 'Thilina Perera');
  assert.equal(patrol.rangers[0].trackingStatus, TrackingStatus.ONLINE);
  assert.deepEqual(patrol.rangers[0].location.latitude, module.northRoute.waypoints[5].latitude);
  assert.deepEqual(patrol.lastUpdate, NOW);
  assert.deepEqual(dashboard.lastUpdated, NOW);
  assert.equal(dashboard.gpsStatus, GpsStatus.AVAILABLE);
  assert.equal(dashboard.noActivePatrols, false);
  assert.equal(dashboard.refreshIntervalSeconds, config.REFRESH_INTERVAL_SECONDS);

  // The fix is stored once per patrol, even when two rangers share it.
  const trackLengthAfter = (await module.repositories.patrols.findByPatrolId('PT-002')).track
    .length;
  assert.equal(trackLengthAfter, trackLengthBefore + 1);
});

test('the dashboard reports coverage per zone and flags under-patrolled zones', async () => {
  const module = createModule();

  const dashboard = await module.monitoringService.getDashboard();
  const zone = (name) => byId(dashboard.zoneCoverage, 'name', name);

  assert.equal(dashboard.zoneCoverage.length, 4);
  assert.equal(zone('Block 1 North').percentage, 100);
  assert.equal(zone('Block 1 North').underPatrolled, false);
  assert.equal(zone('Palatupana Coast').percentage, 28.6);
  assert.equal(zone('Menik River Buffer').percentage, 0);
  assert.equal(zone('Menik River Buffer').lastPatrolledAt, null);
  assert.deepEqual(
    dashboard.underPatrolledZones.map((item) => [item.name, item.reasons]),
    [
      ['Palatupana Coast', ['Coverage is below 40%']],
      ['Menik River Buffer', ['Coverage is below 40%', 'Not patrolled in the last 48 hours']],
    ],
  );
});

test('"recently completed" means completed within the last 24 hours', async () => {
  const module = createModule();

  const dashboard = await module.monitoringService.getDashboard();

  // PT-005 ended 5 h ago; PT-006 ended 30 h ago and must not be listed.
  assert.deepEqual(ids(dashboard.recentlyCompleted), ['PT-005']);
  assert.equal(dashboard.recentlyCompleted[0].evaluation.rating, 4);
});

test('T-06 a ranger without a usable GPS fix is OFFLINE and keeps the last known location', async () => {
  const module = createModule();
  const stored = await module.repositories.rangers.findAll();
  module.gpsService.fixes = {
    'RN-001': fixAt(module.northRoute, 2),
    // RN-002: no fix at all (null)
    'RN-005': fixAt(module.northRoute, 1, minutesAgo(16)), // too old
    'RN-006': fixAt(module.southRoute, 1, minutesAgo(15)), // exactly on the limit
    'RN-004': new LocationPoint({ latitude: 95, longitude: 81, timestamp: NOW }), // impossible
  };

  const result = await module.locationService.resolveLocations(stored);
  const view = (rangerId) => byId(result.rangers, 'rangerId', rangerId);

  assert.equal(result.gpsStatus, GpsStatus.AVAILABLE);
  assert.equal(view('RN-001').trackingStatus, TrackingStatus.ONLINE);
  assert.deepEqual(view('RN-001').lastSyncTime, NOW);
  assert.equal(view('RN-002').trackingStatus, TrackingStatus.OFFLINE);
  assert.deepEqual(view('RN-002').location, byId(stored, 'rangerId', 'RN-002').lastKnownLocation);
  assert.deepEqual(view('RN-002').lastSyncTime, byId(stored, 'rangerId', 'RN-002').lastSyncTime);
  assert.equal(view('RN-005').trackingStatus, TrackingStatus.OFFLINE, '16-minute-old fix');
  assert.equal(view('RN-006').trackingStatus, TrackingStatus.ONLINE, '15-minute-old fix');
  assert.equal(view('RN-004').trackingStatus, TrackingStatus.OFFLINE, 'invalid coordinates');
  assert.deepEqual([...result.freshFixes.keys()].sort(), ['RN-001', 'RN-006']);

  // The new status is stored, so the next screen shows the same thing.
  const saved = await module.repositories.rangers.findByRangerId('RN-002');
  assert.equal(saved.trackingStatus, TrackingStatus.OFFLINE);
});

test('T-06 one offline ranger does not stop the other patrols from updating', async () => {
  const module = createModule();
  module.gpsService.fixes = fixesForEveryoneButRn003(module.repositories);

  const dashboard = await module.monitoringService.getDashboard();
  const offlinePatrol = byId(dashboard.activePatrols, 'patrolId', 'PT-003');

  assert.equal(offlinePatrol.rangers[0].trackingStatus, TrackingStatus.OFFLINE);
  assert.deepEqual(offlinePatrol.rangers[0].lastSyncTime, minutesAgo(25));
  assert.equal(offlinePatrol.progressPercentage, 25);
  assert.equal(byId(dashboard.activePatrols, 'patrolId', 'PT-001').progressPercentage, 100);
});

test('T-07 when the GPS service is down the dashboard uses stored locations', async () => {
  const module = createModule({ gps: { down: true } });
  const stored = await module.repositories.rangers.findAll();
  const trackBefore = (await module.repositories.patrols.findByPatrolId('PT-001')).track.length;

  const dashboard = await module.monitoringService.getDashboard();
  const ranger = byId(dashboard.activePatrols, 'patrolId', 'PT-001').rangers[0];

  assert.equal(dashboard.gpsStatus, GpsStatus.UNAVAILABLE);
  assert.equal(dashboard.activePatrols.length, 4, 'patrols are still shown');
  assert.deepEqual(ranger.location, byId(stored, 'rangerId', 'RN-001').lastKnownLocation);
  assert.equal(ranger.trackingStatus, TrackingStatus.ONLINE, 'stored status is left untouched');
  assert.equal(
    (await module.repositories.patrols.findByPatrolId('PT-001')).track.length,
    trackBefore,
  );
  assert.equal(module.gpsService.calls.length, 1, 'no point asking again after the first failure');
  assert.equal(module.logger.entries[0].level, 'warn');
  assert.match(module.logger.entries[0].message, /GPS Tracking Service unavailable/);
});

test('T-07 an unexpected GPS fault is not hidden behind the fallback', async () => {
  const module = createModule({ gps: { failWith: new Error('socket hang up') } });

  await assert.rejects(() => module.monitoringService.getDashboard(), /socket hang up/);
});

test('T-08 with no active patrols the dashboard is empty and says so', async () => {
  const module = createModule({ includeActive: false });

  const dashboard = await module.monitoringService.getDashboard();

  assert.deepEqual(dashboard.activePatrols, []);
  assert.equal(dashboard.noActivePatrols, true);
  assert.equal(dashboard.summary.activePatrols, 0);
  assert.equal(dashboard.summary.rangersOnline, 0);
  assert.deepEqual(ids(dashboard.recentlyCompleted), ['PT-005']);
  assert.equal(module.gpsService.calls.length, 0, 'nobody to locate');
});

/* ------------------------------ Filtering -------------------------------- */

test('T-09 patrols can be filtered by status, ranger, route and date range', async () => {
  const { queryService } = createModule();
  const list = async (query) => ids((await queryService.listPatrols(query)).patrols).sort();

  assert.deepEqual(await list({ status: 'COMPLETED' }), ['PT-005', 'PT-006', 'PT-007', 'PT-008']);
  assert.deepEqual(await list({ status: 'DELAYED' }), ['PT-004']);
  assert.deepEqual(await list({ rangerId: 'RN-005' }), ['PT-004', 'PT-007']);
  assert.deepEqual(await list({ routeId: 'RT-003' }), ['PT-003', 'PT-008']);
  assert.deepEqual(await list({ from: hoursAgo(10).toISOString(), to: NOW.toISOString() }), [
    'PT-001',
    'PT-002',
    'PT-003',
    'PT-004',
    'PT-005',
  ]);
  assert.deepEqual(await list({ rangerId: 'RN-004', routeId: 'RT-002', status: 'COMPLETED' }), [
    'PT-006',
  ]);
  assert.deepEqual(await list({ status: 'CANCELLED' }), []);
  assert.equal((await queryService.listPatrols({})).count, 8);
  assert.equal((await queryService.listPatrols({ rangerId: '', status: '' })).count, 8);
});

test('T-10 invalid filter values are rejected with a ValidationError', async () => {
  const { queryService } = createModule();
  const rejection = async (query) => {
    try {
      await queryService.listPatrols(query);
    } catch (error) {
      return error;
    }
    return null;
  };

  const badStatus = await rejection({ status: 'SOLVED' });
  const badDates = await rejection({ from: 'yesterday-ish', to: 'tomorrow-ish' });
  const reversed = await rejection({ from: '2026-05-18', to: '2026-05-10' });

  assert.ok(badStatus instanceof ValidationError);
  assert.equal(badStatus.statusCode, 400);
  assert.match(badStatus.fields.status, /Status must be one of: PLANNED, ACTIVE/);
  assert.deepEqual(badDates.fields, { from: 'Date is not valid', to: 'Date is not valid' });
  assert.deepEqual(reversed.fields, { to: 'End date must be on or after the start date' });
  assert.deepEqual(new PatrolFilterBuilder().build(), {});
});

/* --------------------------- History and details ------------------------- */

test('T-11 completed history lists only COMPLETED patrols, newest first, with statistics', async () => {
  const { queryService } = createModule();

  const history = await queryService.getCompletedHistory();

  assert.deepEqual(ids(history.patrols), ['PT-005', 'PT-006', 'PT-007', 'PT-008']);
  assert.ok(history.patrols.every((patrol) => patrol.status === PatrolStatus.COMPLETED));
  assert.deepEqual(history.statistics, {
    totalCompleted: 4,
    averageCoverage: 89.3,
    averageDurationMinutes: 240,
    totalDistanceKm: 42.9,
    evaluatedCount: 2,
    averageRating: 3,
  });
  assert.equal(history.patrols[1].coveragePercentage, 71.4, 'PT-006 skipped two waypoints');
  assert.equal(history.patrols[1].evaluation, null);
});

test('completed history with no completed patrols has zeroed statistics', async () => {
  const { queryService } = createModule({ patrols: [] });

  const history = await queryService.getCompletedHistory();

  assert.deepEqual(history.patrols, []);
  assert.equal(history.statistics.totalCompleted, 0);
  assert.equal(history.statistics.averageCoverage, 0);
  assert.equal(history.statistics.averageRating, 0);
});

test('T-12 asking for an unknown patrol raises NotFoundError', async () => {
  const { queryService } = createModule();

  await assert.rejects(
    () => queryService.getPatrolDetails('PT-999'),
    (error) => {
      assert.ok(error instanceof NotFoundError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, 'Patrol PT-999 was not found');
      return true;
    },
  );
  await assert.rejects(() => queryService.getPatrolCoverage('PT-999'), NotFoundError);
});

test('patrol details show ranger, route, progress, coverage, track and timeline', async () => {
  const module = createModule();
  module.gpsService.fixes = { 'RN-003': null };

  const completed = await module.queryService.getPatrolDetails('PT-005');
  const offline = await module.queryService.getPatrolDetails('PT-003');

  assert.equal(completed.canEvaluate, true);
  assert.equal(completed.progressPercentage, 100);
  assert.equal(completed.durationMinutes, 240);
  assert.equal(completed.route.waypoints.length, 6);
  assert.equal(completed.rangers[0].name, 'Sivakumar Rajan');
  assert.equal(completed.timeline[0].label, 'Patrol started');
  assert.equal(completed.timeline.at(-1).label, 'Patrol completed');
  assert.equal(completed.timeline.length, 8, 'start + 6 waypoints + completion');
  assert.deepEqual(completed.areasNeedingAttention, []);
  assert.equal(completed.gpsStatus, GpsStatus.AVAILABLE);
  assert.equal(
    module.gpsService.calls.includes('RN-004'),
    false,
    'finished patrols are not tracked',
  );

  assert.equal(offline.canEvaluate, false);
  assert.equal(offline.rangers[0].trackingStatus, TrackingStatus.OFFLINE);
  assert.deepEqual(
    offline.areasNeedingAttention.map((zone) => [zone.name, zone.percentage]),
    [['Palatupana Coast', 28.6]],
  );
  assert.equal(offline.track.length > 0, true);
});

test('patrol details report an unavailable GPS service instead of failing', async () => {
  const module = createModule({ gps: { down: true } });

  const details = await module.queryService.getPatrolDetails('PT-001');

  assert.equal(details.gpsStatus, GpsStatus.UNAVAILABLE);
  assert.equal(details.patrolId, 'PT-001');
});

test('patrol coverage is broken down by the zones of its route', async () => {
  const { queryService } = createModule();

  const coverage = await queryService.getPatrolCoverage('PT-006');

  assert.equal(coverage.patrolId, 'PT-006');
  assert.equal(coverage.percentage, 71.4);
  assert.equal(coverage.zoneCoverage.length, 1);
  assert.equal(coverage.zoneCoverage[0].name, 'Block 1 South');
  assert.equal(coverage.zoneCoverage[0].percentage, 71.4);
});

test('a patrol whose route no longer exists is reported as a system fault', () => {
  const assembler = new PatrolViewAssembler({});
  const context = { routesById: new Map(), zones: [], rangerViews: new Map() };

  assert.throws(
    () => assembler.toView({ patrolId: 'PT-X', routeId: 'RT-GONE', track: [] }, context, NOW),
    /Route RT-GONE of patrol PT-X is missing/,
  );
});

/* ------------------------------ Evaluation ------------------------------- */

const evaluationInput = (overrides = {}) => ({
  rating: 4,
  notes: 'Thorough patrol.',
  evaluatedBy: 'PM-001',
  ...overrides,
});

/** Returns the field errors raised when saving the evaluation. */
async function evaluationErrors(evaluationService, patrolId, input) {
  try {
    await evaluationService.recordEvaluation(patrolId, input);
  } catch (error) {
    assert.ok(error instanceof ValidationError, `expected ValidationError, got ${error}`);
    return error.fields;
  }
  return null;
}

test('T-13 a valid evaluation is saved with the evaluator and time', async () => {
  const { evaluationService, repositories } = createModule();

  const result = await evaluationService.recordEvaluation('PT-006', evaluationInput());

  assert.deepEqual(result, {
    patrolId: 'PT-006',
    updated: false,
    evaluation: {
      evaluationId: 'EV-PT-006',
      rating: 4,
      notes: 'Thorough patrol.',
      evaluatedBy: 'PM-001',
      evaluatedAt: NOW,
    },
  });
  assert.equal((await repositories.patrols.findByPatrolId('PT-006')).evaluation.rating, 4);
});

test('T-14 a rating that is missing, out of range or not whole is rejected', async () => {
  const { evaluationService, repositories } = createModule();
  const ratingError = async (rating) =>
    (await evaluationErrors(evaluationService, 'PT-006', evaluationInput({ rating }))).rating;

  assert.equal(await ratingError(0), 'Rating must be between 1 and 5');
  assert.equal(await ratingError(6), 'Rating must be between 1 and 5');
  assert.equal(await ratingError(3.5), 'Rating must be a whole number');
  assert.equal(await ratingError('4'), 'Rating must be a whole number');
  assert.equal(await ratingError(undefined), 'Rating is required');
  assert.equal(await ratingError(null), 'Rating is required');
  assert.deepEqual(await evaluationErrors(evaluationService, 'PT-006', undefined), {
    rating: 'Rating is required',
    evaluatedBy: 'Evaluator is required',
  });
  assert.equal((await repositories.patrols.findByPatrolId('PT-006')).evaluation, null);
});

test('T-15 a rating of 2 or lower needs notes; higher ratings do not', async () => {
  const { evaluationService } = createModule();
  const save = (input) => evaluationErrors(evaluationService, 'PT-006', evaluationInput(input));
  const needed = 'Notes are required when the rating is 2 or lower';

  assert.deepEqual(await save({ rating: 2, notes: '' }), { notes: needed });
  assert.deepEqual(await save({ rating: 1, notes: '   ' }), { notes: needed });
  assert.deepEqual(await save({ rating: 2, notes: undefined }), { notes: needed });
  assert.equal(await save({ rating: 3, notes: '' }), null);
  assert.equal(await save({ rating: 2, notes: 'Left the route early.' }), null);
});

test('T-16 notes of 500 characters are accepted and 501 are rejected', async () => {
  const { evaluationService } = createModule();
  const save = (notes) => evaluationErrors(evaluationService, 'PT-006', evaluationInput({ notes }));

  assert.equal(await save('a'.repeat(500)), null);
  assert.deepEqual(await save('a'.repeat(501)), {
    notes: 'Notes must be 500 characters or fewer',
  });
  assert.deepEqual(await save(12345), { notes: 'Notes must be text' });
});

test('T-17 saving again updates the single evaluation instead of adding another', async () => {
  const { evaluationService, repositories } = createModule();
  const before = (await repositories.patrols.findByPatrolId('PT-005')).evaluation;

  const result = await evaluationService.recordEvaluation(
    'PT-005',
    evaluationInput({ rating: 5, notes: 'Revised after debrief.' }),
  );
  const stored = (await repositories.patrols.findByPatrolId('PT-005')).evaluation;

  assert.equal(before.rating, 4);
  assert.equal(result.updated, true);
  assert.equal(result.evaluation.evaluationId, before.evaluationId);
  assert.equal(stored.rating, 5);
  assert.equal(stored.notes, 'Revised after debrief.');
  assert.deepEqual(stored.evaluatedAt, NOW);
});

test('T-18 only COMPLETED patrols that exist can be evaluated', async () => {
  const { evaluationService } = createModule();

  for (const patrolId of ['PT-001', 'PT-004']) {
    await assert.rejects(
      () => evaluationService.recordEvaluation(patrolId, evaluationInput()),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.message, 'Evaluation available after the patrol is completed');
        assert.deepEqual(error.fields, { status: 'Only completed patrols can be evaluated' });
        return true;
      },
    );
  }
  await assert.rejects(
    () => evaluationService.recordEvaluation('PT-999', evaluationInput()),
    NotFoundError,
  );
});

/* ---------------------- Dependency injection (DIP) ----------------------- */

test('T-25 services run on injected fakes and an injected clock', async () => {
  const oneHourLater = new Date(NOW.getTime() + HOUR_MS);
  const atNow = createModule();
  const later = createModule({ clock: () => oneHourLater });

  const durationNow = (await atNow.queryService.getPatrolDetails('PT-001')).durationMinutes;
  const durationLater = (await later.queryService.getPatrolDetails('PT-001')).durationMinutes;

  assert.equal(durationNow, 120);
  assert.equal(durationLater, 180);
});

test('T-25 PatrolEvaluationService needs only the two small contracts it declares (ISP)', async () => {
  const saved = [];
  const patrolReader = {
    findByPatrolId: async (patrolId) => ({ patrolId, status: PatrolStatus.COMPLETED }),
  };
  const evaluationWriter = {
    saveEvaluation: async (patrolId, evaluation) => {
      saved.push({ patrolId, evaluation });
      return evaluation;
    },
  };
  const fixedTime = new Date('2030-01-01T00:00:00.000Z');
  const service = new PatrolEvaluationService({
    patrolReader,
    evaluationWriter,
    validator: new EvaluationValidator(),
    clock: () => fixedTime,
  });

  const result = await service.recordEvaluation('PT-STUB', evaluationInput({ rating: 5 }));

  assert.equal(saved.length, 1);
  assert.equal(saved[0].patrolId, 'PT-STUB');
  assert.deepEqual(result.evaluation.evaluatedAt, fixedTime);
});

/* ------------------------ Retry and reference data ----------------------- */

test('retrying one ranger re-queries GPS for that ranger only', async () => {
  const module = createModule();
  module.gpsService.fixes = { 'RN-003': fixAt(module.southRoute, 2) };

  const recovered = await module.locationService.locateRanger('RN-003');
  module.gpsService.fixes = {};
  const stillOffline = await module.locationService.locateRanger('RN-003');

  assert.deepEqual(module.gpsService.calls, ['RN-003', 'RN-003']);
  assert.equal(recovered.trackingStatus, TrackingStatus.ONLINE);
  assert.equal(recovered.location.latitude, module.southRoute.waypoints[2].latitude);
  assert.equal(recovered.gpsStatus, GpsStatus.AVAILABLE);
  assert.equal(stillOffline.trackingStatus, TrackingStatus.OFFLINE);
  assert.equal(stillOffline.location.latitude, module.southRoute.waypoints[2].latitude);
  await assert.rejects(() => module.locationService.locateRanger('RN-999'), NotFoundError);
});

test('reference data provides the park map and the ranger list', async () => {
  const { referenceService } = createModule();

  const map = await referenceService.getParkMap(PARK_ID);
  const rangers = await referenceService.listRangers();

  assert.equal(map.park.name, 'Yala National Park');
  assert.deepEqual(
    map.zones.map((zone) => zone.name),
    ['Block 1 North', 'Block 1 South', 'Palatupana Coast', 'Menik River Buffer'],
  );
  assert.equal(map.routes.length, 4);
  assert.ok(map.routes.every((route) => route.waypoints.length >= 5));
  assert.equal(rangers.length, 6);
  assert.deepEqual(rangers[0], {
    rangerId: 'RN-001',
    name: 'Thilina Perera',
    rank: 'Senior Ranger',
    trackingStatus: TrackingStatus.ONLINE,
  });
  await assert.rejects(() => referenceService.getParkMap('PK-NOWHERE'), NotFoundError);
});

/* ------------------------- GPS Tracking Service -------------------------- */

/** Builds the simulated GPS service on in-memory repositories. */
function createSimulatedGps({ isDown = () => false, offline = [], repositories } = {}) {
  const repos = repositories ?? createRepositories();
  const provider = new RouteMovementSimulator({
    patrolReader: repos.patrols,
    routeReader: repos.routes,
    clock: () => NOW,
    isDown,
    offlineRangerIds: () => offline,
    stepKm: config.SIMULATED_GPS.STEP_KM,
  });
  return { gps: new SimulatedGpsTrackingService({ provider }), provider, repos };
}

test('the simulated GPS moves a ranger a small step along the patrol route', async () => {
  const { gps, repos } = createSimulatedGps();
  const route = await repos.routes.findByRouteId('RT-001');
  const patrol = await repos.patrols.findByPatrolId('PT-001');
  const before = distanceAlongRouteKm(route.waypoints, patrol.track.at(-1));

  const fix = await gps.getCurrentLocation('RN-001');
  const after = distanceAlongRouteKm(route.waypoints, fix);

  assert.ok(fix instanceof LocationPoint);
  assert.equal(fix.isValid(), true);
  assert.deepEqual(fix.timestamp, NOW);
  assert.ok(Math.abs(after - before - config.SIMULATED_GPS.STEP_KM) < 0.01);
});

test('the simulated GPS starts at the first waypoint and stops at the last', async () => {
  const repositories = createRepositories();
  const route = await repositories.routes.findByRouteId('RT-001');
  repositories.patrols.patrols.find((patrol) => patrol.patrolId === 'PT-001').track = [];
  repositories.patrols.patrols.find((patrol) => patrol.patrolId === 'PT-004').track = [
    { ...route.waypoints.at(-1), timestamp: NOW },
  ];
  const { gps } = createSimulatedGps({ repositories });

  const fromStart = await gps.getCurrentLocation('RN-001');
  const atEnd = await gps.getCurrentLocation('RN-005');

  assert.ok(
    distanceAlongRouteKm(route.waypoints, fromStart) <= config.SIMULATED_GPS.STEP_KM + 0.01,
  );
  assert.ok(Math.abs(atEnd.latitude - route.waypoints.at(-1).latitude) < 1e-9);
});

test('the simulated GPS returns no fix for offline, off-duty and route-less rangers', async () => {
  const repositories = createRepositories();
  repositories.patrols.patrols.find((patrol) => patrol.patrolId === 'PT-002').routeId = 'RT-GONE';
  const { gps } = createSimulatedGps({ offline: ['RN-001'], repositories });

  assert.equal(await gps.getCurrentLocation('RN-001'), null, 'device switched off');
  assert.equal(await gps.getCurrentLocation('RN-004'), null, 'not on a patrol');
  assert.equal(await gps.getCurrentLocation('RN-002'), null, 'patrol route is missing');
});

test('every GpsTrackingService keeps the same contract (LSP)', async () => {
  const route = createRepositories().seed.park.routes[0];
  const services = {
    simulated: {
      working: createSimulatedGps().gps,
      noFix: createSimulatedGps({ offline: ['RN-001'] }).gps,
      down: createSimulatedGps({ isDown: () => true }).gps,
    },
    mock: {
      working: new MockGpsTrackingService({ fixes: { 'RN-001': fixAt(route, 1) } }),
      noFix: new MockGpsTrackingService(),
      down: new MockGpsTrackingService({ down: true }),
    },
  };

  for (const [name, service] of Object.entries(services)) {
    const fix = await service.working.getCurrentLocation('RN-001');

    assert.ok(service.working instanceof GpsTrackingService, name);
    assert.ok(fix instanceof LocationPoint, `${name} returns a LocationPoint`);
    assert.equal(await service.noFix.getCurrentLocation('RN-001'), null, `${name} returns null`);
    await assert.rejects(
      () => service.down.getCurrentLocation('RN-001'),
      GpsServiceUnavailableError,
      `${name} raises GpsServiceUnavailableError`,
    );
  }
  await assert.rejects(
    () => new GpsTrackingService().getCurrentLocation('RN-001'),
    /not implemented/,
  );
});

test('environment flags switch the simulated GPS off or change who is offline', async () => {
  const build = (env) =>
    createPatrolModule({
      repositories: createRepositories(),
      clock: () => NOW,
      logger: createSilentLogger(),
      env,
    }).services.monitoringService;
  const offlineRangers = (dashboard) =>
    dashboard.activePatrols
      .flatMap((patrol) => patrol.rangers)
      .filter((ranger) => ranger.trackingStatus === TrackingStatus.OFFLINE)
      .map((ranger) => ranger.rangerId)
      .sort();

  const defaults = await build({}).getDashboard();
  const down = await build({ GPS_DOWN: 'true' }).getDashboard();
  const custom = await build({ GPS_OFFLINE_RANGERS: 'RN-001, RN-005' }).getDashboard();
  const nobody = await build({ GPS_OFFLINE_RANGERS: '' }).getDashboard();

  assert.equal(defaults.gpsStatus, GpsStatus.AVAILABLE);
  assert.deepEqual(offlineRangers(defaults), ['RN-003']);
  assert.equal(down.gpsStatus, GpsStatus.UNAVAILABLE);
  assert.deepEqual(offlineRangers(custom), ['RN-001', 'RN-005']);
  assert.deepEqual(offlineRangers(nobody), []);
});

/* ------------------------------ Repositories ----------------------------- */

/** A stand-in for a Mongoose model that records how it was queried. */
function fakeModel(result) {
  const calls = [];
  const query = (method, args) => {
    calls.push({ method, args });
    const chain = {
      sort(order) {
        calls.push({ method: 'sort', args: [order] });
        return chain;
      },
      lean: async () => result,
    };
    return chain;
  };

  return {
    calls,
    find: (...args) => query('find', args),
    findOne: (...args) => query('findOne', args),
    findOneAndUpdate: (...args) => query('findOneAndUpdate', args),
    updateOne: async (...args) => calls.push({ method: 'updateOne', args }),
  };
}

test('PatrolRepository builds the right queries and hides database fields', async () => {
  const document = { _id: 'abc', __v: 0, patrolId: 'PT-001', status: 'ACTIVE' };
  const model = fakeModel([document]);
  const repository = new PatrolRepository(model);
  const from = hoursAgo(5);

  const inProgress = await repository.findInProgress();
  await repository.findCompleted();
  await repository.findCompletedSince(from);
  await repository.findByCriteria({
    rangerId: 'RN-001',
    routeId: 'RT-001',
    status: 'ACTIVE',
    from,
    to: NOW,
  });
  await repository.findByCriteria({ from });
  await repository.findByCriteria({ to: NOW });
  await repository.findByCriteria({});
  const filters = model.calls.filter((call) => call.method === 'find').map((call) => call.args[0]);

  assert.deepEqual(inProgress, [{ patrolId: 'PT-001', status: 'ACTIVE', track: [] }]);
  assert.deepEqual(filters, [
    { status: { $in: ['ACTIVE', 'DELAYED', 'ON_HOLD'] } },
    { status: 'COMPLETED' },
    { status: 'COMPLETED', endTime: { $gte: from } },
    {
      rangerIds: 'RN-001',
      routeId: 'RT-001',
      status: 'ACTIVE',
      startTime: { $gte: from, $lte: NOW },
    },
    { startTime: { $gte: from } },
    { startTime: { $lte: NOW } },
    {},
  ]);
});

test('PatrolRepository finds, evaluates and extends a single patrol', async () => {
  const evaluation = { evaluationId: 'EV-PT-005', rating: 4 };
  const point = { latitude: 6.4, longitude: 81.4 };
  const found = new PatrolRepository(
    fakeModel({ _id: 'x', patrolId: 'PT-005', track: [point], evaluation }),
  );
  const missingModel = fakeModel(null);
  const missing = new PatrolRepository(missingModel);

  assert.deepEqual(await found.findByPatrolId('PT-005'), {
    patrolId: 'PT-005',
    track: [point],
    evaluation,
  });
  assert.deepEqual(await found.saveEvaluation('PT-005', evaluation), evaluation);
  assert.equal(await missing.findByPatrolId('PT-404'), null);
  assert.equal(await missing.saveEvaluation('PT-404', evaluation), null);

  await missing.appendTrackPoint('PT-005', point);
  assert.deepEqual(missingModel.calls.at(-1), {
    method: 'updateOne',
    args: [{ patrolId: 'PT-005' }, { $push: { track: point } }],
  });
  assert.deepEqual(missingModel.calls[1].args.slice(0, 2), [
    { patrolId: 'PT-404' },
    { $set: { evaluation } },
  ]);
});

test('RangerRepository reads rangers and stores tracking changes', async () => {
  const model = fakeModel([{ _id: 'r1', __v: 0, rangerId: 'RN-001', name: 'Thilina Perera' }]);
  const repository = new RangerRepository(model);
  const changes = { trackingStatus: TrackingStatus.OFFLINE };

  assert.deepEqual(await repository.findAll(), [{ rangerId: 'RN-001', name: 'Thilina Perera' }]);
  assert.equal((await repository.findByRangerIds(['RN-001'])).length, 1);
  await repository.updateTracking('RN-001', changes);

  assert.deepEqual(model.calls.at(-1).args, [{ rangerId: 'RN-001' }, { $set: changes }]);
  assert.deepEqual(model.calls.find((call) => call.args[0]?.rangerId?.$in).args[0], {
    rangerId: { $in: ['RN-001'] },
  });
  assert.equal(await new RangerRepository(fakeModel(null)).findByRangerId('RN-404'), null);
  assert.deepEqual(
    await new RangerRepository(fakeModel({ _id: 'r', rangerId: 'RN-002' })).findByRangerId(
      'RN-002',
    ),
    {
      rangerId: 'RN-002',
    },
  );
});

test('park repositories expose the park, its zones and its routes', async () => {
  const { park } = buildSeedData({ now: NOW });
  const listModel = fakeModel([park]);
  const zones = await new parkRepositories.ZoneRepository(listModel).findByParkId(PARK_ID);
  const allZones = await new parkRepositories.ZoneRepository(listModel).findAll();
  const routes = new parkRepositories.RouteRepository(listModel);

  assert.ok(zones[0] instanceof Zone);
  assert.equal(zones[0].parkId, PARK_ID);
  assert.equal(zones[0].contains(park.routes[0].waypoints[0]), true);
  assert.equal(allZones.length, 4);
  assert.equal((await routes.findAll()).length, 4);
  assert.equal((await routes.findByParkId(PARK_ID))[0].parkId, PARK_ID);
  assert.equal((await routes.findByRouteId('RT-003')).name, 'Palatupana Coastal Patrol');
  assert.equal(await routes.findByRouteId('RT-404'), null);
  assert.deepEqual(
    await new parkRepositories.ParkRepository(fakeModel(park)).findByParkId(PARK_ID),
    {
      parkId: PARK_ID,
      name: 'Yala National Park',
      location: park.location,
      terrainType: park.terrainType,
    },
  );
  assert.equal(
    await new parkRepositories.ParkRepository(fakeModel(null)).findByParkId('PK-404'),
    null,
  );
});

test('every repository contract method must be implemented by a subclass', async () => {
  const abstractMethods = {
    PatrolReader: [
      'findByPatrolId',
      'findInProgress',
      'findCompleted',
      'findCompletedSince',
      'findByCriteria',
    ],
    EvaluationWriter: ['saveEvaluation'],
    TrackWriter: ['appendTrackPoint'],
    RangerReader: ['findAll', 'findByRangerId', 'findByRangerIds'],
    RangerTrackingWriter: ['updateTracking'],
    ParkReader: ['findByParkId'],
    ZoneReader: ['findAll', 'findByParkId'],
    RouteReader: ['findAll', 'findByParkId', 'findByRouteId'],
  };

  for (const [contract, methods] of Object.entries(abstractMethods)) {
    for (const method of methods) {
      await assert.rejects(
        () => new contracts[contract]()[method](),
        new RegExp(`${contract}\\.${method}\\(\\) is not implemented`),
      );
    }
  }
});

/* ------------------------------ Seed and logger -------------------------- */

test('the sample data matches the scenario preconditions', () => {
  const full = buildSeedData({ now: NOW });
  const noActive = buildSeedData({ now: NOW, includeActive: false });
  const count = (patrols, status) => patrols.filter((patrol) => patrol.status === status).length;

  assert.equal(full.park.zones.length, 4);
  assert.equal(full.park.routes.length, 4);
  assert.equal(full.rangers.length, 6);
  assert.equal(count(full.patrols, PatrolStatus.ACTIVE), 3);
  assert.equal(count(full.patrols, PatrolStatus.DELAYED), 1);
  assert.equal(count(full.patrols, PatrolStatus.COMPLETED), 4);
  assert.equal(full.patrols.filter((patrol) => patrol.evaluation).length, 2);
  assert.equal(byId(full.rangers, 'rangerId', 'RN-003').trackingStatus, TrackingStatus.OFFLINE);
  assert.equal(byId(full.patrols, 'patrolId', 'PT-005').progressPercentage, 100);
  assert.equal(count(noActive.patrols, PatrolStatus.COMPLETED), noActive.patrols.length);
  assert.ok(noActive.rangers.every((ranger) => ranger.trackingStatus === TrackingStatus.OFFLINE));
  assert.ok(buildSeedData().patrols.length > 0, 'defaults to the current time');
});

test('the console logger prefixes every line with its scope', (t) => {
  const lines = [];
  for (const level of ['info', 'warn', 'error']) {
    t.mock.method(console, level, (...parts) => lines.push([level, ...parts]));
  }
  const logger = createConsoleLogger('patrol-test');

  logger.info('started');
  logger.warn('careful', 'detail');
  logger.error('failed', 'reason');
  createConsoleLogger().info('default scope');

  assert.deepEqual(lines, [
    ['info', '[patrol-test]', 'started', ''],
    ['warn', '[patrol-test]', 'careful', 'detail'],
    ['error', '[patrol-test]', 'failed', 'reason'],
    ['info', '[patrol]', 'default scope', ''],
  ]);
});
