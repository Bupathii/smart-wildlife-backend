'use strict';

/**
 * Tests for assigning patrols (Park Manager, web) and carrying them out
 * with phone tracking (ranger, mobile app).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { createPatrolModule } = require('../src/patrol.container');
const contracts = require('../src/repositories/patrolContracts');
const PatrolRepository = require('../src/repositories/PatrolRepository');
const RangerRepository = require('../src/repositories/RangerRepository');
const DeviceFirstGpsTrackingService = require('../src/gps/DeviceFirstGpsTrackingService');
const {
  ConflictError,
  GpsServiceUnavailableError,
  NotFoundError,
  ValidationError,
} = require('../src/errors/patrolErrors');
const { LocationSource, PatrolStatus, TrackingStatus } = require('../src/constants/patrolEnums');
const { LocationPoint } = require('../src/models/patrolDomain');
const {
  NOW,
  createRepositories,
  createSilentLogger,
  MockGpsTrackingService,
} = require('./patrol.helpers');

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const APP_RANGER = 'ranger.demo@wildlife.lk'; // RN-007 Dilan Fernando
const OTHER_APP_RANGER = 'ranger2.demo@wildlife.lk'; // RN-008 Kavindu Bandara
const later = (hours) => new Date(NOW.getTime() + hours * HOUR_MS);
const secondsAgo = (seconds, from = NOW) => new Date(from.getTime() - seconds * 1000);

const planInput = (overrides = {}) => ({
  routeId: 'RT-004',
  rangerIds: ['RN-007'],
  startTime: later(1).toISOString(),
  endTime: later(5).toISOString(),
  ...overrides,
});

/**
 * The module on in-memory repositories. By default it uses the production
 * GPS wiring (phone first, simulator otherwise) and a clock tests can move.
 */
function createModule({ gpsService, env = {} } = {}) {
  const repositories = createRepositories();
  const time = { now: NOW };
  const module = createPatrolModule({
    repositories,
    gpsService,
    env,
    clock: () => time.now,
    logger: createSilentLogger(),
  });
  return { ...module.services, module, repositories, time };
}

/** Runs the action and returns the error it raised (fails if none). */
async function errorFrom(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return assert.fail('expected the action to be rejected');
}

/** A module where RN-007 already has a planned patrol on RT-004. */
async function createModuleWithPlannedPatrol(options) {
  const context = createModule(options);
  context.planned = await context.planningService.createPatrol(planInput());
  context.route = await context.repositories.routes.findByRouteId('RT-004');
  return context;
}

const phonePoint = (waypoint, timestamp) => ({
  latitude: waypoint.latitude,
  longitude: waypoint.longitude,
  timestamp: timestamp.toISOString(),
});

/* -------------------------- Planning (Park Manager) ---------------------- */

test('the manager can assign rangers to a route as a planned patrol', async () => {
  const { planningService, queryService, repositories } = createModule();

  const patrol = await planningService.createPatrol(
    planInput({ rangerIds: ['RN-007', 'RN-004', 'RN-007'] }),
  );
  const second = await planningService.createPatrol(planInput({ rangerIds: ['RN-008'] }));
  const planned = await queryService.listPatrols({ status: 'PLANNED' });

  assert.equal(patrol.patrolId, 'PT-009');
  assert.equal(patrol.status, PatrolStatus.PLANNED);
  assert.equal(patrol.parkId, 'PK-YALA');
  assert.equal(patrol.routeId, 'RT-004');
  assert.deepEqual(patrol.rangerIds, ['RN-007', 'RN-004'], 'a ranger listed twice is kept once');
  assert.deepEqual(patrol.startTime, later(1));
  assert.deepEqual(patrol.track, []);
  assert.equal(second.patrolId, 'PT-010');
  assert.equal(planned.count, 2);
  assert.equal(planned.patrols[0].progressPercentage, 0);
  assert.equal((await repositories.patrols.findByPatrolId('PT-009')).evaluation, null);
});

test('a planned patrol does not appear on the monitoring dashboard until it starts', async () => {
  const { planningService, monitoringService } = createModule({
    gpsService: new MockGpsTrackingService(),
  });

  await planningService.createPatrol(planInput());
  const dashboard = await monitoringService.getDashboard();

  assert.equal(dashboard.summary.activePatrols, 4);
  assert.equal(
    dashboard.activePatrols.some((patrol) => patrol.patrolId === 'PT-009'),
    false,
  );
});

test('a patrol plan needs a real route, free rangers and sensible times', async () => {
  const { planningService } = createModule();
  const fields = async (overrides) =>
    (await errorFrom(() => planningService.createPatrol(planInput(overrides)))).fields;
  const tooMany = ['RN-004', 'RN-007', 'RN-008', 'RN-009', 'RN-001', 'RN-002', 'RN-003'];

  assert.deepEqual(await fields({ routeId: '' }), { routeId: 'Choose a patrol route' });
  assert.deepEqual(await fields({ routeId: 'RT-999' }), { routeId: 'Choose a patrol route' });
  assert.deepEqual(await fields({ rangerIds: [] }), { rangerIds: 'Assign at least one ranger' });
  assert.deepEqual(await fields({ rangerIds: 'RN-007' }), {
    rangerIds: 'Assign at least one ranger',
  });
  assert.deepEqual(await fields({ rangerIds: tooMany }), {
    rangerIds: 'A patrol can have at most 6 rangers',
  });
  assert.deepEqual(await fields({ rangerIds: ['RN-007', 'RN-999'] }), {
    rangerIds: 'Ranger RN-999 was not found',
  });
  assert.deepEqual(await fields({ rangerIds: ['RN-001'] }), {
    rangerIds: 'Thilina Perera is already assigned to patrol PT-001',
  });
  assert.deepEqual(await fields({ startTime: 'soon' }), { startTime: 'Start time is not valid' });
  assert.deepEqual(await fields({ endTime: undefined }), { endTime: 'End time is not valid' });
  assert.deepEqual(await fields({ endTime: later(1).toISOString() }), {
    endTime: 'End time must be after the start time',
  });
  assert.deepEqual(await fields({ endTime: later(26).toISOString() }), {
    endTime: 'A patrol can last at most 24 hours',
  });
  assert.equal(
    (await planningService.createPatrol(planInput({ endTime: later(25) }))).patrolId,
    'PT-009',
  );
});

test('an empty plan reports every missing field at once', async () => {
  const { planningService } = createModule();

  const error = await errorFrom(() => planningService.createPatrol());

  assert.ok(error instanceof ValidationError);
  assert.deepEqual(error.fields, {
    routeId: 'Choose a patrol route',
    rangerIds: 'Assign at least one ranger',
    startTime: 'Start time is not valid',
    endTime: 'End time is not valid',
  });
});

test('a ranger with a planned patrol cannot be given a second one', async () => {
  const { planningService } = await createModuleWithPlannedPatrol();

  const error = await errorFrom(() =>
    planningService.createPatrol(planInput({ routeId: 'RT-001' })),
  );

  assert.deepEqual(error.fields, {
    rangerIds: 'Dilan Fernando is already assigned to patrol PT-009',
  });
});

test('a planned patrol can be changed; a started one cannot', async () => {
  const { planningService, repositories } = await createModuleWithPlannedPatrol();

  const updated = await planningService.updatePatrol(
    'PT-009',
    planInput({ routeId: 'RT-003', rangerIds: ['RN-007', 'RN-008'], endTime: later(3) }),
  );
  const started = await errorFrom(() => planningService.updatePatrol('PT-001', planInput()));
  const invalid = await errorFrom(() => planningService.updatePatrol('PT-009'));

  assert.equal(updated.routeId, 'RT-003');
  assert.deepEqual(updated.rangerIds, ['RN-007', 'RN-008'], 'keeping its own ranger is allowed');
  assert.deepEqual(updated.endTime, later(3));
  assert.equal(updated.status, PatrolStatus.PLANNED);
  assert.equal((await repositories.patrols.findByPatrolId('PT-009')).routeId, 'RT-003');
  assert.ok(started instanceof ConflictError);
  assert.equal(started.statusCode, 409);
  assert.match(started.message, /Only a planned patrol can be changed/);
  assert.ok(invalid instanceof ValidationError);
  await assert.rejects(() => planningService.updatePatrol('PT-999', planInput()), NotFoundError);
});

test('cancelling a planned patrol frees its rangers; a started patrol cannot be cancelled', async () => {
  const { planningService } = await createModuleWithPlannedPatrol();

  const cancelled = await planningService.cancelPatrol('PT-009');
  const reassigned = await planningService.createPatrol(planInput({ routeId: 'RT-001' }));
  const active = await errorFrom(() => planningService.cancelPatrol('PT-001'));
  const again = await errorFrom(() => planningService.cancelPatrol('PT-009'));

  assert.equal(cancelled.status, PatrolStatus.CANCELLED);
  assert.equal(reassigned.patrolId, 'PT-010');
  assert.match(active.message, /Only a planned patrol can be cancelled/);
  assert.ok(again instanceof ConflictError);
  await assert.rejects(() => planningService.cancelPatrol('PT-999'), NotFoundError);
});

/* --------------------------- Ranger (mobile app) ------------------------- */

test('a ranger with nothing assigned sees an empty patrol and zeroed insights', async () => {
  const { rangerPatrolService } = createModule();

  const mine = await rangerPatrolService.getMyPatrol(APP_RANGER);

  assert.deepEqual(mine.ranger, { rangerId: 'RN-007', name: 'Dilan Fernando', rank: 'Ranger' });
  assert.equal(mine.patrol, null);
  assert.deepEqual(mine.history, []);
  assert.deepEqual(mine.insights, {
    completedPatrols: 0,
    averageCoverage: 0,
    totalDistanceKm: 0,
    averageRating: 0,
    lastEvaluation: null,
  });
});

test('an account without a ranger profile is told so', async () => {
  const { rangerPatrolService } = createModule();

  for (const email of ['manager.demo@wildlife.lk', undefined]) {
    const error = await errorFrom(() => rangerPatrolService.getMyPatrol(email));
    assert.ok(error instanceof NotFoundError);
    assert.equal(error.message, 'No ranger profile is linked to this account');
  }
});

test('a ranger sees the assigned patrol with its route and waypoint checklist', async () => {
  const { rangerPatrolService, route } = await createModuleWithPlannedPatrol();

  const { patrol } = await rangerPatrolService.getMyPatrol(APP_RANGER);

  assert.equal(patrol.patrolId, 'PT-009');
  assert.equal(patrol.status, PatrolStatus.PLANNED);
  assert.deepEqual(patrol.route, {
    routeId: 'RT-004',
    name: 'Menik River Buffer Line',
    description: route.description,
    routeLength: route.routeLength,
  });
  assert.equal(patrol.waypoints.length, 7);
  assert.deepEqual(patrol.waypoints[0], {
    number: 1,
    latitude: route.waypoints[0].latitude,
    longitude: route.waypoints[0].longitude,
    reached: false,
  });
  assert.equal(patrol.waypointsReached, 0);
  assert.equal(patrol.progressPercentage, 0);
  assert.equal(patrol.durationMinutes, 0, 'the clock starts when the ranger starts');
  assert.deepEqual(patrol.teammates, ['Dilan Fernando']);
});

test('only the ranger starts the patrol, and only once', async () => {
  const { rangerPatrolService, repositories, time } = await createModuleWithPlannedPatrol();
  time.now = later(1);

  const started = await rangerPatrolService.startPatrol(APP_RANGER);
  const again = await errorFrom(() => rangerPatrolService.startPatrol(APP_RANGER));
  const nothing = await errorFrom(() => rangerPatrolService.startPatrol(OTHER_APP_RANGER));

  assert.equal(started.patrol.status, PatrolStatus.ACTIVE);
  assert.deepEqual(started.patrol.startTime, later(1), 'the real start time is stored');
  assert.equal((await repositories.patrols.findByPatrolId('PT-009')).status, PatrolStatus.ACTIVE);
  assert.ok(again instanceof ConflictError);
  assert.equal(again.message, 'Patrol PT-009 has already been started');
  assert.ok(nothing instanceof NotFoundError);
  assert.equal(nothing.message, 'No patrol is assigned to you at the moment');
});

test('phone locations are stored on the track and move the ranger', async () => {
  const context = await createModuleWithPlannedPatrol();
  const { rangerPatrolService, repositories, route } = context;
  await rangerPatrolService.startPatrol(APP_RANGER);

  // Sent newest first on purpose; the older point was held while offline.
  const result = await rangerPatrolService.recordLocations(APP_RANGER, [
    phonePoint(route.waypoints[1], secondsAgo(30)),
    phonePoint(route.waypoints[0], secondsAgo(600)),
  ]);
  const stored = await repositories.patrols.findByPatrolId('PT-009');
  const ranger = await repositories.rangers.findByRangerId('RN-007');
  const { patrol } = await rangerPatrolService.getMyPatrol(APP_RANGER);

  assert.equal(result.accepted, 2);
  assert.equal(result.patrolId, 'PT-009');
  assert.ok(result.progressPercentage > 0 && result.progressPercentage < 30);
  assert.ok(result.distanceCoveredKm > 1);
  assert.deepEqual(
    stored.track.map((point) => point.source),
    [LocationSource.SYNCHRONIZED, LocationSource.GPS],
    'oldest first; the late one is marked as synchronised',
  );
  assert.equal(ranger.trackingStatus, TrackingStatus.ONLINE);
  assert.deepEqual(ranger.lastSyncTime, secondsAgo(30));
  assert.equal(ranger.lastKnownLocation.latitude, route.waypoints[1].latitude);
  assert.equal(patrol.waypointsReached, 2);
  assert.deepEqual(
    patrol.waypoints.map((waypoint) => waypoint.reached),
    [true, true, false, false, false, false, false],
  );
});

test('locations are refused before the patrol starts or when they are not believable', async () => {
  const { rangerPatrolService, route, repositories } = await createModuleWithPlannedPatrol();
  const good = phonePoint(route.waypoints[0], secondsAgo(10));

  const notStarted = await errorFrom(() => rangerPatrolService.recordLocations(APP_RANGER, [good]));
  await rangerPatrolService.startPatrol(APP_RANGER);
  const problem = async (points) =>
    (await errorFrom(() => rangerPatrolService.recordLocations(APP_RANGER, points))).fields.points;

  assert.ok(notStarted instanceof ConflictError);
  assert.equal(notStarted.message, 'Start the patrol before sending locations');
  assert.equal(await problem([]), 'Send at least one location');
  assert.equal(await problem(undefined), 'Send at least one location');
  assert.equal(await problem(Array(201).fill(good)), 'Send at most 200 locations at a time');
  assert.equal(
    await problem([good, { ...good, latitude: 123 }]),
    'Location 2 is not a valid position and time',
  );
  assert.equal(
    await problem([{ ...good, timestamp: undefined }]),
    'Location 1 is not a valid position and time',
  );
  assert.equal(await problem([null]), 'Location 1 is not a valid position and time');
  assert.equal(
    await problem([{ ...good, timestamp: later(1).toISOString() }]),
    'Location 1 is not a valid position and time',
    'a time an hour in the future is rejected',
  );
  assert.equal((await repositories.patrols.findByPatrolId('PT-009')).track.length, 0);
  assert.equal(
    (await rangerPatrolService.recordLocations(APP_RANGER, Array(200).fill(good))).accepted,
    200,
  );
});

test('the dashboard shows the phone ranger live, without duplicating track points', async () => {
  const context = await createModuleWithPlannedPatrol();
  const { rangerPatrolService, monitoringService, repositories, route, time } = context;
  await rangerPatrolService.startPatrol(APP_RANGER);
  await rangerPatrolService.recordLocations(APP_RANGER, [
    phonePoint(route.waypoints[0], secondsAgo(20)),
  ]);
  const view = (dashboard) =>
    dashboard.activePatrols.find((patrol) => patrol.patrolId === 'PT-009');

  const live = view(await monitoringService.getDashboard());
  const trackAfterDashboard = (await repositories.patrols.findByPatrolId('PT-009')).track.length;
  time.now = new Date(NOW.getTime() + 16 * MINUTE_MS);
  const silent = view(await monitoringService.getDashboard());

  assert.equal(live.rangers[0].name, 'Dilan Fernando');
  assert.equal(live.rangers[0].trackingStatus, TrackingStatus.ONLINE);
  assert.equal(live.rangers[0].location.latitude, route.waypoints[0].latitude);
  assert.equal(trackAfterDashboard, 1, 'the phone already stored this point');
  assert.equal(
    silent.rangers[0].trackingStatus,
    TrackingStatus.OFFLINE,
    'no report for 16 minutes',
  );
  assert.equal(silent.rangers[0].location.latitude, route.waypoints[0].latitude);
});

test("completing a patrol stores the result and moves it to the ranger's history", async () => {
  const context = await createModuleWithPlannedPatrol();
  const { rangerPatrolService, evaluationService, repositories, route, time } = context;
  const tooEarly = await errorFrom(() => rangerPatrolService.completePatrol(APP_RANGER));
  await rangerPatrolService.startPatrol(APP_RANGER);
  await rangerPatrolService.recordLocations(
    APP_RANGER,
    route.waypoints.map((waypoint, index) => phonePoint(waypoint, secondsAgo(70 - index * 10))),
  );
  time.now = later(2);

  const done = await rangerPatrolService.completePatrol(APP_RANGER);
  const stored = await repositories.patrols.findByPatrolId('PT-009');
  await evaluationService.recordEvaluation('PT-009', {
    rating: 5,
    notes: 'Full route covered.',
    evaluatedBy: 'PM-001',
  });
  const evaluated = await rangerPatrolService.getMyPatrol(APP_RANGER);

  assert.ok(tooEarly instanceof ConflictError);
  assert.equal(tooEarly.message, 'Only a patrol that has been started can be completed');
  assert.equal(done.patrol, null, 'nothing is assigned any more');
  assert.equal(stored.status, PatrolStatus.COMPLETED);
  assert.deepEqual(stored.endTime, later(2));
  assert.equal(stored.progressPercentage, 100);
  assert.equal(stored.coveragePercentage, 100);
  assert.equal(done.history.length, 1);
  assert.equal(done.history[0].patrolId, 'PT-009');
  assert.equal(done.insights.completedPatrols, 1);
  assert.equal(done.insights.averageCoverage, 100);
  assert.equal(done.insights.totalDistanceKm, route.routeLength);
  assert.equal(done.insights.lastEvaluation, null);
  assert.deepEqual(evaluated.insights.lastEvaluation, {
    patrolId: 'PT-009',
    rating: 5,
    notes: 'Full route covered.',
  });
  assert.equal(evaluated.insights.averageRating, 5);
  await assert.rejects(() => rangerPatrolService.completePatrol(APP_RANGER), NotFoundError);
});

/* ------------------------- GPS adapter and storage ----------------------- */

test('DeviceFirstGpsTrackingService uses the phone for app rangers and the fallback for others', async () => {
  const position = { latitude: 6.48, longitude: 81.45, timestamp: NOW, source: 'GPS' };
  const rangers = {
    'RN-007': { rangerId: 'RN-007', userEmail: APP_RANGER, lastKnownLocation: position },
    'RN-008': { rangerId: 'RN-008', userEmail: OTHER_APP_RANGER, lastKnownLocation: null },
    'RN-001': { rangerId: 'RN-001', userEmail: null },
  };
  const fallback = new MockGpsTrackingService({
    fixes: { 'RN-001': { ...position, latitude: 6.41 } },
  });
  const build = (down) =>
    new DeviceFirstGpsTrackingService({
      rangerReader: { findByRangerId: async (rangerId) => rangers[rangerId] ?? null },
      fallback,
      isDown: () => down,
    });

  const fromPhone = await build(false).getCurrentLocation('RN-007');

  assert.ok(fromPhone instanceof LocationPoint);
  assert.equal(fromPhone.latitude, 6.48);
  assert.equal(await build(false).getCurrentLocation('RN-008'), null, 'phone has not reported yet');
  assert.equal((await build(false).getCurrentLocation('RN-001')).latitude, 6.41);
  assert.equal(await build(false).getCurrentLocation('RN-404'), null, 'unknown rangers fall back');
  assert.deepEqual(fallback.calls, ['RN-001', 'RN-404']);
  await assert.rejects(() => build(true).getCurrentLocation('RN-007'), GpsServiceUnavailableError);
});

test('repositories store new patrols, plan changes, track batches and app accounts', async () => {
  const calls = [];
  const record =
    (method, result) =>
    (...args) => {
      calls.push([method, ...args]);
      return { lean: async () => result };
    };
  const patrolModel = {
    create: async (...args) => calls.push(['create', ...args]),
    updateOne: async (...args) => calls.push(['updateOne', ...args]),
    find: record('find', [{ patrolId: 'PT-001' }, { patrolId: 'PT-002' }]),
    findOneAndUpdate: record('findOneAndUpdate', {
      _id: 'x',
      patrolId: 'PT-009',
      status: 'ACTIVE',
    }),
  };
  const patrols = new PatrolRepository(patrolModel);
  const points = [{ latitude: 6.4, longitude: 81.4 }];

  await patrols.createPatrol({ patrolId: 'PT-009' });
  await patrols.appendTrackPoints('PT-009', points);
  const ids = await patrols.findPatrolIds();
  const updated = await patrols.updatePatrol('PT-009', { status: 'ACTIVE' });
  const rangers = new RangerRepository({
    findOne: record('findOne', { _id: 'r', rangerId: 'RN-007', userEmail: APP_RANGER }),
  });
  const ranger = await rangers.findByUserEmail('  Ranger.Demo@Wildlife.lk ');

  assert.deepEqual(ids, ['PT-001', 'PT-002']);
  assert.deepEqual(updated, { patrolId: 'PT-009', status: 'ACTIVE', track: [] });
  assert.equal(ranger.rangerId, 'RN-007');
  assert.deepEqual(calls, [
    ['create', { patrolId: 'PT-009' }],
    ['updateOne', { patrolId: 'PT-009' }, { $push: { track: { $each: points } } }],
    ['find', {}, { patrolId: 1 }],
    [
      'findOneAndUpdate',
      { patrolId: 'PT-009' },
      { $set: { status: 'ACTIVE' } },
      { new: true, runValidators: true },
    ],
    ['findOne', { userEmail: APP_RANGER }],
  ]);
  for (const [contract, method] of [
    ['PatrolWriter', 'createPatrol'],
    ['PatrolWriter', 'updatePatrol'],
    ['PatrolReader', 'findPatrolIds'],
    ['TrackWriter', 'appendTrackPoints'],
    ['RangerReader', 'findByUserEmail'],
  ]) {
    await assert.rejects(() => new contracts[contract]()[method](), /is not implemented/);
  }
});

/* ---------------------------------- API ---------------------------------- */

/** An app whose guards act as the signed-in user with the given e-mail. */
function createTestApp({ email = APP_RANGER, guards = {} } = {}) {
  const context = createModule();
  const signIn = (req, res, next) => {
    req.user = { id: 'USR-1', email };
    next();
  };
  const app = express();
  app.use(express.json());
  context.module.mount(app, { view: [signIn], ...guards });
  return { app, ...context };
}

test('API: the manager plans, changes and cancels a patrol', async () => {
  const { app } = createTestApp();

  const created = await request(app).post('/api/patrols').send(planInput()).expect(201);
  const invalid = await request(app).post('/api/patrols').send({}).expect(400);
  const updated = await request(app)
    .put('/api/patrols/PT-009')
    .send(planInput({ routeId: 'RT-003' }))
    .expect(200);
  const started = await request(app).put('/api/patrols/PT-001').send(planInput()).expect(409);
  const cancelled = await request(app).post('/api/patrols/PT-009/cancel').expect(200);
  await request(app).post('/api/patrols/PT-999/cancel').expect(404);

  assert.equal(created.body.patrolId, 'PT-009');
  assert.equal(created.body.status, 'PLANNED');
  assert.equal(invalid.body.error.fields.rangerIds, 'Assign at least one ranger');
  assert.equal(updated.body.routeId, 'RT-003');
  assert.equal(started.body.error.code, 'CONFLICT');
  assert.equal(cancelled.body.status, 'CANCELLED');
});

test('API: a ranger views, starts, reports locations for and completes their patrol', async () => {
  const { app, repositories } = createTestApp();
  const route = await repositories.routes.findByRouteId('RT-004');
  await request(app).post('/api/patrols').send(planInput()).expect(201);

  const assigned = await request(app).get('/api/patrols/mine').expect(200);
  const tooSoon = await request(app)
    .post('/api/patrols/mine/locations')
    .send({ points: [phonePoint(route.waypoints[0], secondsAgo(5))] })
    .expect(409);
  const started = await request(app).post('/api/patrols/mine/start').expect(200);
  const reported = await request(app)
    .post('/api/patrols/mine/locations')
    .send({ points: [phonePoint(route.waypoints[0], secondsAgo(5))] })
    .expect(200);
  const badPoints = await request(app).post('/api/patrols/mine/locations').expect(400);
  const completed = await request(app).post('/api/patrols/mine/complete').expect(200);

  assert.equal(assigned.body.patrol.patrolId, 'PT-009', '"mine" is not read as a patrol id');
  assert.equal(assigned.body.ranger.name, 'Dilan Fernando');
  assert.equal(tooSoon.body.error.code, 'CONFLICT');
  assert.equal(started.body.patrol.status, 'ACTIVE');
  assert.equal(reported.body.accepted, 1);
  assert.equal(badPoints.body.error.fields.points, 'Send at least one location');
  assert.equal(completed.body.patrol, null);
  assert.equal(completed.body.history[0].patrolId, 'PT-009');
});

test('API: accounts without a ranger profile and unauthorised roles are refused', async () => {
  const refuse = (req, res) => res.status(403).json({ message: 'Forbidden' });
  const manager = createTestApp({ email: 'manager.demo@wildlife.lk' });
  const rangersBlocked = createTestApp({ guards: { ranger: [refuse] } });
  const planningBlocked = createTestApp({ guards: { manage: [refuse] } });

  const noProfile = await request(manager.app).get('/api/patrols/mine').expect(404);
  await request(rangersBlocked.app).get('/api/patrols/mine').expect(403);
  await request(rangersBlocked.app).post('/api/patrols/mine/start').expect(403);
  await request(planningBlocked.app).post('/api/patrols').send(planInput()).expect(403);
  await request(planningBlocked.app).put('/api/patrols/PT-001').send(planInput()).expect(403);
  await request(planningBlocked.app).post('/api/patrols/PT-001/cancel').expect(403);

  assert.equal(noProfile.body.error.message, 'No ranger profile is linked to this account');
});
